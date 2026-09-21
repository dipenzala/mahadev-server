"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminAuthRouter = void 0;
exports.verifyAdminToken = verifyAdminToken;
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../db");
exports.adminAuthRouter = (0, express_1.Router)();
const sessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
function getMasterPassword() {
    return process.env.ADMIN_PASSWORD ?? 'Mahadev@2026!secure';
}
function cleanup() {
    const now = Date.now();
    for (const entry of Array.from(sessions.entries())) {
        if (now - entry[1].createdAt > SESSION_TTL_MS)
            sessions.delete(entry[0]);
    }
}
function createSession(adminId, adminUsername, viaMaster) {
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
    sessions.set(token, { createdAt: Date.now(), adminId, adminUsername, viaMaster });
    return token;
}
// ---------- Master password login ----------
exports.adminAuthRouter.post('/login-master', (req, res) => {
    const { password } = req.body;
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
exports.adminAuthRouter.post('/login-user', async (req, res) => {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string') {
        res.status(400).json({ error: 'email and password required' });
        return;
    }
    try {
        const user = await db_1.prisma.user.findUnique({ where: { email } });
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
        const ok = await bcryptjs_1.default.compare(password, user.passwordHash);
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
    }
    catch (err) {
        console.error('[admin-auth/login-user]', err);
        res.status(500).json({ error: 'Login failed' });
    }
});
// ---------- Verify ----------
exports.adminAuthRouter.post('/verify', (req, res) => {
    const { token } = req.body;
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
exports.adminAuthRouter.post('/logout', (req, res) => {
    const { token } = req.body;
    if (typeof token === 'string')
        sessions.delete(token);
    res.json({ ok: true });
});
// ---------- Server-side session utilities ----------
function verifyAdminToken(token) {
    if (!token)
        return { ok: false };
    const entry = sessions.get(token);
    if (!entry)
        return { ok: false };
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
//# sourceMappingURL=adminAuth.js.map