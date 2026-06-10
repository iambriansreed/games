// Dev-only Splendor scenario builders. Each turns an ordered list of player
// ids into a ready-to-play SplendorState that exercises a specific situation.
// Invoked from the admin dev-tools endpoint; never reachable in normal play.

import { allNobles } from './data';
import { createInitialState } from './engine';
import { Gem, Level, SplendorCard, SplendorNoble, SplendorPlayer, SplendorState } from './types';

export type SplendorScenarioKey = 'reserved-and-nobles' | 'about-to-win' | 'opponent-loaded';

export interface SplendorScenario {
    key: SplendorScenarioKey;
    label: string;
    description: string;
    /** Who occupies each seat, in seat order — drives where the admin sits. */
    seats: ('admin' | 'bot')[];
    build(playerIds: string[], nowIso: string): SplendorState;
}

function syncCounts(state: SplendorState): void {
    const d = state.decks!;
    state.deckCounts = { 1: d[1].length, 2: d[2].length, 3: d[3].length };
}

/** Pull `count` cards of a level out of the draw pile so their ids stay unique. */
function drawCards(state: SplendorState, level: Level, count: number): SplendorCard[] {
    const drawn = state.decks![level].splice(0, count);
    syncCounts(state);
    return drawn;
}

/** Nobles not already sitting face-up, so an owned noble never duplicates one. */
function freeNobles(state: SplendorState, count: number): SplendorNoble[] {
    const used = new Set(state.nobles.map((n) => n.id));
    return allNobles()
        .filter((n) => !used.has(n.id))
        .slice(0, count);
}

function recount(player: SplendorPlayer): void {
    player.points =
        player.cards.reduce((s, c) => s + c.points, 0) +
        player.nobles.reduce((s, n) => s + n.points, 0);
}

function tokens(partial: Partial<Record<Gem, number>>): Record<Gem, number> {
    return { white: 0, blue: 0, green: 0, red: 0, brown: 0, gold: 0, ...partial };
}

export const SPLENDOR_SCENARIOS: SplendorScenario[] = [
    {
        key: 'reserved-and-nobles',
        label: 'You: 3 reserved cards + 3 nobles',
        description: "It's your turn and you hold 3 reserved cards and 3 nobles.",
        seats: ['admin', 'bot'],
        build(ids, now) {
            const s = createInitialState(ids, now);
            const me = s.players[0];
            me.reserved = [...drawCards(s, 1, 1), ...drawCards(s, 2, 1), ...drawCards(s, 3, 1)];
            me.nobles = freeNobles(s, 3);
            me.tokens = tokens({ gold: 3, blue: 2, white: 1 });
            recount(me);
            s.current = 0;
            s.log.push('[dev] Loaded: current player has 3 reserved cards and 3 nobles.');
            return s;
        },
    },
    {
        key: 'about-to-win',
        label: 'Your next move wins',
        description: "It's your turn, you have the most points, and any move ends the game in your win.",
        seats: ['bot', 'admin'],
        build(ids, now) {
            const s = createInitialState(ids, now);
            const last = s.players.length - 1;
            const winner = s.players[last];
            // Five level-3 cards guarantee ≥15 points; finalRound + last seat
            // means the very next action wraps to seat 0 and finishes the game.
            winner.cards = drawCards(s, 3, 5);
            winner.tokens = tokens({ white: 3, blue: 3, green: 3, red: 3, brown: 3, gold: 5 });
            recount(winner);
            s.current = last;
            s.finalRound = true;
            s.log.push('[dev] Loaded: it is your turn and any move wins the game.');
            return s;
        },
    },
    {
        key: 'opponent-loaded',
        label: '1v1: opponent has reserves + nobles',
        description: "A 2-player game where the other player holds reserved cards and nobles.",
        seats: ['admin', 'bot'],
        build(ids, now) {
            const s = createInitialState(ids, now);
            const opp = s.players[1];
            opp.cards = [...drawCards(s, 1, 2), ...drawCards(s, 2, 2)];
            opp.reserved = [...drawCards(s, 2, 1), ...drawCards(s, 3, 2)];
            opp.nobles = freeNobles(s, 2);
            opp.tokens = tokens({ white: 2, blue: 1, green: 2, brown: 1, gold: 2 });
            recount(opp);
            s.current = 0;
            s.log.push('[dev] Loaded: 1v1 where the opponent has reserved cards and nobles.');
            return s;
        },
    },
];

export function getScenario(key: string): SplendorScenario | null {
    return SPLENDOR_SCENARIOS.find((s) => s.key === key) ?? null;
}
