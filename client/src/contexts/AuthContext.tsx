import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User } from '../types';
import { apiFetch } from '../utils/api';
import { generateKeyPair, exportPublicKey, storeKeyPair, loadKeyPair } from '../utils/crypto';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  register: (username: string, pin: string) => Promise<void>;
  login: (username: string, pin: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('cipher_token'));
  const [loading, setLoading] = useState(true);

  // On mount, verify existing token
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    apiFetch<{ user: User }>('/api/auth/me', {}, token)
      .then(({ user }) => setUser(user))
      .catch(() => {
        localStorage.removeItem('cipher_token');
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const register = useCallback(async (username: string, pin: string) => {
    // Generate RSA key pair on the client
    const keyPair = await generateKeyPair();
    const publicKeyBase64 = await exportPublicKey(keyPair.publicKey);

    const { token: newToken, user: newUser } = await apiFetch<{ token: string; user: User }>(
      '/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ username, pin, publicKey: publicKeyBase64 }),
      }
    );

    // Store private key locally — never sent to server
    await storeKeyPair(keyPair);

    localStorage.setItem('cipher_token', newToken);
    setToken(newToken);
    setUser({ ...newUser, publicKey: publicKeyBase64 });
  }, []);

  const login = useCallback(async (username: string, pin: string) => {
    const { token: newToken, user: newUser } = await apiFetch<{ token: string; user: User }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ username, pin }),
      }
    );

    // Check if we have a key pair stored locally
    const existing = await loadKeyPair();
    if (!existing) {
      // If logging in on a new device, generate new keys and re-upload public key
      // (This would invalidate old encrypted messages on this device)
      const keyPair = await generateKeyPair();
      const publicKeyBase64 = await exportPublicKey(keyPair.publicKey);
      await storeKeyPair(keyPair);

      // Update public key on server
      await apiFetch('/api/auth/update-key', {
        method: 'POST',
        body: JSON.stringify({ publicKey: publicKeyBase64 }),
      }, newToken).catch(() => {}); // best-effort
    }

    localStorage.setItem('cipher_token', newToken);
    setToken(newToken);
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('cipher_token');
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
