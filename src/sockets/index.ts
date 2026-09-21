import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { env } from '../env';
import { verifyToken } from '../auth/jwt';
import { roundManager, type SettleEvent } from '../game/roundManager';
import { verifyAdminToken } from '../routes/adminAuth';
import { prisma } from '../db';
import type { BetSide } from '../game/types';

export function initSockets(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    const adminToken = socket.handshake.auth?.adminToken as string | undefined;

    // Admin session (from admin panel)
    if (adminToken) {
      const session = verifyAdminToken(adminToken);
      if (session.ok) {
        socket.data.userId = 'admin:' + (session.adminId ?? 'unknown');
        socket.data.username = session.adminUsername ?? 'Admin';
        socket.data.isAdmin = true;
        next();
        return;
      }
    }

    // Regular user JWT
    if (!token) {
      socket.data.userId = 'anonymous';
      socket.data.username = 'anonymous';
      socket.data.isAdmin = false;
      next();
      return;
    }
    try {
      const payload = verifyToken(token);
      socket.data.userId = payload.sub;
      socket.data.username = payload.username;
      socket.data.isAdmin = false;
      next();
    } catch (err) {
      console.error('[socket/auth] verify failed:', err);
      socket.data.userId = 'anonymous';
      socket.data.username = 'anonymous';
      socket.data.isAdmin = false;
      next();
    }
  });

  io.on('connection', async (socket: Socket) => {
    const userId = socket.data.userId as string;
    const username = socket.data.username as string;
    const isAdmin = socket.data.isAdmin as boolean;

    console.log('[socket] connected:', socket.id, 'userId=', userId, 'isAdmin=', isAdmin);

    // Admin connections skip the user-block check
    if (!isAdmin && userId !== 'anonymous') {
      try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user || user.blocked) {
          socket.emit('account:blocked');
          socket.disconnect(true);
          return;
        }
      } catch (err) {
        console.error('[socket/auth] db check failed:', err);
      }
    }

    socket.join('table');
    if (!isAdmin && userId !== 'anonymous') {
      socket.join('user:' + userId);
      socket.emit('my-bet-history', roundManager.getUserBetHistory(userId));
    }

    socket.emit('state', roundManager.getPublicState());

    socket.on('state:request', () => {
      socket.emit('state', roundManager.getPublicState());
    });

    socket.on(
      'bet:place',
      async (
        payload: { code?: string; side?: string; amount?: number } | undefined,
        ack?: (response: unknown) => void,
      ) => {
        try {
          const code = payload?.code;
          const side = payload?.side;
          const amount = payload?.amount;

          if (typeof code !== 'string' || (side !== 'ANDAR' && side !== 'BAHAR')) {
            ack?.({ ok: false, error: 'code and side required' });
            return;
          }
          if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
            ack?.({ ok: false, error: 'amount must be positive' });
            return;
          }
          if (isAdmin || userId === 'anonymous') {
            ack?.({ ok: false, error: 'login as user to bet' });
            return;
          }

          const betSide: BetSide = side;

          const result = await prisma.$transaction(async (tx) => {
            const user = await tx.user.findUnique({ where: { id: userId } });
            if (!user) throw new Error('User not found');
            if (user.blocked) throw new Error('Account blocked');
            if (user.balance < amount) throw new Error('Insufficient credits');

            const updated = await tx.user.update({
              where: { id: userId },
              data: { balance: { decrement: amount } },
            });

            await tx.transaction.create({
              data: {
                userId,
                type: 'BET_PLACED',
                amount: -amount,
                balanceAfter: updated.balance,
                meta: { code, side: betSide },
              },
            });

            return { balance: updated.balance };
          });

          try {
            roundManager.placeBet(userId, username, code, betSide, amount);
          } catch (err) {
            const refund = await prisma.$transaction(async (tx) => {
              const u = await tx.user.update({
                where: { id: userId },
                data: { balance: { increment: amount } },
              });
              await tx.transaction.create({
                data: {
                  userId,
                  type: 'BET_REFUND',
                  amount,
                  balanceAfter: u.balance,
                  meta: { code, side: betSide, reason: 'REJECTED' },
                },
              });
              return u.balance;
            });
            ack?.({
              ok: false,
              error: err instanceof Error ? err.message : 'bet rejected',
              balance: refund,
            });
            socket.emit('balance', { balance: refund });
            return;
          }

          ack?.({ ok: true, balance: result.balance });
          socket.emit('balance', { balance: result.balance });
          socket.emit('my-bet-history', roundManager.getUserBetHistory(userId));
        } catch (err) {
          console.error('[socket] bet:place ERROR:', err);
          const message = err instanceof Error ? err.message : 'Unknown error';
          ack?.({ ok: false, error: message });
        }
      },
    );
  });

  roundManager.on('update', () => {
    io.to('table').emit('state', roundManager.getPublicState());
  });

  roundManager.on('settled', (events: SettleEvent[]) => {
    const affected = new Set<string>();
    for (const ev of events) {
      io.to('user:' + ev.userId).emit('bet:result', ev);
      affected.add(ev.userId);
    }
    for (const uid of affected) {
      io.to('user:' + uid).emit('my-bet-history', roundManager.getUserBetHistory(uid));
    }
    io.to('table').emit('state', roundManager.getPublicState());
  });

  return io;
}