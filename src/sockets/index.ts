import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { env } from '../env';
import { verifyToken } from '../auth/jwt';
import { roundManager, type SettleEvent } from '../game/roundManager';
import { verifyAdminToken } from '../routes/adminAuth';
import { prisma } from '../db';
import type { BetSide } from '../game/types';

export function initSockets(httpServer: HttpServer): Server {
  console.log('[socket] initializing with CLIENT_ORIGIN:', env.CLIENT_ORIGIN);

  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Allow all origins in production temporarily to debug
        // Later restrict to env.CLIENT_ORIGIN
        console.log('[socket/cors] origin:', origin);
        callback(null, true);
      },
      credentials: true,
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    const adminToken = socket.handshake.auth?.adminToken as string | undefined;

    console.log('[socket/auth] handshake', socket.id, 'hasToken=', !!token, 'hasAdminToken=', !!adminToken);

    // Admin session (from admin panel)
    if (adminToken) {
      const session = verifyAdminToken(adminToken);
      if (session.ok) {
        socket.data.userId = 'admin:' + (session.adminId ?? 'unknown');
        socket.data.username = session.adminUsername ?? 'Admin';
        socket.data.isAdmin = true;
        console.log('[socket/auth] admin authenticated:', socket.data.userId);
        next();
        return;
      } else {
        console.log('[socket/auth] admin token invalid');
      }
    }

    // Regular user JWT
    if (!token) {
      socket.data.userId = 'anonymous';
      socket.data.username = 'anonymous';
      socket.data.isAdmin = false;
      console.log('[socket/auth] anonymous connection');
      next();
      return;
    }

    try {
      const payload = verifyToken(token);
      socket.data.userId = payload.sub;
      socket.data.username = payload.username;
      socket.data.isAdmin = false;
      console.log('[socket/auth] user authenticated:', payload.sub, payload.username);
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

    // ─────────────────────────────────────────────────────
    // WebRTC Live Video Signaling
    // ─────────────────────────────────────────────────────

    socket.on('webrtc-offer', (data: { offer: unknown; to?: string }) => {
      console.log('[webrtc] offer from', socket.id, 'to', data.to);
      socket.broadcast.emit('webrtc-offer', {
        offer: data.offer,
        from: socket.id,
      });
    });

    socket.on('webrtc-answer', (data: { answer: unknown; to?: string }) => {
      console.log('[webrtc] answer from', socket.id, 'to', data.to);
      socket.broadcast.emit('webrtc-answer', {
        answer: data.answer,
        from: socket.id,
      });
    });

    socket.on('webrtc-ice', (data: { candidate: unknown; to?: string }) => {
      socket.broadcast.emit('webrtc-ice', {
        candidate: data.candidate,
        from: socket.id,
      });
    });

    socket.on('player-joined', () => {
      console.log('[webrtc] player joined:', socket.id);
      socket.broadcast.emit('player-joined', { from: socket.id });
    });

    socket.on('disconnect', (reason) => {
      console.log('[webrtc] disconnected:', socket.id, 'reason:', reason);
      socket.broadcast.emit('webrtc-peer-disconnected', { from: socket.id });
    });
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