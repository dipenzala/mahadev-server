import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';

export const adminAuthRouter = Router();

interface Session {
  createdAt: number;
  adminId: string;
  adminUsername: string;
  viaMaster: boolean;
}

const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function getMasterPassword(): string {
  return process.env.ADMIN_PASSWORD ?? 'Mahadev@2026!secure';
}

function cleanup(): void {
  const now = Date.now();
  for (const entry of Array.from(sessions.entries())) {
    if (now - entry[1].createdAt > SESSION_TTL_MS) sessions.delete(entry[0]);
  }
}

function createSession(adminId: string, adminUsername: string, viaMaster: boolean): string {
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
  sessions.set(token, { createdAt: Date.now(), adminId, adminUsername, viaMaster });
  return token;
}

// ---------- Master password login ----------
adminAuthRouter.post('/login-master', (req, res) => {
  const { password } = req.body as { password?: string };
  if (typeof password !== 'string' || password.length === 0) {
    res.status(400).json({ error: 'password required' });
    return;
  }
  if (password !== getMasterPassword()) {
    res.status(401).json({ error: 'Invalid master password' });
    return;
  }
  cleanup();
  const token = createSession('master', 'Master Admin', true);
  res.json({ token, expiresIn: SESSION_TTL_MS, adminId: 'master', adminUsername: 'Master Admin' });
});

// ---------- Admin user login (email + password) ----------
adminAuthRouter.post('/login-user', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'email and password required' });
    return;
  }
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    if (user.blocked) {
      res.status(403).json({ error: 'Account blocked' });
      return;
    }
    if (user.role !== 'ADMIN') {
      res.status(403).json({ error: 'Not an admin account' });
      return;
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    cleanup();
    const token = createSession(user.id, user.username, false);
    res.json({
      token,
      expiresIn: SESSION_TTL_MS,
      adminId: user.id,
      adminUsername: user.username,
    });
  } catch (err) {
    console.error('[admin-auth/login-user]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ---------- Verify ----------
adminAuthRouter.post('/verify', (req, res) => {
  const { token } = req.body as { token?: string };
  if (typeof token !== 'string') {
    res.status(400).json({ ok: false });
    return;
  }
  const entry = sessions.get(token);
  if (!entry) {
    res.status(401).json({ ok: false });
    return;
  }
  if (Date.now() - entry.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    res.status(401).json({ ok: false });
    return;
  }
  res.json({
    ok: true,
    adminId: entry.adminId,
    adminUsername: entry.adminUsername,
    viaMaster: entry.viaMaster,
  });
});

// ---------- Logout ----------
adminAuthRouter.post('/logout', (req, res) => {
  const { token } = req.body as { token?: string };
  if (typeof token === 'string') sessions.delete(token);
  res.json({ ok: true });
});

// ---------- Server-side session utilities ----------
export function verifyAdminToken(token: string | undefined): {
  ok: boolean;
  adminId?: string;
  adminUsername?: string;
  viaMaster?: boolean;
} {
  if (!token) return { ok: false };
  const entry = sessions.get(token);
  if (!entry) return { ok: false };
  if (Date.now() - entry.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return { ok: false };
  }
  return {
    ok: true,
    adminId: entry.adminId,
    adminUsername: entry.adminUsername,
    viaMaster: entry.viaMaster,
  };
}