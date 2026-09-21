import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { cardFromCode } from './deck';
import type { AdminPick, BetSide, Card, CardTotal, PlayerBet, PublicState } from './types';

export interface SettleEvent {
  betId: string;
  userId: string;
  side: BetSide;
  code: string;
  amount: number;
  payout: number;
  won: boolean;
}

class RoundManager extends EventEmitter {
  private joker: Card | null = null;
  private andarCards: AdminPick[] = [];
  private baharCards: AdminPick[] = [];
  private playerBets: PlayerBet[] = [];
  private version = 0;
  private resetAt = Date.now();

  private computeTotals(): CardTotal[] {
    const map = new Map<string, CardTotal>();
    for (const b of this.playerBets) {
      if (b.settled) continue;
      let row = map.get(b.code);
      if (!row) {
        row = { code: b.code, andar: 0, bahar: 0 };
        map.set(b.code, row);
      }
      if (b.side === 'ANDAR') row.andar += b.amount;
      else row.bahar += b.amount;
    }
    return Array.from(map.values());
  }

  getPublicState(): PublicState {
    return {
      joker: this.joker,
      andarCards: this.andarCards,
      baharCards: this.baharCards,
      playerBets: this.playerBets,
      totals: this.computeTotals(),
      serverTime: Date.now(),
      version: this.version,
      resetAt: this.resetAt,
    };
  }

  /** Return only the bets placed by a specific user, newest first */
  getUserBetHistory(userId: string): PlayerBet[] {
    return this.playerBets
      .filter((b) => b.userId === userId)
      .slice()
      .sort((a, b) => b.at - a.at);
  }

  private bump(): void {
    this.version += 1;
    this.emit('update');
  }

  setJoker(code: string | null): void {
    if (!code) this.joker = null;
    else this.joker = cardFromCode(code);
    this.bump();
  }

  markCard(code: string, side: BetSide): SettleEvent[] {
    this.andarCards = this.andarCards.filter((p) => p.code !== code);
    this.baharCards = this.baharCards.filter((p) => p.code !== code);
    const pick: AdminPick = { code, side, markedAt: Date.now() };
    if (side === 'ANDAR') this.andarCards = [...this.andarCards, pick];
    else this.baharCards = [...this.baharCards, pick];

    const settleEvents: SettleEvent[] = [];
    const now = Date.now();
    this.playerBets = this.playerBets.map((b) => {
      if (b.code !== code || b.settled) return b;
      const won = b.side === side;
      const payout = won ? b.amount * 2 : 0;
      settleEvents.push({
        betId: b.id,
        userId: b.userId,
        side: b.side,
        code: b.code,
        amount: b.amount,
        payout,
        won,
      });
      return { ...b, settled: true, won, payout, settledAt: now };
    });

    this.bump();
    if (settleEvents.length > 0) this.emit('settled', settleEvents);
    return settleEvents;
  }

  unmarkCard(code: string): void {
    this.andarCards = this.andarCards.filter((p) => p.code !== code);
    this.baharCards = this.baharCards.filter((p) => p.code !== code);
    this.bump();
  }

  placeBet(userId: string, username: string, code: string, side: BetSide, amount: number): PlayerBet {
    const alreadyMarked =
      this.andarCards.some((p) => p.code === code) ||
      this.baharCards.some((p) => p.code === code);
    if (alreadyMarked) throw new Error('This card is already settled on the table');

    const bet: PlayerBet = {
      id: randomUUID(),
      userId,
      username,
      code,
      side,
      amount,
      at: Date.now(),
      settled: false,
      won: null,
      payout: 0,
      settledAt: null,
    };
    this.playerBets = [...this.playerBets, bet];
    this.bump();
    return bet;
  }

  reset(): void {
    this.joker = null;
    this.andarCards = [];
    this.baharCards = [];
    this.playerBets = [];
    this.resetAt = Date.now();
    this.bump();
  }
}

export const roundManager = new RoundManager();