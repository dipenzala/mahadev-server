import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { roundManager, type SettleEvent } from '../game/roundManager';
import { prisma } from '../db';
import { env } from '../env';
import { publicUser } from '../util/serialize';
import { verifyAdminToken } from './adminAuth';
import type { BetSide } from '../game/types';

export const adminRouter = Router();

// ---------- Auth guard ----------

adminRouter.use((req, res, next) => {
  // Allow read-only state endpoint without auth
  if (req.path === '/state' && req.method === 'GET') {
    next();
    return;
  }

  const token =
    (req.headers['x-admin-token'] as string | undefined) ??
    (req.headers['x-admin-session'] as string | undefined);

  const session = verifyAdminToken(token);
  if (!session.ok) {
    res.status(401).json({ error: 'Admin authentication required' });
    return;
  }

  (req as unknown as { adminSession: unknown }).adminSession = session;
  next();
});

// ---------- Helpers ----------

interface AdminSessionInfo {
  adminId: string;
  adminUsername: string;
  viaMaster: boolean;
}

function readSession(req: unknown): AdminSessionInfo {
  const r = req as { adminSession?: AdminSessionInfo };
  if (r.adminSession) return r.adminSession;
  return { adminId: 'unknown', adminUsername: 'Unknown', viaMaster: false };
}

async function safeLog(
  adminId: string,
  adminUsername: string,
  action: string,
  targetUserId: string | null,
  targetUsername: string | null,
  beforeValue: unknown,
  afterValue: unknown,
  note?: string,
): Promise<void> {
  try {
    await prisma.adminAction.create({
      data: {
        adminId,
        adminUsername,
        targetUserId: targetUserId ?? null,
        targetUsername: targetUsername ?? null,
        action,
        beforeValue: (beforeValue ?? {}) as object,
        afterValue: (afterValue ?? {}) as object,
        note: note ?? null,
      },
    });
  } catch (err) {
    console.error('[audit] failed:', err);
  }
}

// ---------- Round state ----------

adminRouter.get('/state', (_req, res) => {
  res.json({ state: roundManager.getPublicState() });
});

adminRouter.post('/joker', (req, res) => {
  const { code } = req.body as { code?: string | null };
  roundManager.setJoker(code ?? null);
  res.json({ ok: true });
});

adminRouter.post('/mark', async (req, res) => {
  const { code, side } = req.body as { code?: string; side?: BetSide };
  if (!code || (side !== 'ANDAR' && side !== 'BAHAR')) {
    res.status(400).json({ error: 'code and side required' });
    return;
  }

  let events: SettleEvent[];
  try {
    events = roundManager.markCard(code, side);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'mark failed' });
    return;
  }

  if (events.length > 0) {
    try {
      await prisma.$transaction(async (tx) => {
        for (const ev of events) {
          if (!ev.won) continue;
          const updated = await tx.user.update({
            where: { id: ev.userId },
            data: { balance: { increment: ev.payout } },
          });
          await tx.transaction.create({
            data: {
              userId: ev.userId,
              type: 'BET_WON',
              amount: ev.payout,
              balanceAfter: updated.balance,
              meta: { betId: ev.betId, side: ev.side, code: ev.code, stake: ev.amount },
            },
          });
        }
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'payout failed' });
      return;
    }
  }

  res.json({ ok: true, settled: events.length });
});

adminRouter.post('/unmark', (req, res) => {
  const { code } = req.body as { code?: string };
  if (!code) {
    res.status(400).json({ error: 'code required' });
    return;
  }
  roundManager.unmarkCard(code);
  res.json({ ok: true });
});

adminRouter.post('/reset', (_req, res) => {
  roundManager.reset();
  res.json({ ok: true });
});

// ---------- Users list ----------

adminRouter.get('/users', async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    res.json({
      users: users.map((u) => ({
        ...publicUser(u),
        blocked: u.blocked,
        role: u.role,
      })),
    });
  } catch (err) {
    console.error('[admin/users] error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'list failed' });
  }
});

// ---------- Balance adjust ----------

adminRouter.post('/users/:id/balance', async (req, res) => {
  const session = readSession(req);
  const { id } = req.params;
  const { amount, mode, note } = req.body as {
    amount?: number;
    mode?: 'set' | 'add';
    note?: string;
  };

  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    res.status(400).json({ error: 'amount must be a number' });
    return;
  }
  const m = mode === 'add' ? 'add' : 'set';

  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) throw new Error('User not found');

      const newBalance =
        m === 'set'
          ? Math.max(0, Math.floor(amount))
          : Math.max(0, user.balance + Math.floor(amount));

      const updated = await tx.user.update({
        where: { id },
        data: { balance: newBalance },
      });

      await tx.transaction.create({
        data: {
          userId: id,
          type: 'ADMIN_ADJUST',
          amount: newBalance - user.balance,
          balanceAfter: updated.balance,
          meta: { mode: m, requested: amount, previous: user.balance, byAdmin: session.adminId },
        },
      });

      return { user: updated, previous: user.balance };
    });

    await safeLog(
      session.adminId,
      session.adminUsername,
      'ADJUST_BALANCE',
      result.user.id,
      result.user.username,
      { previous: result.previous, mode: m, requested: amount },
      { newBalance: result.user.balance },
      note,
    );

    res.json({
      ok: true,
      user: { ...publicUser(result.user), blocked: result.user.blocked, role: result.user.role },
    });
  } catch (err) {
    console.error('[admin/balance] error:', err);
    res.status(400).json({ error: err instanceof Error ? err.message : 'balance update failed' });
  }
});

// ---------- Block / Unblock ----------

adminRouter.post('/users/:id/block', async (req, res) => {
  const session = readSession(req);
  const { id } = req.params;
  const { blocked, note } = req.body as { blocked?: boolean; note?: string };
  if (typeof blocked !== 'boolean') {
    res.status(400).json({ error: 'blocked (boolean) required' });
    return;
  }

  // Cannot block yourself
  if (id === session.adminId) {
    res.status(400).json({ error: 'Cannot block yourself' });
    return;
  }

  try {
    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const u = await prisma.user.update({ where: { id }, data: { blocked } });

    await safeLog(
      session.adminId,
      session.adminUsername,
      blocked ? 'BLOCK_USER' : 'UNBLOCK_USER',
      u.id,
      u.username,
      { blocked: before.blocked },
      { blocked: u.blocked },
      note,
    );

    res.json({ ok: true, user: { ...publicUser(u), blocked: u.blocked, role: u.role } });
  } catch (err) {
    console.error('[admin/block] error:', err);
    res.status(400).json({ error: err instanceof Error ? err.message : 'failed' });
  }
});

// ---------- Change user role ----------

adminRouter.post('/users/:id/role', async (req, res) => {
  const session = readSession(req);
  const { id } = req.params;
  const { role, note } = req.body as { role?: 'CLIENT' | 'ADMIN'; note?: string };

  if (role !== 'CLIENT' && role !== 'ADMIN') {
    res.status(400).json({ error: 'role must be CLIENT or ADMIN' });
    return;
  }
  if (id === session.adminId) {
    res.status(400).json({ error: 'Cannot change your own role' });
    return;
  }

  try {
    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Prevent removing the last admin
    if (before.role === 'ADMIN' && role === 'CLIENT') {
      const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
      if (adminCount <= 1) {
        res.status(400).json({ error: 'Cannot remove last admin' });
        return;
      }
    }

    const u = await prisma.user.update({ where: { id }, data: { role } });

    await safeLog(
      session.adminId,
      session.adminUsername,
      role === 'ADMIN' ? 'PROMOTE_TO_ADMIN' : 'DEMOTE_TO_CLIENT',
      u.id,
      u.username,
      { role: before.role },
      { role: u.role },
      note,
    );

    res.json({ ok: true, user: { ...publicUser(u), blocked: u.blocked, role: u.role } });
  } catch (err) {
    console.error('[admin/role] error:', err);
    res.status(400).json({ error: err instanceof Error ? err.message : 'role change failed' });
  }
});

// ---------- Delete user ----------

adminRouter.delete('/users/:id', async (req, res) => {
  const session = readSession(req);
  const { id } = req.params;

  // Cannot delete yourself
  if (id === session.adminId) {
    res.status(400).json({ error: 'Cannot delete yourself' });
    return;
  }

  try {
    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Prevent removing the last admin
    if (before.role === 'ADMIN') {
      const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
      if (adminCount <= 1) {
        res.status(400).json({ error: 'Cannot delete last admin' });
        return;
      }
    }

    await prisma.user.delete({ where: { id } });

    await safeLog(
      session.adminId,
      session.adminUsername,
      'DELETE_USER',
      id,
      before.username,
      {
        email: before.email,
        username: before.username,
        balance: before.balance,
        blocked: before.blocked,
        role: before.role,
      },
      { deleted: true },
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/delete] error:', err);
    res.status(400).json({ error: err instanceof Error ? err.message : 'delete failed' });
  }
});

// ---------- Create user (with role) ----------

adminRouter.post('/users', async (req, res) => {
  const session = readSession(req);
  const { email, username, password, balance, role } = req.body as {
    email?: string;
    username?: string;
    password?: string;
    balance?: number;
    role?: 'CLIENT' | 'ADMIN';
  };

  if (!email || !username || !password) {
    res.status(400).json({ error: 'email, username, password required' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'password must be at least 8 characters' });
    return;
  }

  const chosenRole: 'CLIENT' | 'ADMIN' = role === 'ADMIN' ? 'ADMIN' : 'CLIENT';

  const startBalance =
    typeof balance === 'number' && balance >= 0 ? Math.floor(balance) : env.STARTING_BALANCE;

  try {
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existing) {
      res.status(409).json({ error: 'Email or username already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        balance: startBalance,
        role: chosenRole,
        transactions: {
          create: {
            type: 'SIGNUP_BONUS',
            amount: startBalance,
            balanceAfter: startBalance,
            meta: { note: 'Created by admin', byAdmin: session.adminId, role: chosenRole },
          },
        },
      },
    });

    await safeLog(
      session.adminId,
      session.adminUsername,
      'CREATE_USER',
      user.id,
      user.username,
      {},
      { email: user.email, username: user.username, balance: user.balance, role: user.role },
    );

    res.status(201).json({
      ok: true,
      user: { ...publicUser(user), blocked: user.blocked, role: user.role },
    });
  } catch (err) {
    console.error('[admin/create] error:', err);
    res.status(400).json({ error: err instanceof Error ? err.message : 'create failed' });
  }
});

// ---------- Audit log ----------

adminRouter.get('/audit', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
    const rows = await prisma.adminAction.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({
      actions: rows.map((a) => ({
        id: a.id,
        adminId: a.adminId,
        adminUsername: a.adminUsername,
        targetUserId: a.targetUserId,
        targetUsername: a.targetUsername,
        action: a.action,
        beforeValue: a.beforeValue,
        afterValue: a.afterValue,
        note: a.note,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[admin/audit] error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'audit failed' });
  }
});

// ---------- Session info ----------

adminRouter.get('/me', (req, res) => {
  const session = readSession(req);
  res.json({
    adminId: session.adminId,
    adminUsername: session.adminUsername,
    viaMaster: session.viaMaster,
  });
});