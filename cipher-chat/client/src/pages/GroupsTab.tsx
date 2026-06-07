import { useState, useEffect, useRef, useCallback } from 'react';
import { Group, GroupMessage, User } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { apiFetch } from '../utils/api';
import {
  loadKeyPair,
  importPublicKey,
  generateAESKey,
  encryptGroupKeyForMember,
  decryptGroupKey,
  encryptWithGroupKey,
  decryptWithGroupKey,
} from '../utils/crypto';
import MessageBubble from '../components/MessageBubble';
import MessageInput from '../components/MessageInput';
import { v4 as uuidv4 } from '../utils/uuid';

export default function GroupsTab() {
  const { user, token } = useAuth();
  const { socket } = useSocket();
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Group | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [groupKey, setGroupKey] = useState<CryptoKey | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const privateKeyRef = useRef<CryptoKey | null>(null);

  useEffect(() => {
    loadKeyPair().then((kp) => {
      if (kp) privateKeyRef.current = kp.privateKey;
    });
  }, []);

  useEffect(() => {
    if (!token) return;
    apiFetch<Group[]>('/api/messages/groups', {}, token).then(setGroups).catch(console.error);
    apiFetch<User[]>('/api/users', {}, token).then(setAllUsers).catch(console.error);
  }, [token]);

  // Decrypt group key and load messages when group selected
  useEffect(() => {
    if (!selected || !token || !privateKeyRef.current) return;
    setMessages([]);
    setGroupKey(null);

    (async () => {
      try {
        const pk = privateKeyRef.current!;
        const gk = await decryptGroupKey(selected.encryptedGroupKey!, pk);
        setGroupKey(gk);

        const msgs = await apiFetch<GroupMessage[]>(
          `/api/messages/groups/${selected.id}/messages`,
          {},
          token
        );
        const decrypted = await Promise.all(
          msgs.map(async (m) => {
            try {
              const plaintext = await decryptWithGroupKey(m.encryptedPayload, gk);
              return { ...m, plaintext };
            } catch {
              return { ...m, plaintext: '[could not decrypt]' };
            }
          })
        );
        setMessages(decrypted);
      } catch (e) {
        console.error('Failed to load group:', e);
      }
    })();
  }, [selected, token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Socket listeners
  useEffect(() => {
    if (!socket || !groupKey || !selected) return;

    const handleReceive = async (msg: GroupMessage & { senderUsername: string }) => {
      if (msg.groupId !== selected.id) return;
      let plaintext = '[could not decrypt]';
      try { plaintext = await decryptWithGroupKey(msg.encryptedPayload, groupKey); } catch {}
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, { ...msg, plaintext }];
      });
    };

    socket.on('group:receive', handleReceive);
    return () => { socket.off('group:receive', handleReceive); };
  }, [socket, groupKey, selected]);

  const handleSend = useCallback(async (text: string) => {
    if (!selected || !token || !user || !groupKey) return;
    try {
      const encryptedPayload = await encryptWithGroupKey(text, groupKey);
      const messageId = uuidv4();

      await apiFetch(`/api/messages/groups/${selected.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ encryptedPayload }),
      }, token);

      socket?.emit('group:send', { groupId: selected.id, encryptedPayload, messageId });

      setMessages((prev) => [
        ...prev,
        {
          id: messageId,
          groupId: selected.id,
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
  }, [selected, token, user, groupKey, socket]);

  const handleGroupSelect = (g: Group) => {
    setSelected(g);
    socket?.emit('group:join', g.id);
  };

  return (
    <div className="chat-layout">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          Groups
          <button className="sidebar-btn" onClick={() => setShowCreate(true)}>+</button>
        </div>
        {groups.length === 0 && <p className="sidebar-empty">No groups yet. Create one!</p>}
        {groups.map((g) => (
          <button
            key={g.id}
            className={`sidebar-item ${selected?.id === g.id ? 'active' : ''}`}
            onClick={() => handleGroupSelect(g)}
          >
            <span className="group-icon">#</span>
            <span className="sidebar-name">{g.name}</span>
          </button>
        ))}
      </div>

      {/* Chat area */}
      <div className="chat-area">
        {showCreate ? (
          <CreateGroupModal
            users={allUsers}
            currentUser={user!}
            token={token!}
            onCreated={(g) => {
              setGroups((prev) => [g, ...prev]);
              setShowCreate(false);
              handleGroupSelect(g);
            }}
            onClose={() => setShowCreate(false)}
          />
        ) : !selected ? (
          <div className="chat-empty"><span>Select or create a group</span></div>
        ) : (
          <>
            <div className="chat-header">
              <span># {selected.name}</span>
            </div>
            <div className="messages-list">
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m as any} showSender={true} />
              ))}
              <div ref={bottomRef} />
            </div>
            <MessageInput onSend={handleSend} />
          </>
        )}
      </div>
    </div>
  );
}

// ─── Create Group Modal ───────────────────────────────────────────────────────

function CreateGroupModal({
  users,
  currentUser,
  token,
  onCreated,
  onClose,
}: {
  users: User[];
  currentUser: User;
  token: string;
  onCreated: (g: Group) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleCreate = async () => {
    if (!name.trim()) return setError('Enter a group name.');
    if (selected.length === 0) return setError('Select at least one member.');

    setLoading(true);
    setError('');

    try {
      const groupKey = await generateAESKey();
      const allMemberIds = [currentUser.id, ...selected];
      const encryptedKeys: Record<string, string> = {};

      // Load current user's own public key
      const myKp = await loadKeyPair();

      for (const memberId of allMemberIds) {
        let pubKey: CryptoKey;
        if (memberId === currentUser.id && myKp) {
          pubKey = myKp.publicKey;
        } else {
          const u = users.find((u) => u.id === memberId);
          if (!u?.publicKey) continue;
          pubKey = await importPublicKey(u.publicKey);
        }
        encryptedKeys[memberId] = await encryptGroupKeyForMember(groupKey, pubKey);
      }

      const group = await apiFetch<Group>('/api/messages/groups', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), memberIds: selected, encryptedKeys }),
      }, token);

      onCreated({ ...group, encryptedGroupKey: encryptedKeys[currentUser.id] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create group.');
    } finally {
      setLoading(false);
    }
  };

  // Need loadKeyPair import here
  async function loadKeyPair() {
    const { loadKeyPair: lkp } = await import('../utils/crypto');
    return lkp();
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>New Group</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="field-group">
          <label className="field-label">Group Name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. The Squad"
            autoFocus
          />
        </div>

        <div className="field-group">
          <label className="field-label">Add Members</label>
          <div className="user-list">
            {users.map((u) => (
              <label key={u.id} className="user-check">
                <input
                  type="checkbox"
                  checked={selected.includes(u.id)}
                  onChange={() => toggle(u.id)}
                />
                <span>{u.username}</span>
              </label>
            ))}
          </div>
        </div>

        {error && <p className="error-msg">{error}</p>}

        <button className="btn btn-primary" onClick={handleCreate} disabled={loading}>
          {loading ? 'Creating…' : 'Create Group'}
        </button>
      </div>
    </div>
  );
}
