"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roundsRouter = void 0;
const express_1 = require("express");
const db_1 = require("../db");
exports.roundsRouter = (0, express_1.Router)();
exports.roundsRouter.get('/recent', async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 100);
    const rounds = await db_1.prisma.round.findMany({
        where: { status: 'SETTLED', winner: { not: null } },
        orderBy: { roundNo: 'desc' },
        take: limit,
    });
    res.json({
        rounds: rounds.map((r) => ({
            id: r.id,
            roundNo: r.roundNo,
            jokerCard: r.jokerCard,
            jokerRank: r.jokerRank,
            winner: r.winner,
            settledAt: r.settledAt ? r.settledAt.toISOString() : null,
        })),
    });
});
//# sourceMappingURL=rounds.js.map