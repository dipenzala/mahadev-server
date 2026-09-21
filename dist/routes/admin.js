"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const roundManager_1 = require("../game/roundManager");
const db_1 = require("../db");
const env_1 = require("../env");
const serialize_1 = require("../util/serialize");
const adminAuth_1 = require("./adminAuth");
exports.adminRouter = (0, express_1.Router)();
// ---------- Auth guard ----------
exports.adminRouter.use((req, res, next) => {
    // Allow read-only state endpoint without auth
    if (req.path === '/state' && req.method === 'GET') {
        next();
        return;
    }
    const token = req.headers['x-admin-token'] ??
        req.headers['x-admin-session'];
    const session = (0, adminAuth_1.verifyAdminToken)(token);
    if (!session.ok) {
        res.status(401).json({ error: 'Admin authentication required' });
        return;
    }
    req.adminSession = session;
    next();
});
function readSession(req) {
    const r = req;
    if (r.adminSession)
        return r.adminSession;
    return { adminId: 'unknown', adminUsername: 'Unknown', viaMaster: false };
}
async function safeLog(adminId, adminUsername, action, targetUserId, targetUsername, beforeValue, afterValue, note) {
    try {
        await db_1.prisma.adminAction.create({
            data: {
                adminId,
                adminUsername,
                targetUserId: targetUserId ?? null,
                targetUsername: targetUsername ?? null,
                action,
                beforeValue: (beforeValue ?? {}),
                afterValue: (afterValue ?? {}),
                note: note ?? null,
            },
        });
    }
    catch (err) {
        console.error('[audit] failed:', err);
    }
}
// ---------- Round state ----------
exports.adminRouter.get('/state', (_req, res) => {
    res.json({ state: roundManager_1.roundManager.getPublicState() });
});
exports.adminRouter.post('/joker', (req, res) => {
    const { code } = req.body;
    roundManager_1.roundManager.setJoker(code ?? null);
    res.json({ ok: true });
});
exports.adminRouter.post('/mark', async (req, res) => {
    const { code, side } = req.body;
    if (!code || (side !== 'ANDAR' && side !== 'BAHAR')) {
        res.status(400).json({ error: 'code and side required' });
        return;
    }
    let events;
    try {
        events = roundManager_1.roundManager.markCard(code, side);
    }
    catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'mark failed' });
        return;
    }
    if (events.length > 0) {
        try {
            await db_1.prisma.$transaction(async (tx) => {
                for (const ev of events) {
                    if (!ev.won)
                        continue;
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
        }
        catch (err) {
            res.status(500).json({ error: err instanceof Error ? err.message : 'payout failed' });
            return;
        }
    }
    res.json({ ok: true, settled: events.length });
});
exports.adminRouter.post('/unmark', (req, res) => {
    const { code } = req.body;
    if (!code) {
        res.status(400).json({ error: 'code required' });
        return;
    }
    roundManager_1.roundManager.unmarkCard(code);
    res.json({ ok: true });
});
exports.adminRouter.post('/reset', (_req, res) => {
    roundManager_1.roundManager.reset();
    res.json({ ok: true });
});
// ---------- Users list ----------
exports.adminRouter.get('/users', async (_req, res) => {
    try {
        const users = await db_1.prisma.user.findMany({
            orderBy: { createdAt: 'desc' },
            take: 500,
        });
        res.json({
            users: users.map((u) => ({
                ...(0, serialize_1.publicUser)(u),
                blocked: u.blocked,
                role: u.role,
            })),
        });
    }
    catch (err) {
        console.error('[admin/users] error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'list failed' });
    }
});
// ---------- Balance adjust ----------
exports.adminRouter.post('/users/:id/balance', async (req, res) => {
    const session = readSession(req);
    const { id } = req.params;
    const { amount, mode, note } = req.body;
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
        res.status(400).json({ error: 'amount must be a number' });
        return;
    }
    const m = mode === 'add' ? 'add' : 'set';
    try {
        const result = await db_1.prisma.$transaction(async (tx) => {
            const user = await tx.user.findUnique({ where: { id } });
            if (!user)
                throw new Error('User not found');
            const newBalance = m === 'set'
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
        await safeLog(session.adminId, session.adminUsername, 'ADJUST_BALANCE', result.user.id, result.user.username, { previous: result.previous, mode: m, requested: amount }, { newBalance: result.user.balance }, note);
        res.json({
            ok: true,
            user: { ...(0, serialize_1.publicUser)(result.user), blocked: result.user.blocked, role: result.user.role },
        });
    }
    catch (err) {
        console.error('[admin/balance] error:', err);
        res.status(400).json({ error: err instanceof Error ? err.message : 'balance update failed' });
    }
});
// ---------- Block / Unblock ----------
exports.adminRouter.post('/users/:id/block', async (req, res) => {
    const session = readSession(req);
    const { id } = req.params;
    const { blocked, note } = req.body;
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
        const before = await db_1.prisma.user.findUnique({ where: { id } });
        if (!before) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const u = await db_1.prisma.user.update({ where: { id }, data: { blocked } });
        await safeLog(session.adminId, session.adminUsername, blocked ? 'BLOCK_USER' : 'UNBLOCK_USER', u.id, u.username, { blocked: before.blocked }, { blocked: u.blocked }, note);
        res.json({ ok: true, user: { ...(0, serialize_1.publicUser)(u), blocked: u.blocked, role: u.role } });
    }
    catch (err) {
        console.error('[admin/block] error:', err);
        res.status(400).json({ error: err instanceof Error ? err.message : 'failed' });
    }
});
// ---------- Change user role ----------
exports.adminRouter.post('/users/:id/role', async (req, res) => {
    const session = readSession(req);
    const { id } = req.params;
    const { role, note } = req.body;
    if (role !== 'CLIENT' && role !== 'ADMIN') {
        res.status(400).json({ error: 'role must be CLIENT or ADMIN' });
        return;
    }
    if (id === session.adminId) {
        res.status(400).json({ error: 'Cannot change your own role' });
        return;
    }
    try {
        const before = await db_1.prisma.user.findUnique({ where: { id } });
        if (!before) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        // Prevent removing the last admin
        if (before.role === 'ADMIN' && role === 'CLIENT') {
            const adminCount = await db_1.prisma.user.count({ where: { role: 'ADMIN' } });
            if (adminCount <= 1) {
                res.status(400).json({ error: 'Cannot remove last admin' });
                return;
            }
        }
        const u = await db_1.prisma.user.update({ where: { id }, data: { role } });
        await safeLog(session.adminId, session.adminUsername, role === 'ADMIN' ? 'PROMOTE_TO_ADMIN' : 'DEMOTE_TO_CLIENT', u.id, u.username, { role: before.role }, { role: u.role }, note);
        res.json({ ok: true, user: { ...(0, serialize_1.publicUser)(u), blocked: u.blocked, role: u.role } });
    }
    catch (err) {
        console.error('[admin/role] error:', err);
        res.status(400).json({ error: err instanceof Error ? err.message : 'role change failed' });
    }
});
// ---------- Delete user ----------
exports.adminRouter.delete('/users/:id', async (req, res) => {
    const session = readSession(req);
    const { id } = req.params;
    // Cannot delete yourself
    if (id === session.adminId) {
        res.status(400).json({ error: 'Cannot delete yourself' });
        return;
    }
    try {
        const before = await db_1.prisma.user.findUnique({ where: { id } });
        if (!before) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        // Prevent removing the last admin
        if (before.role === 'ADMIN') {
            const adminCount = await db_1.prisma.user.count({ where: { role: 'ADMIN' } });
            if (adminCount <= 1) {
                res.status(400).json({ error: 'Cannot delete last admin' });
                return;
            }
        }
        await db_1.prisma.user.delete({ where: { id } });
        await safeLog(session.adminId, session.adminUsername, 'DELETE_USER', id, before.username, {
            email: before.email,
            username: before.username,
            balance: before.balance,
            blocked: before.blocked,
            role: before.role,
        }, { deleted: true });
        res.json({ ok: true });
    }
    catch (err) {
        console.error('[admin/delete] error:', err);
        res.status(400).json({ error: err instanceof Error ? err.message : 'delete failed' });
    }
});
// ---------- Create user (with role) ----------
exports.adminRouter.post('/users', async (req, res) => {
    const session = readSession(req);
    const { email, username, password, balance, role } = req.body;
    if (!email || !username || !password) {
        res.status(400).json({ error: 'email, username, password required' });
        return;
    }
    if (password.length < 8) {
        res.status(400).json({ error: 'password must be at least 8 characters' });
        return;
    }
    const chosenRole = role === 'ADMIN' ? 'ADMIN' : 'CLIENT';
    const startBalance = typeof balance === 'number' && balance >= 0 ? Math.floor(balance) : env_1.env.STARTING_BALANCE;
    try {
        const existing = await db_1.prisma.user.findFirst({
            where: { OR: [{ email }, { username }] },
        });
        if (existing) {
            res.status(409).json({ error: 'Email or username already exists' });
            return;
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 12);
        const user = await db_1.prisma.user.create({
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
        await safeLog(session.adminId, session.adminUsername, 'CREATE_USER', user.id, user.username, {}, { email: user.email, username: user.username, balance: user.balance, role: user.role });
        res.status(201).json({
            ok: true,
            user: { ...(0, serialize_1.publicUser)(user), blocked: user.blocked, role: user.role },
        });
    }
    catch (err) {
        console.error('[admin/create] error:', err);
        res.status(400).json({ error: err instanceof Error ? err.message : 'create failed' });
    }
});
// ---------- Audit log ----------
exports.adminRouter.get('/audit', async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
        const rows = await db_1.prisma.adminAction.findMany({
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
    }
    catch (err) {
        console.error('[admin/audit] error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'audit failed' });
    }
});
// ---------- Session info ----------
exports.adminRouter.get('/me', (req, res) => {
    const session = readSession(req);
    res.json({
        adminId: session.adminId,
        adminUsername: session.adminUsername,
        viaMaster: session.viaMaster,
    });
});
//# sourceMappingURL=admin.js.map