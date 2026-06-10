import {
    CardColor,
    CARD_COLORS,
    Gem,
    HiddenCard,
    SplendorCard,
    SplendorPlayer,
} from '../../../shared/splendor/types';

export const GEM_HEX: Record<Gem, string> = {
    white: '#e9e6dd',
    blue: '#5a8fd6',
    green: '#4f9d6b',
    red: '#c0392b',
    brown: '#8a6a44',
    gold: '#d9b44a',
};

export const GEM_TEXT: Record<Gem, string> = {
    white: '#2b2f38',
    blue: '#ffffff',
    green: '#ffffff',
    red: '#ffffff',
    brown: '#ffffff',
    gold: '#3a2c06',
};

export const TOKEN_LIMIT = 10;

export function isHidden(c: SplendorCard | HiddenCard): c is HiddenCard {
    return 'hidden' in c;
}

export function bonuses(player: SplendorPlayer): Record<CardColor, number> {
    const b: Record<CardColor, number> = { white: 0, blue: 0, green: 0, red: 0, brown: 0 };
    for (const c of player.cards) b[c.color]++;
    return b;
}

export function totalTokens(player: SplendorPlayer): number {
    return (
        player.tokens.white +
        player.tokens.blue +
        player.tokens.green +
        player.tokens.red +
        player.tokens.brown +
        player.tokens.gold
    );
}

/** Can `player` afford `card` with bonuses + tokens (+ gold wild)? */
export function canAfford(player: SplendorPlayer, card: SplendorCard): boolean {
    const b = bonuses(player);
    let goldNeeded = 0;
    for (const color of CARD_COLORS) {
        const need = Math.max(0, (card.cost[color] ?? 0) - b[color]);
        goldNeeded += Math.max(0, need - player.tokens[color]);
    }
    return goldNeeded <= player.tokens.gold;
}
