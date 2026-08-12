// Splendor domain types. Token/gem ordering follows the original game.

export const GEMS = ['white', 'blue', 'green', 'red', 'brown', 'gold'] as const;
export type Gem = (typeof GEMS)[number];

export const CARD_COLORS = ['white', 'blue', 'green', 'red', 'brown'] as const;
export type CardColor = (typeof CARD_COLORS)[number];

export const LEVELS = [3, 2, 1] as const;
export type Level = (typeof LEVELS)[number];

export type Cost = Partial<Record<CardColor, number>>;

export interface SplendorCard {
    id: string;
    level: Level;
    color: CardColor;
    points: number;
    cost: Cost;
}

/** Redacted reserved card shown to opponents (they see a card exists, not which). */
export interface HiddenCard {
    id: string;
    level: Level;
    hidden: true;
}

export interface SplendorNoble {
    id: string;
    points: number;
    cost: Cost;
}

export interface SplendorPlayer {
    id: string;
    tokens: Record<Gem, number>;
    /** Purchased development cards (provide bonuses + prestige). */
    cards: SplendorCard[];
    /** Reserved cards (max 3). Opponents see these as HiddenCard. */
    reserved: (SplendorCard | HiddenCard)[];
    nobles: SplendorNoble[];
    points: number;
}

export interface SplendorState {
    players: SplendorPlayer[];
    bank: Record<Gem, number>;
    /** Face-up cards on the board, 4 per level (null = empty slot, deck exhausted). */
    board: Record<Level, (SplendorCard | null)[]>;
    /** Face-down draw piles. Present in server state; redacted to counts in views. */
    decks?: Record<Level, SplendorCard[]>;
    deckCounts: Record<Level, number>;
    nobles: SplendorNoble[];
    /** Seat index of the player to move. */
    current: number;
    /**
     * Seat that opened the game, chosen at random rather than always seat 0.
     * The final round ends when play wraps back around to this seat.
     */
    startSeat: number;
    turn: number;
    log: string[];
    winnerId: string | null;
    /** Set once a player reaches the points goal; the round is then finished. */
    finalRound: boolean;
    /**
     * When a purchase leaves more than one noble eligible, the player must pick
     * one before the turn ends. Holds the seat and the eligible noble ids.
     */
    pendingNoble: { seat: number; options: string[] } | null;
    startedAt: string;
}

export type SplendorAction =
    | { type: 'take'; gems: Gem[]; returns?: Gem[] }
    | { type: 'reserve'; cardId?: string; level?: Level; returns?: Gem[] }
    | { type: 'buy'; cardId: string }
    | { type: 'chooseNoble'; nobleId: string }
    /** Pass without acting — only legal on your opening turn (see canSkip). */
    | { type: 'skip' };
