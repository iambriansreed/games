import {
    GameDetail,
    GameInvite,
    GameSummary,
    GameType,
    GameVisibility,
    PublicUser,
} from '../shared/types';

export class ApiError extends Error {}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const res = await fetch(path, {
        credentials: 'include',
        headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
        ...opts,
    });
    if (res.status === 401) throw new ApiError('unauthenticated');
    let data: unknown = null;
    try {
        data = await res.json();
    } catch {
        // no body
    }
    if (!res.ok) {
        const msg = (data as { error?: string })?.error || `Request failed (${res.status})`;
        throw new ApiError(msg);
    }
    return data as T;
}

export interface LobbyData {
    open: GameSummary[];
    mine: GameSummary[];
    invites: GameInvite[];
}

export const api = {
    me(): Promise<{ user: PublicUser; isAdmin: boolean }> {
        return request<{ user: PublicUser; isAdmin: boolean }>('/api/auth/me');
    },
    logout(): Promise<{ ok: true }> {
        return request('/api/auth/logout', { method: 'POST' });
    },
    async updateName(name: string): Promise<PublicUser> {
        const { user } = await request<{ user: PublicUser }>('/api/users/me', {
            method: 'PATCH',
            body: JSON.stringify({ name }),
        });
        return user;
    },
    lobby(): Promise<LobbyData> {
        return request('/api/games');
    },
    getGame(id: string): Promise<GameDetail> {
        return request(`/api/games/${id}`);
    },
    createGame(input: { type: GameType; visibility: GameVisibility }): Promise<GameDetail> {
        return request('/api/games', { method: 'POST', body: JSON.stringify(input) });
    },
    joinGame(id: string): Promise<GameDetail> {
        return request(`/api/games/${id}/join`, { method: 'POST' });
    },
    joinByCode(code: string): Promise<GameDetail> {
        return request('/api/games/join', { method: 'POST', body: JSON.stringify({ code }) });
    },
    leaveGame(id: string): Promise<{ ok: true }> {
        return request(`/api/games/${id}/leave`, { method: 'POST' });
    },
    closeGame(id: string): Promise<{ ok: true }> {
        return request(`/api/games/${id}`, { method: 'DELETE' });
    },
    startGame(id: string): Promise<GameDetail> {
        return request(`/api/games/${id}/start`, { method: 'POST' });
    },
    rematch(id: string): Promise<GameDetail> {
        return request(`/api/games/${id}/rematch`, { method: 'POST' });
    },
    action(id: string, action: unknown): Promise<GameDetail> {
        return request(`/api/games/${id}/action`, {
            method: 'POST',
            body: JSON.stringify({ action }),
        });
    },
    searchUsers(q: string): Promise<{ users: PublicUser[] }> {
        return request(`/api/users/search?q=${encodeURIComponent(q)}`);
    },
    invite(gameId: string, userId: string): Promise<{ ok: true; user: PublicUser }> {
        return request(`/api/games/${gameId}/invite`, {
            method: 'POST',
            body: JSON.stringify({ userId }),
        });
    },
    declineInvite(gameId: string): Promise<{ ok: true }> {
        return request(`/api/invites/${gameId}/decline`, { method: 'POST' });
    },
    devSplendorScenario(scenario: string): Promise<GameDetail> {
        return request(`/api/dev/splendor/${scenario}`, { method: 'POST' });
    },
};
