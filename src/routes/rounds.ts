import { Router } from 'express';
import { prisma } from '../db';

export const roundsRouter = Router();

roundsRouter.get('/recent', async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 20) || 20, 100);

  const rounds = await prisma.round.findMany({
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