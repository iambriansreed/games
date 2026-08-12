import { GameStatus, GameType, GameVisibility } from '../shared/types';

export interface User {
    id: string;
    google_sub: string;
    email: string;
    name: string | null;
    picture: string | null;
    created_at: string;
    last_login_at: string;
}

export interface GoogleProfile {
    sub: string;
    email: string;
    name: string | null;
    picture: string | null;
}

export interface Session {
    token_hash: string;
    user_id: string;
    expires_at: string;
    user: User;
}

export interface GameRow {
    id: string;
    type: GameType;
    name: string;
    visibility: GameVisibility;
    status: GameStatus;
    host_id: string;
    join_code: string;
    max_players: number;
    min_players: number;
    state: unknown;
    winner_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface GamePlayerRow {
    game_id: string;
    user_id: string;
    seat: number;
    name: string | null;
    picture: string | null;
    joined_at: string;
    /** All-time record, computed alongside the seat (see Store.getPlayers). */
    wins: number;
    losses: number;
}

export interface InviteRow {
    id: string;
    game_id: string;
    inviter_id: string;
    invitee_id: string;
    status: 'pending' | 'accepted' | 'declined';
    created_at: string;
    game_name?: string;
    game_type?: GameType;
    inviter_name?: string | null;
}
