import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { body, validationResult } from 'express-validator';
import db from '../database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── DIRECT MESSAGES ─────────────────────────────────────────────────────────

// GET /api/messages/direct/:userId — fetch conversation history
router.get('/direct/:userId', authenticate, (req: AuthRequest, res: Response) => {
  const me = req.userId!;
  const other = req.params.userId;

  const messages = db
    .prepare(
      `SELECT dm.id, dm.sender_id, dm.recipient_id, dm.encrypted_payload, dm.created_at, dm.read_at,
              u.username as sender_username
       FROM direct_messages dm
       JOIN users u ON u.id = dm.sender_id
       WHERE (dm.sender_id = ? AND dm.recipient_id = ?)
          OR (dm.sender_id = ? AND dm.recipient_id = ?)
       ORDER BY dm.created_at ASC
       LIMIT 200`
    )
    .all(me, other, other, me) as any[];

  // Mark unread messages as read
  db.prepare(
    `UPDATE direct_messages SET read_at = unixepoch()
     WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL`
  ).run(me, other);

  return res.json(messages);
});

// POST /api/messages/direct — send a direct message
// The encrypted_payload is already encrypted on the client; server just stores it
router.post(
  '/direct',
  authenticate,
  [
    body('recipientId').notEmpty(),
    body('encryptedPayload').notEmpty().withMessage('Encrypted payload required'),
  ],
  (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { recipientId, encryptedPayload } = req.body;
    const senderId = req.userId!;

    // Verify recipient exists
    const recipient = db.prepare('SELECT id FROM users WHERE id = ?').get(recipientId);
    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

    const id = uuidv4();
    db.prepare(
      'INSERT INTO direct_messages (id, sender_id, recipient_id, encrypted_payload) VALUES (?, ?, ?, ?)'
    ).run(id, senderId, recipientId, encryptedPayload);

    return res.status(201).json({ id, senderId, recipientId, encryptedPayload, createdAt: Date.now() });
  }
);

// ─── GLOBAL CHAT ─────────────────────────────────────────────────────────────

// GET /api/messages/global — fetch global chat history
router.get('/global', authenticate, (_req: AuthRequest, res: Response) => {
  const messages = db
    .prepare(
      `SELECT gm.id, gm.sender_id, gm.encrypted_payload, gm.created_at, u.username as sender_username
       FROM global_messages gm
       JOIN users u ON u.id = gm.sender_id
       ORDER BY gm.created_at ASC
       LIMIT 300`
    )
    .all() as any[];

  return res.json(messages);
});

// POST /api/messages/global — post to global chat
router.post(
  '/global',
  authenticate,
  [body('encryptedPayload').notEmpty()],
  (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { encryptedPayload } = req.body;
    const id = uuidv4();

    db.prepare(
      'INSERT INTO global_messages (id, sender_id, encrypted_payload) VALUES (?, ?, ?)'
    ).run(id, req.userId, encryptedPayload);

    return res.status(201).json({ id });
  }
);

// ─── GROUP CHATS ──────────────────────────────────────────────────────────────

// GET /api/messages/groups — list groups the user is in
router.get('/groups', authenticate, (req: AuthRequest, res: Response) => {
  const groups = db
    .prepare(
      `SELECT g.id, g.name, g.created_by, g.created_at,
              gm.encrypted_group_key
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
       ORDER BY g.created_at DESC`
    )
    .all(req.userId) as any[];

  return res.json(groups);
});

// POST /api/messages/groups — create a group
router.post(
  '/groups',
  authenticate,
  [
    body('name').trim().isLength({ min: 1, max: 50 }),
    body('memberIds').isArray({ min: 1 }),
    body('encryptedKeys').isObject().withMessage('Must provide encrypted group key per member'),
  ],
  (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { name, memberIds, encryptedKeys } = req.body;
    const creatorId = req.userId!;
    const groupId = uuidv4();

    const allMembers = Array.from(new Set([creatorId, ...memberIds]));

    const insertGroup = db.prepare(
      'INSERT INTO groups (id, name, created_by) VALUES (?, ?, ?)'
    );
    const insertMember = db.prepare(
      'INSERT INTO group_members (group_id, user_id, encrypted_group_key) VALUES (?, ?, ?)'
    );

    const transaction = db.transaction(() => {
      insertGroup.run(groupId, name.trim(), creatorId);
      for (const memberId of allMembers) {
        insertMember.run(groupId, memberId, encryptedKeys[memberId] || null);
      }
    });

    transaction();

    return res.status(201).json({ id: groupId, name: name.trim(), createdBy: creatorId });
  }
);

// GET /api/messages/groups/:groupId/members
router.get('/groups/:groupId/members', authenticate, (req: AuthRequest, res: Response) => {
  // Verify membership
  const membership = db
    .prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(req.params.groupId, req.userId);
  if (!membership) return res.status(403).json({ error: 'Not a member' });

  const members = db
    .prepare(
      `SELECT u.id, u.username, u.public_key, gm.encrypted_group_key
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?`
    )
    .all(req.params.groupId) as any[];

  return res.json(members);
});

// GET /api/messages/groups/:groupId/messages
router.get('/groups/:groupId/messages', authenticate, (req: AuthRequest, res: Response) => {
  const membership = db
    .prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(req.params.groupId, req.userId);
  if (!membership) return res.status(403).json({ error: 'Not a member' });

  const messages = db
    .prepare(
      `SELECT gm.id, gm.sender_id, gm.encrypted_payload, gm.created_at, u.username as sender_username
       FROM group_messages gm
       JOIN users u ON u.id = gm.sender_id
       WHERE gm.group_id = ?
       ORDER BY gm.created_at ASC
       LIMIT 300`
    )
    .all(req.params.groupId) as any[];

  return res.json(messages);
});

// POST /api/messages/groups/:groupId/messages
router.post(
  '/groups/:groupId/messages',
  authenticate,
  [body('encryptedPayload').notEmpty()],
  (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const membership = db
      .prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id = ?')
      .get(req.params.groupId, req.userId);
    if (!membership) return res.status(403).json({ error: 'Not a member' });

    const { encryptedPayload } = req.body;
    const id = uuidv4();

    db.prepare(
      'INSERT INTO group_messages (id, group_id, sender_id, encrypted_payload) VALUES (?, ?, ?, ?)'
    ).run(id, req.params.groupId, req.userId, encryptedPayload);

    return res.status(201).json({ id });
  }
);

// POST /api/messages/groups/:groupId/invite
router.post(
  '/groups/:groupId/invite',
  authenticate,
  [
    body('userId').notEmpty(),
    body('encryptedGroupKey').notEmpty(),
  ],
  (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    // Verify requester is a member
    const membership = db
      .prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id = ?')
      .get(req.params.groupId, req.userId);
    if (!membership) return res.status(403).json({ error: 'Not a member' });

    const { userId, encryptedGroupKey } = req.body;

    // Check if already a member
    const alreadyMember = db
      .prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id = ?')
      .get(req.params.groupId, userId);
    if (alreadyMember) return res.status(409).json({ error: 'Already a member' });

    db.prepare(
      'INSERT INTO group_members (group_id, user_id, encrypted_group_key) VALUES (?, ?, ?)'
    ).run(req.params.groupId, userId, encryptedGroupKey);

    return res.status(201).json({ success: true });
  }
);

export default router;
