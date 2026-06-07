import { Router, Response } from 'express';
import db from '../database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/users — list all users (for friends list)
router.get('/', authenticate, (req: AuthRequest, res: Response) => {
  const users = db
    .prepare(
      `SELECT id, username, public_key, last_seen
       FROM users
       WHERE id != ?
       ORDER BY username ASC`
    )
    .all(req.userId) as { id: string; username: string; public_key: string; last_seen: number | null }[];

  return res.json(
    users.map((u) => ({
      id: u.id,
      username: u.username,
      publicKey: u.public_key,
      lastSeen: u.last_seen,
    }))
  );
});

// GET /api/users/:id/public-key — fetch a specific user's public key
// (needed to encrypt messages before sending)
router.get('/:id/public-key', authenticate, (req: AuthRequest, res: Response) => {
  const user = db
    .prepare('SELECT id, username, public_key FROM users WHERE id = ?')
    .get(req.params.id) as { id: string; username: string; public_key: string } | undefined;

  if (!user) return res.status(404).json({ error: 'User not found' });

  return res.json({ id: user.id, username: user.username, publicKey: user.public_key });
});

export default router;
