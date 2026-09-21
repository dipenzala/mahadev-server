"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RANKS = exports.SUITS = void 0;
exports.cardFromCode = cardFromCode;
exports.createShuffledDeck = createShuffledDeck;
exports.drawCard = drawCard;
exports.SUITS = ['S', 'H', 'D', 'C'];
exports.RANKS = [
    'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
];
function cardFromCode(code) {
    const suit = code.slice(-1);
    const rank = code.slice(0, -1);
    if (!exports.SUITS.includes(suit) || !exports.RANKS.includes(rank)) {
        throw new Error(`Invalid card code: ${code}`);
    }
    return { rank, suit, code };
}
function createShuffledDeck() {
    const deck = [];
    for (const suit of exports.SUITS) {
        for (const rank of exports.RANKS) {
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
function drawCard(deck) {
    const card = deck.pop();
    if (!card)
        throw new Error('Cannot draw from an empty deck');
    return card;
}
//# sourceMappingURL=deck.js.map