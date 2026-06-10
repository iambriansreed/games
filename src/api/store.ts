import crypto from 'node:crypto';
import { Pool } from 'pg';
import { GameStatus, GameType, GameVisibility, PublicUser } from '../shared/types';
import { GamePlayerRow, GameRow, GoogleProfile, InviteRow, Session, User } from './types';

function newId(): string {
    return crypto.randomUUID();
}

/** Short, unambiguous join code (no easily-confused characters). */
function newJoinCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
}

const SCHEMA = `
    CREATE TABLE IF NOT EXISTS games_users (
        id text PRIMARY KEY,
        google_sub text UNIQUE NOT NULL,
        email text NOT NULL,
        name text,
        picture text,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_login_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS games_sessions (
        token_hash text PRIMARY KEY,
        user_id text NOT NULL REFERENCES games_users (id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS games_sessions_user_idx ON games_sessions (user_id);

    CREATE TABLE IF NOT EXISTS games_games (
        id text PRIMARY KEY,
        type text NOT NULL,
        name text NOT NULL,
        visibility text NOT NULL DEFAULT 'private',
        status text NOT NULL DEFAULT 'lobby',
        host_id text NOT NULL REFERENCES games_users (id) ON DELETE CASCADE,
        join_code text UNIQUE NOT NULL,
        max_players integer NOT NULL DEFAULT 4,
        min_players integer NOT NULL DEFAULT 2,
        state jsonb,
        winner_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS games_games_status_idx ON games_games (status, visibility);

    CREATE TABLE IF NOT EXISTS games_game_players (
        game_id text NOT NULL REFERENCES games_games (id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES games_users (id) ON DELETE CASCADE,
        seat integer NOT NULL,
        joined_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (game_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS games_game_players_user_idx ON games_game_players (user_id);

    CREATE TABLE IF NOT EXISTS games_game_invites (
        id text PRIMARY KEY,
        game_id text NOT NULL REFERENCES games_games (id) ON DELETE CASCADE,
        inviter_id text NOT NULL REFERENCES games_users (id) ON DELETE CASCADE,
        invitee_id text NOT NULL REFERENCES games_users (id) ON DELETE CASCADE,
        status text NOT NULL DEFAULT 'pending',
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (game_id, invitee_id)
    );
    CREATE INDEX IF NOT EXISTS games_game_invites_invitee_idx
        ON games_game_invites (invitee_id, status);
`;

function toIso(v: unknown): string {
    return v instanceof Date ? v.toISOString() : String(v);
}

function mapUser(r: Record<string, unknown>): User {
    return {
        id: r.id as string,
        google_sub: r.google_sub as string,
        email: r.email as string,
        name: (r.name as string) ?? null,
        picture: (r.picture as string) ?? null,
        created_at: toIso(r.created_at),
        last_login_at: toIso(r.last_login_at),
    };
}

function mapGame(r: Record<string, unknown>): GameRow {
    return {
        id: r.id as string,
        type: r.type as GameType,
        name: r.name as string,
        visibility: r.visibility as GameVisibility,
        status: r.status as GameStatus,
        host_id: r.host_id as string,
        join_code: r.join_code as string,
        max_players: Number(r.max_players),
        min_players: Number(r.min_players),
        state: r.state ?? null,
        winner_id: (r.winner_id as string) ?? null,
        created_at: toIso(r.created_at),
        updated_at: toIso(r.updated_at),
    };
}

export class Store {
    private pool: Pool;
    private ready: Promise<void>;

    constructor(connectionString: string) {
        const noSsl =
            /localhost|127\.0\.0\.1/.test(connectionString) ||
            /[?&]sslmode=disable/.test(connectionString);
        this.pool = new Pool({
            connectionString,
            ssl: noSsl ? undefined : { rejectUnauthorized: false },
        });
        this.ready = this.pool
            .query(SCHEMA)
            .then(() => undefined)
            .catch((err) => {
                console.error('[games] schema init failed:', err);
                throw err;
            });
    }

    private async q<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
        await this.ready;
        const res = await this.pool.query(text, values);
        return res.rows as T[];
    }

    // ---- Users / sessions ----

    async upsertUser(profile: GoogleProfile): Promise<User> {
        // Keep any custom name the user has set in settings; only fall back to
        // the Google profile name when we don't have one stored yet.
        const rows = await this.q(
            `INSERT INTO games_users (id, google_sub, email, name, picture)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (google_sub) DO UPDATE
                SET email = EXCLUDED.email,
                    name = COALESCE(games_users.name, EXCLUDED.name),
                    picture = EXCLUDED.picture,
                    last_login_at = now()
             RETURNING *`,
            [newId(), profile.sub, profile.email, profile.name, profile.picture],
        );
        return mapUser(rows[0]);
    }

    async updateUserName(id: string, name: string): Promise<User | null> {
        const rows = await this.q(`UPDATE games_users SET name = $2 WHERE id = $1 RETURNING *`, [
            id,
            name,
        ]);
        return rows[0] ? mapUser(rows[0]) : null;
    }

    async getUser(id: string): Promise<User | null> {
        const rows = await this.q(`SELECT * FROM games_users WHERE id = $1`, [id]);
        return rows[0] ? mapUser(rows[0]) : null;
    }

    async searchUsers(query: string, excludeIds: string[], limit = 10): Promise<PublicUser[]> {
        const like = `%${query.toLowerCase()}%`;
        const rows = await this.q(
            `SELECT id, name, email, picture FROM games_users
             WHERE (lower(email) LIKE $1 OR lower(coalesce(name,'')) LIKE $1)
               AND NOT (id = ANY($2))
             ORDER BY name NULLS LAST, email
             LIMIT $3`,
            [like, excludeIds, limit],
        );
        return rows.map((r) => ({
            id: r.id as string,
            name: (r.name as string) ?? null,
            email: r.email as string,
            picture: (r.picture as string) ?? null,
        }));
    }

    async createSession(tokenHash: string, userId: string, expiresAt: string): Promise<void> {
        await this.q(
            `INSERT INTO games_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
            [tokenHash, userId, expiresAt],
        );
    }

    async getSession(tokenHash: string): Promise<Session | null> {
        const rows = await this.q(
            `SELECT s.token_hash, s.user_id, s.expires_at, u.*
             FROM games_sessions s JOIN games_users u ON u.id = s.user_id
             WHERE s.token_hash = $1 AND s.expires_at > now()`,
            [tokenHash],
        );
        if (!rows[0]) return null;
        const r = rows[0];
        return {
            token_hash: r.token_hash as string,
            user_id: r.user_id as string,
            expires_at: toIso(r.expires_at),
            user: mapUser(r),
        };
    }

    async touchSession(tokenHash: string, expiresAt: string): Promise<void> {
        await this.q(`UPDATE games_sessions SET expires_at = $2 WHERE token_hash = $1`, [
            tokenHash,
            expiresAt,
        ]);
    }

    async deleteSession(tokenHash: string): Promise<void> {
        await this.q(`DELETE FROM games_sessions WHERE token_hash = $1`, [tokenHash]);
    }

    // ---- Games ----

    async createGame(input: {
        type: GameType;
        name: string;
        visibility: GameVisibility;
        hostId: string;
        minPlayers: number;
        maxPlayers: number;
    }): Promise<GameRow> {
        const id = newId();
        const code = newJoinCode();
        const rows = await this.q(
            `INSERT INTO games_games
                (id, type, name, visibility, status, host_id, join_code, max_players, min_players)
             VALUES ($1, $2, $3, $4, 'lobby', $5, $6, $7, $8)
             RETURNING *`,
            [
                id,
                input.type,
                input.name,
                input.visibility,
                input.hostId,
                code,
                input.maxPlayers,
                input.minPlayers,
            ],
        );
        return mapGame(rows[0]);
    }

    async getGame(id: string): Promise<GameRow | null> {
        const rows = await this.q(`SELECT * FROM games_games WHERE id = $1`, [id]);
        return rows[0] ? mapGame(rows[0]) : null;
    }

    async getGameByCode(code: string): Promise<GameRow | null> {
        const rows = await this.q(`SELECT * FROM games_games WHERE join_code = $1`, [
            code.toUpperCase(),
        ]);
        return rows[0] ? mapGame(rows[0]) : null;
    }

    async updateGame(
        id: string,
        patch: { state?: unknown; status?: GameStatus; winnerId?: string | null },
    ): Promise<void> {
        const sets: string[] = ['updated_at = now()'];
        const vals: unknown[] = [];
        let i = 1;
        if (patch.state !== undefined) {
            sets.push(`state = $${++i}`);
            vals.push(JSON.stringify(patch.state));
        }
        if (patch.status !== undefined) {
            sets.push(`status = $${++i}`);
            vals.push(patch.status);
        }
        if (patch.winnerId !== undefined) {
            sets.push(`winner_id = $${++i}`);
            vals.push(patch.winnerId);
        }
        await this.q(`UPDATE games_games SET ${sets.join(', ')} WHERE id = $1`, [id, ...vals]);
    }

    /** Delete a game and (via ON DELETE CASCADE) its players and invites. */
    async deleteGame(id: string): Promise<void> {
        await this.q(`DELETE FROM games_games WHERE id = $1`, [id]);
    }

    async getPlayers(gameId: string): Promise<GamePlayerRow[]> {
        const rows = await this.q(
            `SELECT p.game_id, p.user_id, p.seat, p.joined_at, u.name, u.picture
             FROM games_game_players p JOIN games_users u ON u.id = p.user_id
             WHERE p.game_id = $1 ORDER BY p.seat`,
            [gameId],
        );
        return rows.map((r) => ({
            game_id: r.game_id as string,
            user_id: r.user_id as string,
            seat: Number(r.seat),
            name: (r.name as string) ?? null,
            picture: (r.picture as string) ?? null,
            joined_at: toIso(r.joined_at),
        }));
    }

    async addPlayer(gameId: string, userId: string): Promise<void> {
        await this.q(
            `INSERT INTO games_game_players (game_id, user_id, seat)
             SELECT $1, $2, COALESCE(MAX(seat) + 1, 0)
             FROM games_game_players WHERE game_id = $1
             ON CONFLICT (game_id, user_id) DO NOTHING`,
            [gameId, userId],
        );
    }

    async removePlayer(gameId: string, userId: string): Promise<void> {
        await this.q(`DELETE FROM games_game_players WHERE game_id = $1 AND user_id = $2`, [
            gameId,
            userId,
        ]);
    }

    /** Public lobby games still open to join (not full, in lobby). */
    async listOpenGames(userId: string): Promise<GameRow[]> {
        const rows = await this.q(
            `SELECT g.* FROM games_games g
             WHERE g.status = 'lobby' AND g.visibility = 'public'
               AND (SELECT count(*) FROM games_game_players p WHERE p.game_id = g.id) < g.max_players
               AND NOT EXISTS (
                   SELECT 1 FROM games_game_players p
                   WHERE p.game_id = g.id AND p.user_id = $1
               )
             ORDER BY g.created_at DESC LIMIT 50`,
            [userId],
        );
        return rows.map(mapGame);
    }

    /** Every game the user is a participant in. */
    async listMyGames(userId: string): Promise<GameRow[]> {
        const rows = await this.q(
            `SELECT g.* FROM games_games g
             JOIN games_game_players p ON p.game_id = g.id
             WHERE p.user_id = $1
             ORDER BY g.updated_at DESC LIMIT 50`,
            [userId],
        );
        return rows.map(mapGame);
    }

    // ---- Invites ----

    async createInvite(gameId: string, inviterId: string, inviteeId: string): Promise<void> {
        await this.q(
            `INSERT INTO games_game_invites (id, game_id, inviter_id, invitee_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (game_id, invitee_id) DO UPDATE SET status = 'pending'`,
            [newId(), gameId, inviterId, inviteeId],
        );
    }

    async listInvitesForUser(userId: string): Promise<InviteRow[]> {
        const rows = await this.q(
            `SELECT i.*, g.name AS game_name, g.type AS game_type, u.name AS inviter_name
             FROM games_game_invites i
             JOIN games_games g ON g.id = i.game_id
             JOIN games_users u ON u.id = i.inviter_id
             WHERE i.invitee_id = $1 AND i.status = 'pending' AND g.status = 'lobby'
             ORDER BY i.created_at DESC`,
            [userId],
        );
        return rows.map((r) => ({
            id: r.id as string,
            game_id: r.game_id as string,
            inviter_id: r.inviter_id as string,
            invitee_id: r.invitee_id as string,
            status: r.status as InviteRow['status'],
            created_at: toIso(r.created_at),
            game_name: r.game_name as string,
            game_type: r.game_type as GameType,
            inviter_name: (r.inviter_name as string) ?? null,
        }));
    }

    async getInviteForGame(gameId: string, userId: string): Promise<InviteRow | null> {
        const rows = await this.q(
            `SELECT * FROM games_game_invites WHERE game_id = $1 AND invitee_id = $2`,
            [gameId, userId],
        );
        if (!rows[0]) return null;
        const r = rows[0];
        return {
            id: r.id as string,
            game_id: r.game_id as string,
            inviter_id: r.inviter_id as string,
            invitee_id: r.invitee_id as string,
            status: r.status as InviteRow['status'],
            created_at: toIso(r.created_at),
        };
    }

    async setInviteStatus(gameId: string, userId: string, status: InviteRow['status']): Promise<void> {
        await this.q(
            `UPDATE games_game_invites SET status = $3 WHERE game_id = $1 AND invitee_id = $2`,
            [gameId, userId, status],
        );
    }
}

let _store: Store | null = null;

export function store(): Store {
    if (_store) return _store;
    const url = process.env.DATABASE_URL;
    if (!url) {
        throw new Error(
            'DATABASE_URL is not set. Provide a Postgres connection string (Railway sets this automatically in production).',
        );
    }
    _store = new Store(url);
    return _store;
}
