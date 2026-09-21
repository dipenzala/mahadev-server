"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meRouter = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const middleware_1 = require("../auth/middleware");
const serialize_1 = require("../util/serialize");
exports.meRouter = (0, express_1.Router)();
exports.meRouter.get('/', middleware_1.requireAuth, async (req, res) => {
    const user = await db_1.prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    res.json({ user: (0, serialize_1.publicUser)(user) });
});
exports.meRouter.get('/transactions', middleware_1.requireAuth, async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const items = await db_1.prisma.transaction.findMany({
        where: { userId: req.userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
    });
    res.json({
        transactions: items.map((t) => ({
            id: t.id,
            type: t.type,
            amount: t.amount,
            balanceAfter: t.balanceAfter,
            meta: t.meta,
            createdAt: t.createdAt.toISOString(),
        })),
    });
});
exports.meRouter.get('/bets', middleware_1.requireAuth, async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const bets = await db_1.prisma.bet.findMany({
        where: { userId: req.userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { round: true },
    });
    res.json({
        bets: bets.map((b) => ({
            id: b.id,
            side: b.side,
            amount: b.amount,
            payout: b.payout,
            settled: b.settled,
            createdAt: b.createdAt.toISOString(),
            roundNo: b.round.roundNo,
            winner: b.round.winner,
            jokerCard: b.round.jokerCard,
        })),
    });
});
//# sourceMappingURL=me.js.map