// Server-authoritative Splendor rules engine. Pure functions: applyAction
// returns a new state and throws an Error on any illegal move.

import { allCards, allNobles } from './data';
import {
    CARD_COLORS,
    CardColor,
    Gem,
    GEMS,
    HiddenCard,
    Level,
    LEVELS,
    SplendorAction,
    SplendorCard,
    SplendorPlayer,
    SplendorState,
} from './types';

export const POINTS_GOAL = 15;
export const TOKEN_LIMIT = 10;
export const RESERVE_MAX = 3;
export const SPLENDOR_MIN_PLAYERS = 2;
export const SPLENDOR_MAX_PLAYERS = 4;

const BANK_BY_PLAYERS: Record<number, number> = { 2: 4, 3: 5, 4: 7 };

function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
}

function shuffle<T>(arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function emptyTokens(): Record<Gem, number> {
    return { white: 0, blue: 0, green: 0, red: 0, brown: 0, gold: 0 };
}

function isRealCard(c: SplendorCard | HiddenCard): c is SplendorCard {
    return !('hidden' in c);
}

/** Development-card bonuses the player has accumulated, by colour. */
export function bonuses(player: SplendorPlayer): Record<CardColor, number> {
    const b: Record<CardColor, number> = { white: 0, blue: 0, green: 0, red: 0, brown: 0 };
    for (const card of player.cards) b[card.color]++;
    return b;
}

function totalTokens(player: SplendorPlayer): number {
    return GEMS.reduce((sum, g) => sum + player.tokens[g], 0);
}

function recomputePoints(player: SplendorPlayer): void {
    let pts = 0;
    for (const c of player.cards) pts += c.points;
    for (const n of player.nobles) pts += n.points;
    player.points = pts;
}

function syncDeckCounts(state: SplendorState): void {
    const d = state.decks;
    state.deckCounts = {
        1: d ? d[1].length : state.deckCounts[1],
        2: d ? d[2].length : state.deckCounts[2],
        3: d ? d[3].length : state.deckCounts[3],
    };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function createInitialState(playerIds: string[], nowIso: string): SplendorState {
    if (playerIds.length < SPLENDOR_MIN_PLAYERS || playerIds.length > SPLENDOR_MAX_PLAYERS) {
        throw new Error('Splendor supports 2–4 players');
    }
    const n = playerIds.length;
    const perGem = BANK_BY_PLAYERS[n];

    const cards = allCards();
    const byLevel: Record<Level, SplendorCard[]> = { 1: [], 2: [], 3: [] };
    for (const c of cards) byLevel[c.level].push(c);

    const decks: Record<Level, SplendorCard[]> = {
        1: shuffle(byLevel[1]),
        2: shuffle(byLevel[2]),
        3: shuffle(byLevel[3]),
    };
    const board: Record<Level, (SplendorCard | null)[]> = { 1: [], 2: [], 3: [] };
    for (const lvl of LEVELS) {
        for (let i = 0; i < 4; i++) board[lvl].push(decks[lvl].pop() ?? null);
    }

    const nobles = shuffle(allNobles()).slice(0, n + 1);

    const bank: Record<Gem, number> = {
        white: perGem,
        blue: perGem,
        green: perGem,
        red: perGem,
        brown: perGem,
        gold: 5,
    };

    const players: SplendorPlayer[] = playerIds.map((id) => ({
        id,
        tokens: emptyTokens(),
        cards: [],
        reserved: [],
        nobles: [],
        points: 0,
    }));

    // Whoever sits in seat 0 shouldn't always open, so the starting seat is drawn
    // at random. Play still proceeds in seat order from there, wrapping around.
    const startSeat = Math.floor(Math.random() * n);

    const state: SplendorState = {
        players,
        bank,
        board,
        decks,
        deckCounts: { 1: decks[1].length, 2: decks[2].length, 3: decks[3].length },
        nobles,
        current: startSeat,
        startSeat,
        turn: 1,
        log: [],
        winnerId: null,
        finalRound: false,
        pendingNoble: null,
        startedAt: nowIso,
    };
    return state;
}

// ---------------------------------------------------------------------------
// Helpers for locating cards
// ---------------------------------------------------------------------------

function findBoardCard(state: SplendorState, cardId: string): { level: Level; index: number } | null {
    for (const lvl of LEVELS) {
        const idx = state.board[lvl].findIndex((c) => c && c.id === cardId);
        if (idx >= 0) return { level: lvl, index: idx };
    }
    return null;
}

function refillBoard(state: SplendorState, level: Level, index: number): void {
    const deck = state.decks?.[level];
    state.board[level][index] = deck && deck.length ? (deck.pop() as SplendorCard) : null;
}

// ---------------------------------------------------------------------------
// Token-limit enforcement (discard down to 10)
// ---------------------------------------------------------------------------

function applyReturns(player: SplendorPlayer, state: SplendorState, returns: Gem[] | undefined): void {
    const over = totalTokens(player) - TOKEN_LIMIT;
    if (over <= 0) {
        if (returns && returns.length) throw new Error('No tokens need to be returned');
        return;
    }
    if (!returns || returns.length !== over) {
        throw new Error(`You must return ${over} token${over === 1 ? '' : 's'} (over the limit of ${TOKEN_LIMIT})`);
    }
    for (const g of returns) {
        if (player.tokens[g] <= 0) throw new Error(`You don't have a ${g} token to return`);
        player.tokens[g]--;
        state.bank[g]++;
    }
}

// ---------------------------------------------------------------------------
// Noble visits
// ---------------------------------------------------------------------------

/** Ids of every noble whose cost the player's bonuses currently satisfy. */
function eligibleNobleIds(state: SplendorState, player: SplendorPlayer): string[] {
    const b = bonuses(player);
    return state.nobles
        .filter((noble) => CARD_COLORS.every((color) => b[color] >= (noble.cost[color] ?? 0)))
        .map((n) => n.id);
}

function awardNoble(state: SplendorState, player: SplendorPlayer, nobleId: string): void {
    const idx = state.nobles.findIndex((n) => n.id === nobleId);
    if (idx < 0) throw new Error('That noble is no longer available');
    const [noble] = state.nobles.splice(idx, 1);
    player.nobles.push(noble);
    state.log.push(`${shortId(player.id)} is visited by a noble (+3)`);
}

/** A compact label for the game log. Word ids fit as-is; legacy UUIDs get cut. */
function shortId(id: string): string {
    return id.length <= 24 ? id : id.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Turn advance + end-of-game
// ---------------------------------------------------------------------------

function endTurn(state: SplendorState): void {
    const n = state.players.length;
    if (state.players.some((p) => p.points >= POINTS_GOAL)) state.finalRound = true;
    state.current = (state.current + 1) % n;
    state.turn++;
    // Everyone gets the same number of turns, so the game ends when play wraps
    // back to whoever opened it — not to seat 0, which needn't be the starter.
    if (state.finalRound && state.current === state.startSeat) finishGame(state);
    syncDeckCounts(state);
}

function finishGame(state: SplendorState): void {
    let best: SplendorPlayer | null = null;
    for (const p of state.players) {
        if (
            !best ||
            p.points > best.points ||
            (p.points === best.points && p.cards.length < best.cards.length)
        ) {
            best = p;
        }
    }
    state.winnerId = best ? best.id : null;
    if (best) state.log.push(`${shortId(best.id)} wins with ${best.points} points`);
}

// ---------------------------------------------------------------------------
// Action application
// ---------------------------------------------------------------------------

/**
 * Whether the seat to move may pass instead of acting. Only on a player's very
 * first turn — turns 1..n are exactly one opening turn each — which, together
 * with the randomised starting seat, keeps the same players from always being
 * forced to commit first.
 */
export function canSkip(state: SplendorState): boolean {
    return !state.winnerId && state.pendingNoble == null && state.turn <= state.players.length;
}

export function applyAction(
    prev: SplendorState,
    playerId: string,
    action: SplendorAction,
): SplendorState {
    if (prev.winnerId) throw new Error('The game is over');

    const state = clone(prev);
    // Decks are not cloned away — keep them for server-side state.
    state.decks = prev.decks ? clone(prev.decks) : undefined;
    // Games started before the starting seat was randomised have no startSeat;
    // they all opened on seat 0, so that's the seat their final round ends on.
    if (typeof state.startSeat !== 'number') state.startSeat = 0;

    const seat = state.players.findIndex((p) => p.id === playerId);
    if (seat < 0) throw new Error('You are not in this game');
    if (seat !== state.current) throw new Error('It is not your turn');
    const player = state.players[seat];

    // A purchase left several nobles eligible — the player must choose one
    // before doing anything else this turn.
    if (state.pendingNoble) {
        if (action.type !== 'chooseNoble') throw new Error('Choose a noble to finish your turn');
        if (!state.pendingNoble.options.includes(action.nobleId)) {
            throw new Error('Pick one of the eligible nobles');
        }
        awardNoble(state, player, action.nobleId);
        state.pendingNoble = null;
        recomputePoints(player);
        endTurn(state);
        return state;
    }

    switch (action.type) {
        case 'take':
            takeTokens(state, player, action.gems, action.returns);
            break;
        case 'reserve':
            reserveCard(state, player, action.cardId, action.level, action.returns);
            break;
        case 'buy':
            buyCard(state, player, action.cardId);
            break;
        case 'skip':
            if (!canSkip(state)) throw new Error('You can only skip your first turn');
            state.log.push(`${shortId(player.id)} skipped their first turn`);
            break;
        case 'chooseNoble':
            throw new Error('No noble to choose right now');
        default:
            throw new Error('Unknown action');
    }

    recomputePoints(player);
    if (action.type === 'buy') {
        const eligible = eligibleNobleIds(state, player);
        if (eligible.length === 1) {
            awardNoble(state, player, eligible[0]);
            recomputePoints(player);
        } else if (eligible.length > 1) {
            // Pause the turn for the player to pick which noble visits.
            state.pendingNoble = { seat, options: eligible };
            syncDeckCounts(state);
            return state;
        }
    }
    endTurn(state);
    return state;
}

function takeTokens(
    state: SplendorState,
    player: SplendorPlayer,
    gems: Gem[],
    returns: Gem[] | undefined,
): void {
    if (!Array.isArray(gems) || gems.length === 0) throw new Error('Select tokens to take');
    if (gems.includes('gold')) throw new Error('You cannot take gold tokens directly');

    const pair = gems.length === 2 && gems[0] === gems[1];
    if (pair) {
        const g = gems[0];
        if (state.bank[g] < 4) throw new Error('You can only take 2 of a colour when 4+ remain');
        state.bank[g] -= 2;
        player.tokens[g] += 2;
    } else {
        if (gems.length > 3) throw new Error('Take at most 3 different tokens');
        const seen = new Set<Gem>();
        for (const g of gems) {
            if (seen.has(g)) throw new Error('Use 2-of-a-kind for matching tokens');
            seen.add(g);
            if (state.bank[g] < 1) throw new Error(`No ${g} tokens left`);
        }
        for (const g of gems) {
            state.bank[g]--;
            player.tokens[g]++;
        }
    }
    applyReturns(player, state, returns);
    state.log.push(`${shortId(player.id)} took ${gems.join(', ')}`);
}

function reserveCard(
    state: SplendorState,
    player: SplendorPlayer,
    cardId: string | undefined,
    level: Level | undefined,
    returns: Gem[] | undefined,
): void {
    if (player.reserved.length >= RESERVE_MAX) throw new Error('You can reserve at most 3 cards');

    let card: SplendorCard;
    if (cardId) {
        const loc = findBoardCard(state, cardId);
        if (!loc) throw new Error('That card is not on the board');
        card = state.board[loc.level][loc.index] as SplendorCard;
        refillBoard(state, loc.level, loc.index);
    } else if (level) {
        const deck = state.decks?.[level];
        if (!deck || deck.length === 0) throw new Error('That deck is empty');
        card = deck.pop() as SplendorCard;
    } else {
        throw new Error('Choose a card or deck to reserve');
    }

    player.reserved.push(card);
    if (state.bank.gold > 0) {
        state.bank.gold--;
        player.tokens.gold++;
    }
    applyReturns(player, state, returns);
    state.log.push(`${shortId(player.id)} reserved a card`);
}

function buyCard(state: SplendorState, player: SplendorPlayer, cardId: string): void {
    // Locate the card: on the board, or in the player's own reserve.
    const board = findBoardCard(state, cardId);
    let card: SplendorCard;
    let fromReserveIndex = -1;
    if (board) {
        card = state.board[board.level][board.index] as SplendorCard;
    } else {
        fromReserveIndex = player.reserved.findIndex((c) => isRealCard(c) && c.id === cardId);
        if (fromReserveIndex < 0) throw new Error('That card is not available to buy');
        card = player.reserved[fromReserveIndex] as SplendorCard;
    }

    const b = bonuses(player);
    const pay: Partial<Record<Gem, number>> = {};
    let goldNeeded = 0;
    for (const color of CARD_COLORS) {
        const need = Math.max(0, (card.cost[color] ?? 0) - b[color]);
        const fromColor = Math.min(need, player.tokens[color]);
        pay[color] = fromColor;
        goldNeeded += need - fromColor;
    }
    if (goldNeeded > player.tokens.gold) throw new Error('You cannot afford that card');

    for (const color of CARD_COLORS) {
        const amt = pay[color] ?? 0;
        player.tokens[color] -= amt;
        state.bank[color] += amt;
    }
    player.tokens.gold -= goldNeeded;
    state.bank.gold += goldNeeded;

    if (board) {
        refillBoard(state, board.level, board.index);
    } else {
        player.reserved.splice(fromReserveIndex, 1);
    }
    player.cards.push(card);
    state.log.push(`${shortId(player.id)} bought a ${card.color} card`);
}

// ---------------------------------------------------------------------------
// Player-scoped views (redact hidden information)
// ---------------------------------------------------------------------------

export function viewFor(state: SplendorState, playerId: string | null): SplendorState {
    const v = clone(state);
    delete v.decks; // never expose draw-pile order
    v.deckCounts = { ...state.deckCounts };
    for (const p of v.players) {
        if (p.id !== playerId) {
            p.reserved = p.reserved.map((c) =>
                isRealCard(c) ? ({ id: c.id, level: c.level, hidden: true } as HiddenCard) : c,
            );
        }
    }
    return v;
}
