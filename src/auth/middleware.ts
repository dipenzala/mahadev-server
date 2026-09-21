import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from './jwt';
import { prisma } from '../db';

export interface AuthedRequest extends Request {
  userId?: string;
  username?: string;
  userRole?: 'CLIENT' | 'ADMIN';
}

export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }

  let userId: string;
  let username: string;
  try {
    const payload = verifyToken(header.slice(7).trim());
    userId = payload.sub;
    username = payload.username;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    if (user.blocked) {
      res.status(403).json({ error: 'Account blocked by admin' });
      return;
    }
    req.userId = userId;
    req.username = username;
    req.userRole = user.role as 'CLIENT' | 'ADMIN';
    next();
  } catch (err) {
    console.error('[auth/middleware] error:', err);
    res.status(500).json({ error: 'Auth check failed' });
  }
}