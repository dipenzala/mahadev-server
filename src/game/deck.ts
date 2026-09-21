import type { Card, Rank, Suit } from './types';

export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

export const RANKS: Rank[] = [
  'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
];

export function cardFromCode(code: string): Card {
  const suit = code.slice(-1) as Suit;
  const rank = code.slice(0, -1) as Rank;
  if (!SUITS.includes(suit) || !RANKS.includes(rank)) {
    throw new Error(`Invalid card code: ${code}`);
  }
  return { rank, suit, code };
}

export function createShuffledDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit, code: `${rank}${suit}` });
    }
  }

  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }

  return deck;
}

export function drawCard(deck: Card[]): Card {
  const card = deck.pop();
  if (!card) throw new Error('Cannot draw from an empty deck');
  return card;
}