export type Suit = 'S' | 'H' | 'D' | 'C';

export type Rank =
  | 'A' | '2' | '3' | '4' | '5' | '6' | '7'
  | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  rank: Rank;
  suit: Suit;
  code: string;
}

export type BetSide = 'ANDAR' | 'BAHAR';

export interface AdminPick {
  code: string;
  side: BetSide;
  markedAt: number;
}

export interface PlayerBet {
  id: string;
  userId: string;
  username: string;
  code: string;
  side: BetSide;
  amount: number;
  at: number;
  settled: boolean;
  won: boolean | null;
  payout: number;
  settledAt: number | null;
}

export interface CardTotal {
  code: string;
  andar: number;
  bahar: number;
}

export interface PublicState {
  joker: Card | null;
  andarCards: AdminPick[];
  baharCards: AdminPick[];
  playerBets: PlayerBet[];
  totals: CardTotal[];
  serverTime: number;
  version: number;
  resetAt: number;
}