import type http from 'node:http';
import { Server } from 'socket.io';
import { resolveUser } from './auth';
import { store } from './store';
import { buildDetail } from './serialize';

let io: Server | null = null;

export function initRealtime(server: http.Server): Server {
    io = new Server(server);

    // Authenticate the websocket handshake with the session cookie.
    io.use(async (socket, next) => {
        try {
            const user = await resolveUser({
                headers: { cookie: socket.handshake.headers.cookie },
            });
            if (!user) return next(new Error('unauthenticated'));
            socket.data.userId = user.id;
            next();
        } catch {
            next(new Error('unauthenticated'));
        }
    });

    io.on('connection', (socket) => {
        const userId = socket.data.userId as string;
        socket.join(`user:${userId}`);

        socket.on('game:join', async (gameId: string) => {
            const game = await store().getGame(gameId);
            if (!game) return;
            const players = await store().getPlayers(gameId);
            const isParticipant = players.some((p) => p.user_id === userId);
            const isPublicLobby = game.status === 'lobby' && game.visibility === 'public';
            if (!isParticipant && !isPublicLobby) return;
            socket.join(`game:${gameId}`);
            socket.emit('game:update', buildDetail(game, players, userId));
        });

        socket.on('game:leave', (gameId: string) => {
            socket.leave(`game:${gameId}`);
        });
    });

    return io;
}

/** Push the latest game state to every socket watching the game (per-player view). */
export async function emitGame(gameId: string): Promise<void> {
    if (!io) return;
    const room = io.sockets.adapter.rooms.get(`game:${gameId}`);
    if (!room) return;
    const game = await store().getGame(gameId);
    if (!game) return;
    const players = await store().getPlayers(gameId);
    for (const socketId of room) {
        const socket = io.sockets.sockets.get(socketId);
        if (!socket) continue;
        socket.emit('game:update', buildDetail(game, players, socket.data.userId as string));
    }
}

/** Tell everyone watching a game that it has been closed, so they can leave. */
export function emitGameClosed(gameId: string): void {
    io?.to(`game:${gameId}`).emit('game:closed', gameId);
}

/** Point everyone in a finished game at its freshly-created rematch lobby. */
export function emitRematch(fromGameId: string, toGameId: string): void {
    io?.to(`game:${fromGameId}`).emit('game:rematch', { from: fromGameId, to: toGameId });
}

export function emitInvites(userId: string): void {
    io?.to(`user:${userId}`).emit('invites:update');
}

export function emitLobby(): void {
    io?.emit('lobby:update');
}
