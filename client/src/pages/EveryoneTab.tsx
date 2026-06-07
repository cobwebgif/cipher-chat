import { useState, useEffect, useRef, useCallback } from 'react';
import { GlobalMessage } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { apiFetch } from '../utils/api';
import { deriveGlobalKey, encryptWithGroupKey, decryptWithGroupKey } from '../utils/crypto';
import MessageBubble from '../components/MessageBubble';
import MessageInput from '../components/MessageInput';
import { v4 as uuidv4 } from '../utils/uuid';

const SITE_PASSWORD = import.meta.env.VITE_SITE_PASSWORD || 'talha2010';

export default function EveryoneTab() {
  const { user, token } = useAuth();
  const { socket } = useSocket();
  const [messages, setMessages] = useState<GlobalMessage[]>([]);
  const [globalKey, setGlobalKey] = useState<CryptoKey | null>(null);
  const [loadingKey, setLoadingKey] = useState(true);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Derive the global key from the site password
  useEffect(() => {
    deriveGlobalKey(SITE_PASSWORD)
      .then(setGlobalKey)
      .finally(() => setLoadingKey(false));
  }, []);

  // Load message history
  useEffect(() => {
    if (!token || !globalKey) return;

    apiFetch<GlobalMessage[]>('/api/messages/global', {}, token)
      .then(async (msgs) => {
        const decrypted = await Promise.all(
          msgs.map(async (m) => {
            try {
              const plaintext = await decryptWithGroupKey(m.encryptedPayload, globalKey);
              return { ...m, plaintext };
            } catch {
              return { ...m, plaintext: '[could not decrypt]' };
            }
          })
        );
        setMessages(decrypted);
      })
      .catch(console.error);
  }, [token, globalKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Socket listeners
  useEffect(() => {
    if (!socket || !globalKey) return;

    const handleReceive = async (msg: GlobalMessage & { senderUsername: string }) => {
      let plaintext = '[could not decrypt]';
      try {
        plaintext = await decryptWithGroupKey(msg.encryptedPayload, globalKey);
      } catch {}

      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, { ...msg, plaintext }];
      });
    };

    const handleTypingStart = ({ userId, username }: { userId: string; username: string }) => {
      if (userId !== user?.id) {
        setTypingUsers((prev) => (prev.includes(username) ? prev : [...prev, username]));
      }
    };
    const handleTypingStop = ({ userId }: { userId: string; username: string }) => {
      setTypingUsers((prev) => {
        const u = messages.find((m) => m.senderId === userId);
        return prev.filter((n) => n !== (u as any)?.senderUsername);
      });
    };

    socket.on('global:receive', handleReceive);
    socket.on('typing:start', handleTypingStart);
    socket.on('typing:stop', handleTypingStop);

    return () => {
      socket.off('global:receive', handleReceive);
      socket.off('typing:start', handleTypingStart);
      socket.off('typing:stop', handleTypingStop);
    };
  }, [socket, globalKey, user?.id]);

  const handleSend = useCallback(async (text: string) => {
    if (!token || !user || !globalKey) return;

    try {
      const encryptedPayload = await encryptWithGroupKey(text, globalKey);
      const messageId = uuidv4();

      await apiFetch('/api/messages/global', {
        method: 'POST',
        body: JSON.stringify({ encryptedPayload }),
      }, token);

      socket?.emit('global:send', { encryptedPayload, messageId });

      setMessages((prev) => [
        ...prev,
        {
          id: messageId,
          senderId: user.id,
          senderUsername: user.username,
          encryptedPayload,
          plaintext: text,
          createdAt: Date.now(),
        },
      ]);
    } catch (e) {
      console.error('Send failed:', e);
    }
  }, [token, user, globalKey, socket]);

  const handleTyping = useCallback((typing: boolean) => {
    if (!socket) return;
    socket.emit(typing ? 'typing:start' : 'typing:stop', {
      conversationId: 'global',
      type: 'global',
    });
  }, [socket]);

  if (loadingKey) return <div className="chat-empty"><span>Deriving encryption key…</span></div>;

  return (
    <div className="chat-layout single">
      <div className="chat-area full">
        <div className="chat-header">
          <span>Everyone</span>
          <span className="chat-header-sub">Global encrypted chat</span>
        </div>

        <div className="messages-list">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m as any} showSender={true} />
          ))}
          {typingUsers.length > 0 && (
            <div className="typing-indicator">
              {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <MessageInput onSend={handleSend} onTyping={handleTyping} />
      </div>
    </div>
  );
}
