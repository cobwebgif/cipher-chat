import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import db from './database';

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

// Track online users: userId -> Set of socket IDs
const onlineUsers = new Map<string, Set<string>>();

interface AuthSocket extends Socket {
  userId?: string;
  username?: string;
}

export function initializeSocketIO(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // ── Authentication middleware ──────────────────────────────────────────────
  io.use((socket: AuthSocket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const payload = jwt.verify(token, JWT_SECRET) as { userId: string; username: string };
      socket.userId = payload.userId;
      socket.username = payload.username;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // ── Connection handler ────────────────────────────────────────────────────
  io.on('connection', (socket: AuthSocket) => {
    const userId = socket.userId!;
    const username = socket.username!;

    // Register socket in online users map
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId)!.add(socket.id);

    // Update last_seen in DB
    db.prepare('UPDATE users SET last_seen = unixepoch() WHERE id = ?').run(userId);

    // Join personal room (for receiving DMs)
    socket.join(`user:${userId}`);

    // Join global room
    socket.join('global');

    // Join all group rooms the user is in
    const groups = db
      .prepare('SELECT group_id FROM group_members WHERE user_id = ?')
      .all(userId) as { group_id: string }[];
    for (const { group_id } of groups) {
      socket.join(`group:${group_id}`);
    }

    // Broadcast online status to everyone
    io.emit('user:online', { userId, username });

    // Send current online users list to newly connected client
    socket.emit('users:online', Array.from(onlineUsers.keys()));

    // ── Direct message ───────────────────────────────────────────────────────
    // Client sends: { recipientId, encryptedPayload, messageId }
    // encryptedPayload is already E2E encrypted before leaving the browser
    socket.on('dm:send', (data: { recipientId: string; encryptedPayload: string; messageId: string }) => {
      const { recipientId, encryptedPayload, messageId } = data;
      if (!recipientId || !encryptedPayload || !messageId) return;

      const payload = {
        id: messageId,
        senderId: userId,
        senderUsername: username,
        recipientId,
        encryptedPayload,
        createdAt: Date.now(),
      };

      // Send to recipient's personal room (all their active sessions)
      io.to(`user:${recipientId}`).emit('dm:receive', payload);

      // Echo back to sender's other sessions
      socket.to(`user:${userId}`).emit('dm:receive', payload);
    });

    // ── Global message ───────────────────────────────────────────────────────
    socket.on('global:send', (data: { encryptedPayload: string; messageId: string }) => {
      const { encryptedPayload, messageId } = data;
      if (!encryptedPayload || !messageId) return;

      const payload = {
        id: messageId,
        senderId: userId,
        senderUsername: username,
        encryptedPayload,
        createdAt: Date.now(),
      };

      // Broadcast to all connected users in global room
      io.to('global').emit('global:receive', payload);
    });

    // ── Group message ────────────────────────────────────────────────────────
    socket.on('group:send', (data: { groupId: string; encryptedPayload: string; messageId: string }) => {
      const { groupId, encryptedPayload, messageId } = data;
      if (!groupId || !encryptedPayload || !messageId) return;

      // Verify membership before broadcasting
      const membership = db
        .prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id = ?')
        .get(groupId, userId);
      if (!membership) return;

      const payload = {
        id: messageId,
        groupId,
        senderId: userId,
        senderUsername: username,
        encryptedPayload,
        createdAt: Date.now(),
      };

      io.to(`group:${groupId}`).emit('group:receive', payload);
    });

    // ── Join new group room ───────────────────────────────────────────────────
    socket.on('group:join', (groupId: string) => {
      const membership = db
        .prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id = ?')
        .get(groupId, userId);
      if (membership) socket.join(`group:${groupId}`);
    });

    // ── Typing indicators ────────────────────────────────────────────────────
    socket.on('typing:start', (data: { conversationId: string; type: 'dm' | 'global' | 'group' }) => {
      const { conversationId, type } = data;
      if (type === 'dm') {
        socket.to(`user:${conversationId}`).emit('typing:start', { userId, username });
      } else if (type === 'group') {
        socket.to(`group:${conversationId}`).emit('typing:start', { userId, username, groupId: conversationId });
      } else {
        socket.to('global').emit('typing:start', { userId, username });
      }
    });

    socket.on('typing:stop', (data: { conversationId: string; type: 'dm' | 'global' | 'group' }) => {
      const { conversationId, type } = data;
      if (type === 'dm') {
        socket.to(`user:${conversationId}`).emit('typing:stop', { userId });
      } else if (type === 'group') {
        socket.to(`group:${conversationId}`).emit('typing:stop', { userId, groupId: conversationId });
      } else {
        socket.to('global').emit('typing:stop', { userId });
      }
    });

    // ── Read receipts ────────────────────────────────────────────────────────
    socket.on('dm:read', (senderId: string) => {
      db.prepare(
        `UPDATE direct_messages SET read_at = unixepoch()
         WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL`
      ).run(userId, senderId);
      io.to(`user:${senderId}`).emit('dm:read', { by: userId });
    });

    // ── Disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          db.prepare('UPDATE users SET last_seen = unixepoch() WHERE id = ?').run(userId);
          io.emit('user:offline', { userId });
        }
      }
    });
  });

  return io;
}
