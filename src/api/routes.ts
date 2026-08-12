import { Router, type Request, type Response } from 'express';
import { GAME_TYPES, getGameModule } from '../shared/games';
import { GameType, GameVisibility } from '../shared/types';
import { store } from './store';
import { publicUser } from './auth';
import { buildDetail, buildInvite, buildSummary } from './serialize';
import { emitGame, emitGameClosed, emitInvites, emitLobby, emitRematch } from './realtime';
import { logError } from './log';
import { GamePlayerRow, GameRow, User } from './types';

export const api = Router();

function fail(res: Response, code: number, message: string) {
    return res.status(code).json({ error: message });
}

/** A friendly name for a user: their display name, else the email local part. */
function displayName(user: User): string {
    return (user.name || '').trim() || user.email.split('@')[0] || 'Player';
}

/** Load a game and its players, or null. */
async function loadGame(id: string): Promise<{ game: GameRow; players: GamePlayerRow[] } | null> {
    const game = await store().getGame(id);
    if (!game) return null;
    const players = await store().getPlayers(id);
    return { game, players };
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

api.get('/games', async (req: Request, res: Response) => {
    try {
        const user = req.user as User;
        const [openRows, myRows, inviteRows, record] = await Promise.all([
            store().listOpenGames(user.id),
            store().listMyGames(user.id),
            store().listInvitesForUser(user.id),
            store().getRecord(user.id),
        ]);
        const withPlayers = async (g: GameRow) => buildSummary(g, await store().getPlayers(g.id));
        const open = await Promise.all(openRows.map(withPlayers));
        const mine = await Promise.all(myRows.map(withPlayers));
        res.json({ open, mine, invites: inviteRows.map(buildInvite), record });
    } catch (err) {
        logError('games.list', err);
        fail(res, 500, 'Failed to load games');
    }
});

api.post('/games', async (req: Request, res: Response) => {
    try {
        const user = req.user as User;
        const { type, visibility } = req.body as {
            type?: GameType;
            visibility?: GameVisibility;
        };
        if (!type || !GAME_TYPES.includes(type)) return fail(res, 400, 'Unknown game type');

        // One game at a time: block if the user already hosts an unfinished game,
        // and tell them which one to leave or close first.
        const mine = await store().listMyGames(user.id);
        const existing = mine.find((g) => g.host_id === user.id && g.status !== 'finished');
        if (existing) {
            return fail(
                res,
                409,
                `You already have a game (“${existing.name}”). Leave or close it before creating another.`,
            );
        }

        const mod = getGameModule(type);
        const game = await store().createGame({
            type,
            name: `${displayName(user)}’s game`,
            visibility: visibility === 'public' ? 'public' : 'private',
            hostId: user.id,
            minPlayers: mod.minPlayers,
            maxPlayers: mod.maxPlayers,
        });
        await store().addPlayer(game.id, user.id);
        const players = await store().getPlayers(game.id);
        emitLobby();
        res.json(buildDetail(game, players, user.id));
    } catch (err) {
        logError('games.create', err);
        fail(res, 500, 'Failed to create game');
    }
});

api.get('/games/:id', async (req: Request, res: Response) => {
    const user = req.user as User;
    const loaded = await loadGame(req.params.id);
    if (!loaded) return fail(res, 404, 'Game not found');
    const { game, players } = loaded;
    const isParticipant = players.some((p) => p.user_id === user.id);
    const isPublicLobby = game.status === 'lobby' && game.visibility === 'public';
    if (!isParticipant && !isPublicLobby) return fail(res, 403, 'You cannot view this game');
    res.json(buildDetail(game, players, user.id));
});

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

async function doJoin(
    res: Response,
    user: User,
    game: GameRow,
    players: GamePlayerRow[],
    viaCode: boolean,
) {
    if (players.some((p) => p.user_id === user.id)) {
        return res.json(buildDetail(game, players, user.id));
    }
    if (game.status !== 'lobby') return fail(res, 409, 'Game already started');
    if (players.length >= game.max_players) return fail(res, 409, 'Game is full');

    const invite = await store().getInviteForGame(game.id, user.id);
    const allowed =
        viaCode || game.visibility === 'public' || game.host_id === user.id || invite != null;
    if (!allowed) return fail(res, 403, 'This game is private');

    await store().addPlayer(game.id, user.id);
    if (invite) await store().setInviteStatus(game.id, user.id, 'accepted');
    const fresh = await store().getPlayers(game.id);
    await emitGame(game.id);
    emitLobby();
    if (invite) emitInvites(user.id);
    res.json(buildDetail(game, fresh, user.id));
}

api.post('/games/join', async (req: Request, res: Response) => {
    const user = req.user as User;
    const code = String((req.body as { code?: string }).code || '').trim();
    if (!code) return fail(res, 400, 'Enter a join code');
    const game = await store().getGameByCode(code);
    if (!game) return fail(res, 404, 'No game with that code');
    const players = await store().getPlayers(game.id);
    await doJoin(res, user, game, players, true);
});

api.post('/games/:id/join', async (req: Request, res: Response) => {
    const user = req.user as User;
    const loaded = await loadGame(req.params.id);
    if (!loaded) return fail(res, 404, 'Game not found');
    await doJoin(res, user, loaded.game, loaded.players, false);
});

api.post('/games/:id/leave', async (req: Request, res: Response) => {
    const user = req.user as User;
    const loaded = await loadGame(req.params.id);
    if (!loaded) return fail(res, 404, 'Game not found');
    // You can leave a lobby (before it starts) or a finished game (to clear it
    // from your list); you can't bail on a game that's still in progress.
    if (loaded.game.status === 'active') return fail(res, 409, 'You cannot leave a game in progress');
    if (loaded.game.status === 'finished') {
        // Keep the seat on record so the result still counts toward both players'
        // win/loss tallies — clearing the game only hides it from this user.
        await store().hidePlayer(req.params.id, user.id);
    } else {
        await store().removePlayer(req.params.id, user.id);
    }
    await emitGame(req.params.id);
    emitLobby();
    res.json({ ok: true });
});

api.delete('/games/:id', async (req: Request, res: Response) => {
    const user = req.user as User;
    const loaded = await loadGame(req.params.id);
    if (!loaded) return fail(res, 404, 'Game not found');
    if (loaded.game.host_id !== user.id) return fail(res, 403, 'Only the host can close this game');
    // A finished game's result belongs to everyone who played it, so the host
    // can't delete it (and their records with it) — they clear it like anyone else.
    if (loaded.game.status === 'finished') {
        return fail(res, 409, 'Finished games can’t be closed — use Exit to clear it from your list');
    }
    emitGameClosed(req.params.id);
    await store().deleteGame(req.params.id);
    emitLobby();
    res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Starting + playing
// ---------------------------------------------------------------------------

api.post('/games/:id/start', async (req: Request, res: Response) => {
    try {
        const user = req.user as User;
        const loaded = await loadGame(req.params.id);
        if (!loaded) return fail(res, 404, 'Game not found');
        const { game, players } = loaded;
        if (game.host_id !== user.id) return fail(res, 403, 'Only the host can start');
        if (game.status !== 'lobby') return fail(res, 409, 'Game already started');
        const mod = getGameModule(game.type);
        if (players.length < mod.minPlayers) {
            return fail(res, 400, `Need at least ${mod.minPlayers} players`);
        }
        const orderedIds = players.slice().sort((a, b) => a.seat - b.seat).map((p) => p.user_id);
        const state = mod.createInitialState(orderedIds, new Date().toISOString());
        await store().updateGame(game.id, { state, status: 'active' });
        const fresh = await store().getGame(game.id);
        await emitGame(game.id);
        emitLobby();
        res.json(buildDetail(fresh as GameRow, players, user.id));
    } catch (err) {
        logError('games.start', err);
        fail(res, 400, err instanceof Error ? err.message : 'Failed to start game');
    }
});

// Maps a finished game to its rematch lobby, so concurrent "Play again" clicks
// from different players all converge on a single new game rather than spawning
// one each. In-memory is fine: a rematch is only ever offered moments after a
// game ends, well within a single process's lifetime.
const rematches = new Map<string, string>();

api.post('/games/:id/rematch', async (req: Request, res: Response) => {
    try {
        const user = req.user as User;
        const loaded = await loadGame(req.params.id);
        if (!loaded) return fail(res, 404, 'Game not found');
        const { game, players } = loaded;
        if (!players.some((p) => p.user_id === user.id)) return fail(res, 403, 'You are not a player');
        if (game.status !== 'finished') return fail(res, 409, 'The game is not finished');

        // Reuse an existing rematch so everyone lands in the same lobby.
        const existingId = rematches.get(game.id);
        if (existingId) {
            const existing = await loadGame(existingId);
            if (existing) {
                await store().addPlayer(existingId, user.id);
                const fresh = await store().getPlayers(existingId);
                await emitGame(existingId);
                return res.json(buildDetail(existing.game, fresh, user.id));
            }
            rematches.delete(game.id);
        }

        const mod = getGameModule(game.type);
        const next = await store().createGame({
            type: game.type,
            name: game.name,
            visibility: game.visibility,
            hostId: game.host_id,
            minPlayers: mod.minPlayers,
            maxPlayers: mod.maxPlayers,
        });
        // Re-seat the same players in their original order.
        for (const p of [...players].sort((a, b) => a.seat - b.seat)) {
            await store().addPlayer(next.id, p.user_id);
        }
        rematches.set(game.id, next.id);
        const fresh = await store().getPlayers(next.id);
        emitRematch(game.id, next.id);
        emitLobby();
        res.json(buildDetail(next, fresh, user.id));
    } catch (err) {
        logError('games.rematch', err);
        fail(res, 500, 'Failed to start rematch');
    }
});

api.post('/games/:id/action', async (req: Request, res: Response) => {
    try {
        const user = req.user as User;
        const loaded = await loadGame(req.params.id);
        if (!loaded) return fail(res, 404, 'Game not found');
        const { game, players } = loaded;
        if (game.status !== 'active') return fail(res, 409, 'Game is not in progress');
        if (!players.some((p) => p.user_id === user.id)) return fail(res, 403, 'You are not a player');

        const mod = getGameModule(game.type);
        const action = (req.body as { action?: unknown }).action;
        const next = mod.applyAction(game.state, user.id, action);
        const winnerId = mod.winnerId(next);
        await store().updateGame(game.id, {
            state: next,
            status: mod.isFinished(next) ? 'finished' : 'active',
            winnerId: winnerId ?? null,
        });
        const fresh = await store().getGame(game.id);
        await emitGame(game.id);
        if (mod.isFinished(next)) emitLobby();
        res.json(buildDetail(fresh as GameRow, players, user.id));
    } catch (err) {
        // Engine errors are user-facing rule violations → 400 with the message.
        fail(res, 400, err instanceof Error ? err.message : 'Illegal move');
    }
});

// ---------------------------------------------------------------------------
// Invites + user search
// ---------------------------------------------------------------------------

const MAX_NAME_LENGTH = 40;

api.patch('/users/me', async (req: Request, res: Response) => {
    try {
        const user = req.user as User;
        const name = String((req.body as { name?: string }).name ?? '').trim();
        if (!name) return fail(res, 400, 'Enter a username');
        if (name.length > MAX_NAME_LENGTH) {
            return fail(res, 400, `Username must be ${MAX_NAME_LENGTH} characters or fewer`);
        }
        const updated = await store().updateUserName(user.id, name);
        if (!updated) return fail(res, 404, 'User not found');
        // Names shown in lobby/game player lists are read live, but nudge clients to refresh.
        emitLobby();
        res.json({ user: publicUser(updated) });
    } catch (err) {
        logError('users.updateName', err);
        fail(res, 500, 'Failed to update username');
    }
});

api.get('/users/search', async (req: Request, res: Response) => {
    const user = req.user as User;
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ users: [] });
    const users = await store().searchUsers(q, [user.id]);
    res.json({ users });
});

api.post('/games/:id/invite', async (req: Request, res: Response) => {
    const user = req.user as User;
    const loaded = await loadGame(req.params.id);
    if (!loaded) return fail(res, 404, 'Game not found');
    const { game, players } = loaded;
    if (!players.some((p) => p.user_id === user.id)) return fail(res, 403, 'You are not a player');
    if (game.status !== 'lobby') return fail(res, 409, 'Game already started');
    const inviteeId = String((req.body as { userId?: string }).userId || '');
    if (!inviteeId) return fail(res, 400, 'Choose a user to invite');
    const invitee = await store().getUser(inviteeId);
    if (!invitee) return fail(res, 404, 'User not found');
    await store().createInvite(game.id, user.id, inviteeId);
    emitInvites(inviteeId);
    res.json({ ok: true, user: publicUser(invitee) });
});

api.post('/invites/:gameId/decline', async (req: Request, res: Response) => {
    const user = req.user as User;
    await store().setInviteStatus(req.params.gameId, user.id, 'declined');
    emitInvites(user.id);
    res.json({ ok: true });
});
