import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { env } from './env';
import { authRouter } from './routes/auth';
import { meRouter } from './routes/me';
import { roundsRouter } from './routes/rounds';
import { adminRouter } from './routes/admin';
import { adminAuthRouter } from './routes/adminAuth';
import { initSockets } from './sockets';
import { prisma } from './db';

const app = express();

app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '100kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'andar-bahar', time: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/me', meRouter);
app.use('/api/rounds', roundsRouter);
app.use('/api/admin-auth', adminAuthRouter);
app.use('/api/admin', adminRouter);

const server = http.createServer(app);
initSockets(server);

server.listen(env.PORT, () => {
  console.log('[server] HTTP + Socket.IO listening on http://localhost:' + env.PORT);
  console.log('[server] admin-driven mode — no auto timer');
});

async function shutdown(signal: string): Promise<void> {
  console.log('[server] received ' + signal + ', shutting down');
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));