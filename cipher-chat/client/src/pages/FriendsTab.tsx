import { useState, useEffect, useRef, useCallback } from 'react';
import { User, DirectMessage } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { apiFetch } from '../utils/api';
import {
  loadKeyPair,
  importPublicKey,
  encryptMessage,
  decryptMessage,
} from '../utils/crypto';
import MessageBubble from '../components/MessageBubble';
import MessageInput from '../components/MessageInput';
import { v4 as uuidv4 } from '../utils/uuid';

export default function FriendsTab() {
  const { user, token } = useAuth();
  const { socket, onlineUsers } = useSocket();
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState<User | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const privateKeyRef = useRef<CryptoKey | null>(null);

  // Load private key once
  useEffect(() => {
    loadKeyPair().then((kp) => {
      if (kp) privateKeyRef.current = kp.privateKey;
    });
  }, []);

  // Load user list
  useEffect(() => {
    if (!token) return;
    apiFetch<User[]>('/api/users', {}, token).then(setUsers).catch(console.error);
  }, [token]);

  // Load message history when a conversation is selected
  useEffect(() => {
    if (!selected || !token) return;
    setLoadingMessages(true);
    setMessages([]);

    apiFetch<DirectMessage[]>(`/api/messages/direct/${selected.id}`, {}, token)
      .then(async (msgs) => {
        const decrypted = await Promise.all(
          msgs.map(async (m) => {
            try {
              const pk = privateKeyRef.current;
              if (!pk) return m;
              // Only decrypt messages addressed to us
              if (m.recipientId !== user?.id) {
                // For messages we sent, we'd need our own copy — for simplicity,
                // show "[sent]" for own messages without decryption (sender doesn't store their copy)
                return { ...m, plaintext: '[sent message]' };
              }
              const plaintext = await decryptMessage(m.encryptedPayload, pk);
              return { ...m, plaintext };
            } catch {
              return { ...m, plaintext: '[could not decrypt]' };
            }
          })
        );
        setMessages(decrypted);
      })
      .catch(console.error)
      .finally(() => setLoadingMessages(false));
  }, [selected, token, user?.id]);

  // Scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Socket listeners
  useEffect(() => {
    if (!socket) return;

    const handleReceive = async (msg: DirectMessage & { senderUsername: string }) => {
      // Only if it's for the current conversation
      const isRelevant =
        (msg.senderId === selected?.id && msg.recipientId === user?.id) ||
        (msg.senderId === user?.id && msg.recipientId === selected?.id);
      if (!isRelevant) return;

      let plaintext = '[sent message]';
      if (msg.recipientId === user?.id && privateKeyRef.current) {
        try {
          plaintext = await decryptMessage(msg.encryptedPayload, privateKeyRef.current);
        } catch {
          plaintext = '[could not decrypt]';
        }
      }

      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, { ...msg, plaintext }];
      });
    };

    const handleTypingStart = ({ userId }: { userId: string; username: string }) => {
      if (userId === selected?.id) setTypingUser(selected.username);
    };
    const handleTypingStop = ({ userId }: { userId: string }) => {
      if (userId === selected?.id) setTypingUser(null);
    };

    socket.on('dm:receive', handleReceive);
    socket.on('typing:start', handleTypingStart);
    socket.on('typing:stop', handleTypingStop);

    return () => {
      socket.off('dm:receive', handleReceive);
      socket.off('typing:start', handleTypingStart);
      socket.off('typing:stop', handleTypingStop);
    };
  }, [socket, selected, user?.id]);

  const handleSend = useCallback(async (text: string) => {
    if (!selected || !token || !user) return;

    try {
      const recipientPubKeyData = await apiFetch<{ publicKey: string }>(
        `/api/users/${selected.id}/public-key`,
        {},
        token
      );
      const recipientPubKey = await importPublicKey(recipientPubKeyData.publicKey);
      const encryptedPayload = await encryptMessage(text, recipientPubKey);
      const messageId = uuidv4();

      // Persist to DB
      await apiFetch('/api/messages/direct', {
        method: 'POST',
        body: JSON.stringify({ recipientId: selected.id, encryptedPayload }),
      }, token);

      // Broadcast over socket
      socket?.emit('dm:send', { recipientId: selected.id, encryptedPayload, messageId });

      // Show optimistically
      setMessages((prev) => [
        ...prev,
        {
          id: messageId,
          senderId: user.id,
          senderUsername: user.username,
          recipientId: selected.id,
          encryptedPayload,
          plaintext: text,
          createdAt: Date.now(),
        },
      ]);
    } catch (e) {
      console.error('Send failed:', e);
    }
  }, [selected, token, user, socket]);

  const handleTyping = useCallback((typing: boolean) => {
    if (!selected || !socket) return;
    socket.emit(typing ? 'typing:start' : 'typing:stop', {
      conversationId: selected.id,
      type: 'dm',
    });
  }, [selected, socket]);

  return (
    <div className="chat-layout">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">Friends</div>
        {users.length === 0 && (
          <p className="sidebar-empty">No other users yet.</p>
        )}
        {users.map((u) => (
          <button
            key={u.id}
            className={`sidebar-item ${selected?.id === u.id ? 'active' : ''}`}
            onClick={() => setSelected(u)}
          >
            <span className={`status-dot ${onlineUsers.includes(u.id) ? 'online' : 'offline'}`} />
            <span className="sidebar-name">{u.username}</span>
          </button>
        ))}
      </div>

      {/* Chat area */}
      <div className="chat-area">
        {!selected ? (
          <div className="chat-empty">
            <span>Select a friend to start messaging</span>
          </div>
        ) : (
          <>
            <div className="chat-header">
              <span className={`status-dot ${onlineUsers.includes(selected.id) ? 'online' : 'offline'}`} />
              <span>{selected.username}</span>
            </div>

            <div className="messages-list">
              {loadingMessages && <div className="loading-msgs">Loading…</div>}
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m as any} showSender={false} />
              ))}
              {typingUser && (
                <div className="typing-indicator">{typingUser} is typing…</div>
              )}
              <div ref={bottomRef} />
            </div>

            <MessageInput onSend={handleSend} onTyping={handleTyping} />
          </>
        )}
      </div>
    </div>
  );
}
