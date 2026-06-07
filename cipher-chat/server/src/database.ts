import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/cipher.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initializeDatabase(): void {
  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      pin_hash TEXT NOT NULL,
      -- Each user gets an asymmetric key pair for E2E encryption
      -- Public key is stored on server; private key never leaves the client
      public_key TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_seen INTEGER
    );

    -- Direct messages (1-to-1)
    -- Messages are stored encrypted; server never sees plaintext
    CREATE TABLE IF NOT EXISTS direct_messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      -- encrypted_payload contains the message encrypted with recipient's public key
      -- It is a JSON string: { ciphertext, iv, encryptedKey } (see encryption docs)
      encrypted_payload TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      read_at INTEGER,
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (recipient_id) REFERENCES users(id)
    );

    -- Global chat messages
    -- Global chat uses a shared symmetric key (see ENCRYPTION.md for key distribution)
    CREATE TABLE IF NOT EXISTS global_messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      -- encrypted_payload: message encrypted with the global room key
      encrypted_payload TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    );

    -- Group chats
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      -- group_key_encrypted: the group symmetric key, encrypted once per member
      -- See group_keys table
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    -- Group membership
    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      -- The group's symmetric key encrypted with this member's public key
      encrypted_group_key TEXT,
      joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Group messages
    CREATE TABLE IF NOT EXISTS group_messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      -- encrypted_payload: message encrypted with the group's symmetric key
      encrypted_payload TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id)
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_dm_sender ON direct_messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_dm_recipient ON direct_messages(recipient_id);
    CREATE INDEX IF NOT EXISTS idx_dm_conversation ON direct_messages(sender_id, recipient_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_global_created ON global_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id, created_at);
  `);

  console.log('Database initialized');
}

export default db;
