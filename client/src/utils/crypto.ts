/**
 * END-TO-END ENCRYPTION SYSTEM
 * ─────────────────────────────────────────────────────────────────────────────
 * This module implements a hybrid encryption scheme using the Web Crypto API.
 *
 * ARCHITECTURE OVERVIEW:
 *
 * 1. KEY PAIRS (RSA-OAEP, 2048-bit)
 *    Each user generates an asymmetric key pair on first login.
 *    - Public key: uploaded to the server, shared with others
 *    - Private key: stored ONLY in the browser's IndexedDB, never leaves the device
 *
 * 2. DIRECT MESSAGES (Hybrid RSA-OAEP + AES-GCM)
 *    For each message:
 *      a. Generate a random 256-bit AES-GCM key (the "message key")
 *      b. Encrypt the plaintext with AES-GCM using the message key
 *      c. Encrypt the message key with the RECIPIENT's RSA public key
 *      d. Send { ciphertext, iv, encryptedKey } to server
 *    To decrypt:
 *      a. Decrypt the message key using the RECIPIENT's RSA private key
 *      b. Decrypt the ciphertext using the message key
 *
 * 3. GROUP / GLOBAL CHAT (Symmetric AES-GCM)
 *    - A 256-bit group key is generated per group
 *    - The group key is encrypted with each member's RSA public key
 *      and stored on the server (one encrypted copy per member)
 *    - Messages are encrypted with the shared group key
 *    - Global chat uses a well-known key derived from the site password
 *      (all users share the same global room key)
 *
 * 4. KEY STORAGE
 *    Private keys are stored in IndexedDB using the exportable format
 *    "jwk" (JSON Web Key) under the key "cipherKeyPair".
 *    They are NEVER sent over the network.
 */

// ─── Key generation ───────────────────────────────────────────────────────────

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true, // extractable — needed for export/import
    ['encrypt', 'decrypt']
  );
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', key);
  return btoa(String.fromCharCode(...new Uint8Array(spki)));
}

export async function importPublicKey(base64: string): Promise<CryptoKey> {
  const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'spki',
    binary,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt']
  );
}

// ─── IndexedDB key storage ────────────────────────────────────────────────────
// Private keys are stored locally and never transmitted

const DB_NAME = 'cipher-keys';
const STORE_NAME = 'keys';

function openKeyDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      (e.target as IDBOpenDBRequest).result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

export async function storeKeyPair(pair: CryptoKeyPair): Promise<void> {
  const db = await openKeyDB();
  const pubJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ pub: pubJwk, priv: privJwk }, 'cipherKeyPair');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadKeyPair(): Promise<CryptoKeyPair | null> {
  const db = await openKeyDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get('cipherKeyPair');
    req.onsuccess = async () => {
      const data = req.result;
      if (!data) return resolve(null);
      try {
        const publicKey = await crypto.subtle.importKey(
          'jwk', data.pub, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt']
        );
        const privateKey = await crypto.subtle.importKey(
          'jwk', data.priv, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['decrypt']
        );
        resolve({ publicKey, privateKey });
      } catch {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// ─── AES-GCM helpers ─────────────────────────────────────────────────────────

export async function generateAESKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportAESKey(key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey('raw', key);
}

export async function importAESKey(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

// ─── Hybrid encryption for Direct Messages ───────────────────────────────────

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string;         // base64
  encryptedKey: string; // base64 — AES key encrypted with recipient's RSA public key
}

/**
 * Encrypt a message for a specific recipient.
 * Generates a fresh AES key for each message (forward secrecy per message).
 */
export async function encryptMessage(
  plaintext: string,
  recipientPublicKey: CryptoKey
): Promise<string> {
  const messageKey = await generateAESKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    messageKey,
    encoded
  );

  // Encrypt the AES key with recipient's RSA public key
  const rawKey = await exportAESKey(messageKey);
  const encryptedKey = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    recipientPublicKey,
    rawKey
  );

  const payload: EncryptedPayload = {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv),
    encryptedKey: arrayBufferToBase64(encryptedKey),
  };

  return JSON.stringify(payload);
}

/**
 * Decrypt a message using the recipient's private key.
 */
export async function decryptMessage(
  encryptedPayloadStr: string,
  privateKey: CryptoKey
): Promise<string> {
  const payload: EncryptedPayload = JSON.parse(encryptedPayloadStr);

  // Decrypt the AES key using our RSA private key
  const rawKey = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    base64ToArrayBuffer(payload.encryptedKey)
  );

  const messageKey = await importAESKey(rawKey);

  // Decrypt the message
  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToArrayBuffer(payload.iv) },
    messageKey,
    base64ToArrayBuffer(payload.ciphertext)
  );

  return new TextDecoder().decode(plainBuffer);
}

// ─── Symmetric encryption for Group / Global chat ────────────────────────────

/**
 * Encrypt a message with a shared AES-GCM group key.
 */
export async function encryptWithGroupKey(
  plaintext: string,
  groupKey: CryptoKey
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    groupKey,
    new TextEncoder().encode(plaintext)
  );

  return JSON.stringify({
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv),
  });
}

export async function decryptWithGroupKey(
  encryptedStr: string,
  groupKey: CryptoKey
): Promise<string> {
  const { ciphertext, iv } = JSON.parse(encryptedStr);

  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToArrayBuffer(iv) },
    groupKey,
    base64ToArrayBuffer(ciphertext)
  );

  return new TextDecoder().decode(plain);
}

/**
 * Encrypt a group AES key with a user's RSA public key.
 * Used when adding a member to a group.
 */
export async function encryptGroupKeyForMember(
  groupKey: CryptoKey,
  memberPublicKey: CryptoKey
): Promise<string> {
  const rawKey = await exportAESKey(groupKey);
  const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, memberPublicKey, rawKey);
  return arrayBufferToBase64(encrypted);
}

/**
 * Decrypt a group key using the current user's RSA private key.
 */
export async function decryptGroupKey(
  encryptedKeyBase64: string,
  privateKey: CryptoKey
): Promise<CryptoKey> {
  const rawKey = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    base64ToArrayBuffer(encryptedKeyBase64)
  );
  return importAESKey(rawKey);
}

/**
 * Derive a deterministic AES-GCM key from a password string.
 * Used for the global chat room: all users who know the site password
 * can derive the same key without any key exchange.
 */
export async function deriveGlobalKey(sitePassword: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(sitePassword),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode('cipher-global-salt-v1'), // fixed salt — all users must use same
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ─── Utility functions ────────────────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
