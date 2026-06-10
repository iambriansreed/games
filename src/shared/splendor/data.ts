// The standard Splendor deck (90 development cards) and 10 nobles.
// Card/noble definitions adapted from the original prototype data.

import type { CardColor, Cost, Level, SplendorCard, SplendorNoble } from './types';

interface CardDef {
    color: CardColor;
    points?: number;
    cost: Cost;
    level: Level;
}

const CARD_DEFS: CardDef[] = [
    // ---- Level 1 ----
    { color: 'brown', cost: { white: 1, blue: 1, green: 1, red: 1 }, level: 1 },
    { color: 'brown', cost: { white: 1, blue: 2, green: 1, red: 1 }, level: 1 },
    { color: 'brown', cost: { white: 2, blue: 2, red: 1 }, level: 1 },
    { color: 'brown', cost: { green: 1, red: 3, brown: 1 }, level: 1 },
    { color: 'brown', cost: { green: 2, red: 1 }, level: 1 },
    { color: 'brown', cost: { white: 2, green: 2 }, level: 1 },
    { color: 'brown', cost: { green: 3 }, level: 1 },
    { color: 'brown', points: 1, cost: { blue: 4 }, level: 1 },
    { color: 'blue', cost: { white: 1, green: 1, red: 1, brown: 1 }, level: 1 },
    { color: 'blue', cost: { white: 1, green: 1, red: 2, brown: 1 }, level: 1 },
    { color: 'blue', cost: { white: 1, green: 2, red: 2 }, level: 1 },
    { color: 'blue', cost: { blue: 1, green: 3, red: 1 }, level: 1 },
    { color: 'blue', cost: { white: 1, brown: 2 }, level: 1 },
    { color: 'blue', cost: { green: 2, brown: 2 }, level: 1 },
    { color: 'blue', cost: { brown: 3 }, level: 1 },
    { color: 'blue', points: 1, cost: { red: 4 }, level: 1 },
    { color: 'white', cost: { blue: 1, green: 1, red: 1, brown: 1 }, level: 1 },
    { color: 'white', cost: { blue: 1, green: 2, red: 1, brown: 1 }, level: 1 },
    { color: 'white', cost: { blue: 2, green: 2, brown: 1 }, level: 1 },
    { color: 'white', cost: { white: 3, blue: 1, brown: 1 }, level: 1 },
    { color: 'white', cost: { red: 2, brown: 1 }, level: 1 },
    { color: 'white', cost: { blue: 2, brown: 2 }, level: 1 },
    { color: 'white', cost: { blue: 3 }, level: 1 },
    { color: 'white', points: 1, cost: { green: 4 }, level: 1 },
    { color: 'green', cost: { white: 1, blue: 1, red: 1, brown: 1 }, level: 1 },
    { color: 'green', cost: { white: 1, blue: 1, red: 1, brown: 2 }, level: 1 },
    { color: 'green', cost: { blue: 1, red: 2, brown: 2 }, level: 1 },
    { color: 'green', cost: { white: 1, blue: 3, green: 1 }, level: 1 },
    { color: 'green', cost: { white: 2, blue: 1 }, level: 1 },
    { color: 'green', cost: { blue: 2, red: 2 }, level: 1 },
    { color: 'green', cost: { red: 3 }, level: 1 },
    { color: 'green', points: 1, cost: { brown: 4 }, level: 1 },
    { color: 'red', cost: { white: 1, blue: 1, green: 1, brown: 1 }, level: 1 },
    { color: 'red', cost: { white: 2, blue: 1, green: 1, brown: 1 }, level: 1 },
    { color: 'red', cost: { white: 2, green: 1, brown: 2 }, level: 1 },
    { color: 'red', cost: { white: 1, red: 1, brown: 3 }, level: 1 },
    { color: 'red', cost: { blue: 2, green: 1 }, level: 1 },
    { color: 'red', cost: { white: 2, red: 2 }, level: 1 },
    { color: 'red', cost: { white: 3 }, level: 1 },
    { color: 'red', points: 1, cost: { white: 4 }, level: 1 },
    // ---- Level 2 ----
    { color: 'brown', points: 1, cost: { white: 3, blue: 2, green: 2 }, level: 2 },
    { color: 'brown', points: 1, cost: { white: 3, green: 3, brown: 2 }, level: 2 },
    { color: 'brown', points: 2, cost: { blue: 1, green: 4, red: 2 }, level: 2 },
    { color: 'brown', points: 2, cost: { green: 5, red: 3 }, level: 2 },
    { color: 'brown', points: 2, cost: { white: 5 }, level: 2 },
    { color: 'brown', points: 3, cost: { brown: 6 }, level: 2 },
    { color: 'blue', points: 1, cost: { blue: 2, green: 2, red: 3 }, level: 2 },
    { color: 'blue', points: 1, cost: { blue: 2, green: 3, brown: 3 }, level: 2 },
    { color: 'blue', points: 2, cost: { white: 5, blue: 3 }, level: 2 },
    { color: 'blue', points: 2, cost: { white: 2, red: 1, brown: 4 }, level: 2 },
    { color: 'blue', points: 2, cost: { blue: 5 }, level: 2 },
    { color: 'blue', points: 3, cost: { blue: 6 }, level: 2 },
    { color: 'white', points: 1, cost: { green: 3, red: 2, brown: 2 }, level: 2 },
    { color: 'white', points: 1, cost: { white: 2, blue: 3, red: 3 }, level: 2 },
    { color: 'white', points: 2, cost: { green: 1, red: 4, brown: 2 }, level: 2 },
    { color: 'white', points: 2, cost: { red: 5, brown: 3 }, level: 2 },
    { color: 'white', points: 2, cost: { red: 5 }, level: 2 },
    { color: 'white', points: 3, cost: { white: 6 }, level: 2 },
    { color: 'green', points: 1, cost: { white: 3, green: 2, red: 3 }, level: 2 },
    { color: 'green', points: 1, cost: { white: 2, blue: 3, brown: 2 }, level: 2 },
    { color: 'green', points: 2, cost: { white: 4, blue: 2, brown: 1 }, level: 2 },
    { color: 'green', points: 2, cost: { blue: 5, green: 3 }, level: 2 },
    { color: 'green', points: 2, cost: { green: 5 }, level: 2 },
    { color: 'green', points: 3, cost: { green: 6 }, level: 2 },
    { color: 'red', points: 1, cost: { white: 2, red: 2, brown: 3 }, level: 2 },
    { color: 'red', points: 1, cost: { blue: 3, red: 2, brown: 3 }, level: 2 },
    { color: 'red', points: 2, cost: { white: 1, blue: 4, green: 2 }, level: 2 },
    { color: 'red', points: 2, cost: { white: 3, brown: 5 }, level: 2 },
    { color: 'red', points: 2, cost: { brown: 5 }, level: 2 },
    { color: 'red', points: 3, cost: { red: 6 }, level: 2 },
    // ---- Level 3 ----
    { color: 'brown', points: 3, cost: { white: 3, blue: 3, green: 5, red: 3 }, level: 3 },
    { color: 'brown', points: 4, cost: { red: 7 }, level: 3 },
    { color: 'brown', points: 4, cost: { green: 3, red: 6, brown: 3 }, level: 3 },
    { color: 'brown', points: 5, cost: { red: 7, brown: 3 }, level: 3 },
    { color: 'blue', points: 3, cost: { white: 3, green: 3, red: 3, brown: 5 }, level: 3 },
    { color: 'blue', points: 4, cost: { white: 7 }, level: 3 },
    { color: 'blue', points: 4, cost: { white: 6, blue: 3, brown: 3 }, level: 3 },
    { color: 'blue', points: 5, cost: { white: 7, blue: 3 }, level: 3 },
    { color: 'white', points: 3, cost: { blue: 3, green: 3, red: 5, brown: 3 }, level: 3 },
    { color: 'white', points: 4, cost: { brown: 7 }, level: 3 },
    { color: 'white', points: 4, cost: { white: 3, red: 3, brown: 6 }, level: 3 },
    { color: 'white', points: 5, cost: { white: 3, brown: 7 }, level: 3 },
    { color: 'green', points: 3, cost: { white: 5, blue: 3, red: 3, brown: 3 }, level: 3 },
    { color: 'green', points: 4, cost: { blue: 7 }, level: 3 },
    { color: 'green', points: 4, cost: { white: 3, blue: 6, green: 3 }, level: 3 },
    { color: 'green', points: 5, cost: { blue: 7, green: 3 }, level: 3 },
    { color: 'red', points: 3, cost: { white: 3, blue: 5, green: 3, brown: 3 }, level: 3 },
    { color: 'red', points: 4, cost: { green: 7 }, level: 3 },
    { color: 'red', points: 4, cost: { blue: 3, green: 6, red: 3 }, level: 3 },
    { color: 'red', points: 5, cost: { green: 7, red: 3 }, level: 3 },
];

const NOBLE_DEFS: Cost[] = [
    { white: 3, blue: 3, green: 3 },
    { blue: 3, red: 3, green: 3 },
    { white: 3, brown: 3, red: 3 },
    { white: 3, blue: 3, brown: 3 },
    { brown: 3, red: 3, green: 3 },
    { brown: 4, red: 4 },
    { white: 4, brown: 4 },
    { red: 4, green: 4 },
    { white: 4, blue: 4 },
    { blue: 4, green: 4 },
];

export function allCards(): SplendorCard[] {
    return CARD_DEFS.map((c, i) => ({
        id: `c${i}`,
        level: c.level,
        color: c.color,
        points: c.points ?? 0,
        cost: c.cost,
    }));
}

export function allNobles(): SplendorNoble[] {
    return NOBLE_DEFS.map((cost, i) => ({ id: `n${i}`, points: 3, cost }));
}
