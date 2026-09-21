import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { env } from '../env';
import { signToken } from '../auth/jwt';
import { publicUser } from '../util/serialize';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email().max(200),
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/, 'Only letters, numbers, underscore'),
  password: z.string().min(8).max(72),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }

  const { email, username, password } = parsed.data;

  try {
    const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
    if (existing) {
      res.status(409).json({ error: 'Email or username already taken' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const startingBalance = env.STARTING_BALANCE;

    const user = await prisma.user.create({
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

    const token = signToken({ sub: user.id, username: user.username });
    res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    console.error('[auth/register] error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Registration failed' });
  }
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }

  const { email, password } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    if (user.blocked) {
      res.status(403).json({ error: 'Account blocked by admin' });
      return;
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = signToken({ sub: user.id, username: user.username });
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error('[auth/login] error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Login failed' });
  }
});