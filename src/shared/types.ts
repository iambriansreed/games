// Platform-level types shared between the client and the API.

export type GameType = 'splendor';

export type GameVisibility = 'public' | 'private';
export type GameStatus = 'lobby' | 'active' | 'finished';

/** Public-safe user shape (never includes session/secret fields). */
export interface PublicUser {
    id: string;
    name: string | null;
    email: string;
    picture: string | null;
}

/**
 * A player's all-time record, derived from finished games: a win is a finished
 * game they won, a loss is one someone else won.
 */
export interface PlayerRecord {
    wins: number;
    losses: number;
}

/** A seat at a game table. */
export interface GamePlayer {
    userId: string;
    name: string | null;
    picture: string | null;
    seat: number;
    record: PlayerRecord;
}

/** Summary of a game for lobby lists (no full state). */
export interface GameSummary {
    id: string;
    type: GameType;
    name: string;
    visibility: GameVisibility;
    status: GameStatus;
    hostId: string;
    joinCode: string;
    maxPlayers: number;
    minPlayers: number;
    players: GamePlayer[];
    winnerId: string | null;
    createdAt: string;
    updatedAt: string;
}

/** A full game including its (player-scoped) state view. */
export interface GameDetail extends GameSummary {
    state: unknown;
    /** The current player's seat index, or null if not a participant. */
    youSeat: number | null;
}

export interface GameInvite {
    id: string;
    gameId: string;
    gameName: string;
    gameType: GameType;
    inviterId: string;
    inviterName: string | null;
    createdAt: string;
}

/** Envelope a client sends to mutate a game; `action` is game-type specific. */
export interface ActionRequest {
    action: unknown;
}
