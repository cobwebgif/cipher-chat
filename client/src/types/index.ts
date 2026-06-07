export interface User {
  id: string;
  username: string;
  publicKey?: string;
  lastSeen?: number;
}

export interface Message {
  id: string;
  senderId: string;
  senderUsername: string;
  encryptedPayload: string;
  plaintext?: string; // decrypted on client
  createdAt: number;
  readAt?: number;
}

export interface DirectMessage extends Message {
  recipientId: string;
}

export interface GlobalMessage extends Message {}

export interface GroupMessage extends Message {
  groupId: string;
}

export interface Group {
  id: string;
  name: string;
  createdBy: string;
  encryptedGroupKey?: string;
  createdAt: number;
  members?: GroupMember[];
}

export interface GroupMember {
  id: string;
  username: string;
  publicKey: string;
  encryptedGroupKey?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
}

// Stored in IndexedDB — never sent to server
export interface LocalKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}
