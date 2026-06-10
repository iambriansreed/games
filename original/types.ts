/**
 * This is the correct order of colors.
 */
export const COIN_COLORS = ['white', 'blue', 'green', 'red', 'brown', 'gold'] as const;
export type CoinColor = (typeof COIN_COLORS)[number];

export const CARD_COLORS = ['white', 'blue', 'green', 'red', 'brown'] as const;
export type CardColor = (typeof CARD_COLORS)[number];

export type Level = (typeof LEVELS)[number];

export const LEVELS = [3, 2, 1] as const;

export type Card = {
    color: CardColor;
    value?: number;
    cost: Partial<Record<CardColor, number>>;
    level: Level;
    ownerId?: Player['id'];
    reservedId?: Player['id'];
    id: string; // Unique identifier for the card
};

export type Noble = {
    cost: Partial<{
        white: number;
        blue: number;
        brown: number;
        red: number;
        green: number;
    }>;
    ownerId?: Player['id'];
    id: string; // Unique identifier for the noble
};

export type Player = {
    id: string;
    number: number;
    coins: Record<CoinColor, number>;
};

export type GameState = {
    coins: Record<CoinColor, number>;
    cards: Card[];
    nobles: Noble[];
    players: Player[];
    winner: Player['id'] | null;
};

export type TurnState = {
    cardSelected?: Card['id'];
    coinsSelected?: CoinColor[];
    coinsReturned?: CoinColor[];
    coinsToReturn?: CoinColor[];
};
