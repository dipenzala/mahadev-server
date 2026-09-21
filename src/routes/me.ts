import { Router } from 'express';
import { prisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { publicUser } from '../util/serialize';

export const meRouter = Router();

meRouter.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ user: publicUser(user) });
});

meRouter.get('/transactions', requireAuth, async (req: AuthedRequest, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);

  const items = await prisma.transaction.findMany({
    where: { userId: req.userId! },
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

meRouter.get('/bets', requireAuth, async (req: AuthedRequest, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);

  const bets = await prisma.bet.findMany({
    where: { userId: req.userId! },
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