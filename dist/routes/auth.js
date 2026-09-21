"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const zod_1 = require("zod");
const db_1 = require("../db");
const env_1 = require("../env");
const jwt_1 = require("../auth/jwt");
const serialize_1 = require("../util/serialize");
exports.authRouter = (0, express_1.Router)();
const registerSchema = zod_1.z.object({
    email: zod_1.z.string().email().max(200),
    username: zod_1.z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/, 'Only letters, numbers, underscore'),
    password: zod_1.z.string().min(8).max(72),
});
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(1),
});
exports.authRouter.post('/register', async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
        return;
    }
    const { email, username, password } = parsed.data;
    try {
        const existing = await db_1.prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
        if (existing) {
            res.status(409).json({ error: 'Email or username already taken' });
            return;
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 12);
        const startingBalance = env_1.env.STARTING_BALANCE;
        const user = await db_1.prisma.user.create({
            data: {
                email,
                username,
                passwordHash,
                balance: startingBalance,
                transactions: {
                    create: {
                        type: 'SIGNUP_BONUS',
                        amount: startingBalance,
                        balanceAfter: startingBalance,
                        meta: { note: 'Virtual starting credits' },
                    },
                },
            },
        });
        const token = (0, jwt_1.signToken)({ sub: user.id, username: user.username });
        res.status(201).json({ token, user: (0, serialize_1.publicUser)(user) });
    }
    catch (err) {
        console.error('[auth/register] error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Registration failed' });
    }
});
exports.authRouter.post('/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input' });
        return;
    }
    const { email, password } = parsed.data;
    try {
        const user = await db_1.prisma.user.findUnique({ where: { email } });
        if (!user) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }
        if (user.blocked) {
            res.status(403).json({ error: 'Account blocked by admin' });
            return;
        }
        const ok = await bcryptjs_1.default.compare(password, user.passwordHash);
        if (!ok) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }
        const token = (0, jwt_1.signToken)({ sub: user.id, username: user.username });
        res.json({ token, user: (0, serialize_1.publicUser)(user) });
    }
    catch (err) {
        console.error('[auth/login] error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Login failed' });
    }
});
//# sourceMappingURL=auth.js.map