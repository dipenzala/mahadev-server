import type { User } from '@prisma/client';

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  balance: number;
  role: string;
  createdAt: string;
}

export function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    balance: user.balance,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}