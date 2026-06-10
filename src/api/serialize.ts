import { GameDetail, GameInvite, GamePlayer, GameSummary } from '../shared/types';
import { getGameModule } from '../shared/games';
import { GamePlayerRow, GameRow, InviteRow } from './types';

export function toPlayers(rows: GamePlayerRow[]): GamePlayer[] {
    return rows.map((r) => ({
        userId: r.user_id,
        name: r.name,
        picture: r.picture,
        seat: r.seat,
    }));
}

export function buildSummary(game: GameRow, players: GamePlayerRow[]): GameSummary {
    return {
        id: game.id,
        type: game.type,
        name: game.name,
        visibility: game.visibility,
        status: game.status,
        hostId: game.host_id,
        joinCode: game.join_code,
        maxPlayers: game.max_players,
        minPlayers: game.min_players,
        players: toPlayers(players),
        winnerId: game.winner_id,
        createdAt: game.created_at,
        updatedAt: game.updated_at,
    };
}

export function buildDetail(
    game: GameRow,
    players: GamePlayerRow[],
    userId: string | null,
): GameDetail {
    const mod = getGameModule(game.type);
    const youSeat = userId ? players.find((p) => p.user_id === userId)?.seat ?? null : null;
    const state =
        game.state && game.status !== 'lobby' ? mod.viewFor(game.state, userId) : game.state ?? null;
    return {
        ...buildSummary(game, players),
        state,
        youSeat,
    };
}

export function buildInvite(row: InviteRow): GameInvite {
    return {
        id: row.id,
        gameId: row.game_id,
        gameName: row.game_name ?? 'Game',
        gameType: (row.game_type ?? 'splendor') as GameInvite['gameType'],
        inviterId: row.inviter_id,
        inviterName: row.inviter_name ?? null,
        createdAt: row.created_at,
    };
}
