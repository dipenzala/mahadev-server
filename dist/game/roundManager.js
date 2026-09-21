"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roundManager = void 0;
const node_events_1 = require("node:events");
const node_crypto_1 = require("node:crypto");
const deck_1 = require("./deck");
class RoundManager extends node_events_1.EventEmitter {
    joker = null;
    andarCards = [];
    baharCards = [];
    playerBets = [];
    version = 0;
    resetAt = Date.now();
    computeTotals() {
        const map = new Map();
        for (const b of this.playerBets) {
            if (b.settled)
                continue;
            let row = map.get(b.code);
            if (!row) {
                row = { code: b.code, andar: 0, bahar: 0 };
                map.set(b.code, row);
            }
            if (b.side === 'ANDAR')
                row.andar += b.amount;
            else
                row.bahar += b.amount;
        }
        return Array.from(map.values());
    }
    getPublicState() {
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
    getUserBetHistory(userId) {
        return this.playerBets
            .filter((b) => b.userId === userId)
            .slice()
            .sort((a, b) => b.at - a.at);
    }
    bump() {
        this.version += 1;
        this.emit('update');
    }
    setJoker(code) {
        if (!code)
            this.joker = null;
        else
            this.joker = (0, deck_1.cardFromCode)(code);
        this.bump();
    }
    markCard(code, side) {
        this.andarCards = this.andarCards.filter((p) => p.code !== code);
        this.baharCards = this.baharCards.filter((p) => p.code !== code);
        const pick = { code, side, markedAt: Date.now() };
        if (side === 'ANDAR')
            this.andarCards = [...this.andarCards, pick];
        else
            this.baharCards = [...this.baharCards, pick];
        const settleEvents = [];
        const now = Date.now();
        this.playerBets = this.playerBets.map((b) => {
            if (b.code !== code || b.settled)
                return b;
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
        if (settleEvents.length > 0)
            this.emit('settled', settleEvents);
        return settleEvents;
    }
    unmarkCard(code) {
        this.andarCards = this.andarCards.filter((p) => p.code !== code);
        this.baharCards = this.baharCards.filter((p) => p.code !== code);
        this.bump();
    }
    placeBet(userId, username, code, side, amount) {
        const alreadyMarked = this.andarCards.some((p) => p.code === code) ||
            this.baharCards.some((p) => p.code === code);
        if (alreadyMarked)
            throw new Error('This card is already settled on the table');
        const bet = {
            id: (0, node_crypto_1.randomUUID)(),
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
    reset() {
        this.joker = null;
        this.andarCards = [];
        this.baharCards = [];
        this.playerBets = [];
        this.resetAt = Date.now();
        this.bump();
    }
}
exports.roundManager = new RoundManager();
//# sourceMappingURL=roundManager.js.map