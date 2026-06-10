// Registry mapping a game type to its rules module. Add new games here.

import { GameType } from './types';
import * as splendor from './splendor/engine';
import { SplendorAction, SplendorState } from './splendor/types';

export interface GameModule {
    type: GameType;
    minPlayers: number;
    maxPlayers: number;
    /** Build the initial authoritative state for an ordered list of player ids. */
    createInitialState(playerIds: string[], nowIso: string): unknown;
    /** Apply a player's action; throws on an illegal move. Returns new state. */
    applyAction(state: unknown, playerId: string, action: unknown): unknown;
    /** Redact a state to what `playerId` is allowed to see (null = spectator). */
    viewFor(state: unknown, playerId: string | null): unknown;
    isFinished(state: unknown): boolean;
    winnerId(state: unknown): string | null;
}

export const GAMES: Record<GameType, GameModule> = {
    splendor: {
        type: 'splendor',
        minPlayers: splendor.SPLENDOR_MIN_PLAYERS,
        maxPlayers: splendor.SPLENDOR_MAX_PLAYERS,
        createInitialState: (ids, now) => splendor.createInitialState(ids, now),
        applyAction: (s, pid, a) =>
            splendor.applyAction(s as SplendorState, pid, a as SplendorAction),
        viewFor: (s, pid) => splendor.viewFor(s as SplendorState, pid),
        isFinished: (s) => (s as SplendorState).winnerId != null,
        winnerId: (s) => (s as SplendorState).winnerId,
    },
};

export const GAME_TYPES = Object.keys(GAMES) as GameType[];

export function getGameModule(type: GameType): GameModule {
    const mod = GAMES[type];
    if (!mod) throw new Error(`Unknown game type: ${type}`);
    return mod;
}
