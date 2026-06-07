import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { body, validationResult } from 'express-validator';
import db from '../database';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const SALT_ROUNDS = 12;

// POST /api/auth/register
router.post(
  '/register',
  [
    body('username')
      .trim()
      .isLength({ min: 2, max: 30 })
      .matches(/^[a-zA-Z0-9_]+$/)
      .withMessage('Username must be 2-30 alphanumeric characters or underscores'),
    body('pin')
      .isLength({ min: 4, max: 4 })
      .isNumeric()
      .withMessage('PIN must be exactly 4 digits'),
    body('publicKey')
      .notEmpty()
      .withMessage('Public key is required for E2E encryption'),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { username, pin, publicKey } = req.body;

    // Check if username already exists
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username);
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Hash the PIN before storage
    const pinHash = await bcrypt.hash(pin, SALT_ROUNDS);
    const userId = uuidv4();

    db.prepare(
      'INSERT INTO users (id, username, pin_hash, public_key) VALUES (?, ?, ?, ?)'
    ).run(userId, username.trim(), pinHash, publicKey);

    const token = jwt.sign({ userId, username: username.trim() }, JWT_SECRET, { expiresIn: '30d' });

    return res.status(201).json({
      token,
      user: { id: userId, username: username.trim() },
    });
  }
);

// POST /api/auth/login
router.post(
  '/login',
  [
    body('username').trim().notEmpty(),
    body('pin').isLength({ min: 4, max: 4 }).isNumeric(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const { username, pin } = req.body;

    const user = db
      .prepare('SELECT id, username, pin_hash, public_key FROM users WHERE LOWER(username) = LOWER(?)')
      .get(username) as { id: string; username: string; pin_hash: string; public_key: string } | undefined;

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or PIN' });
    }

    const valid = await bcrypt.compare(pin, user.pin_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or PIN' });
    }

    // Update last seen
    db.prepare('UPDATE users SET last_seen = unixepoch() WHERE id = ?').run(user.id);

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });

    return res.json({
      token,
      user: { id: user.id, username: user.username, publicKey: user.public_key },
    });
  }
);

// GET /api/auth/me - verify token & get current user
router.get('/me', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string; username: string };
    const user = db
      .prepare('SELECT id, username, public_key FROM users WHERE id = ?')
      .get(payload.userId) as { id: string; username: string; public_key: string } | undefined;

    if (!user) return res.status(401).json({ error: 'User not found' });

    return res.json({ user: { id: user.id, username: user.username, publicKey: user.public_key } });
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
});

// POST /api/auth/update-key — update public key (e.g. on new device login)
router.post('/update-key', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' });
  }

  const JWT_SECRET2 = process.env.JWT_SECRET || 'change-this-in-production';
  try {
    const token = authHeader.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET2) as { userId: string };
    const { publicKey } = req.body;
    if (!publicKey) return res.status(400).json({ error: 'publicKey required' });

    db.prepare('UPDATE users SET public_key = ? WHERE id = ?').run(publicKey, payload.userId);
    return res.json({ success: true });
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
