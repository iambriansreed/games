import { useCallback, useEffect, useState } from 'react';
import { GameSummary, PublicUser } from '../shared/types';
import { api, ApiError } from './api';
import { getSocket } from './socket';
import { navigate, useRoute } from './router';
import { Login } from './components/Login';
import { Header } from './components/Header';
import { Lobby } from './components/Lobby';
import { GameView } from './components/GameView';
import { Settings } from './components/Settings';

type AuthState =
    | { status: 'loading' }
    | { status: 'in'; user: PublicUser; isAdmin: boolean }
    | { status: 'out' };

export function App() {
    const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
    const [myGames, setMyGames] = useState<GameSummary[]>([]);
    const [gameTitle, setGameTitle] = useState<string | null>(null);
    const route = useRoute();

    // Most-recent unfinished game backs the header's "Return to game" link.
    const ongoingGame = myGames[0] ?? null;

    const refreshMe = useCallback(async () => {
        try {
            const { user, isAdmin } = await api.me();
            setAuth({ status: 'in', user, isAdmin });
        } catch {
            setAuth({ status: 'out' });
        }
    }, []);

    useEffect(() => {
        void refreshMe();
    }, [refreshMe]);

    // Track the player's unfinished games (most recent first) so the header can
    // list them and offer a quick "Return to game" link from anywhere.
    useEffect(() => {
        if (auth.status !== 'in') {
            setMyGames([]);
            return;
        }
        let cancelled = false;
        const load = async () => {
            try {
                const { mine } = await api.lobby();
                const ongoing = mine
                    .filter((g) => g.status !== 'finished')
                    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
                if (!cancelled) setMyGames(ongoing);
            } catch {
                /* ignore — header link is best-effort */
            }
        };
        void load();
        const socket = getSocket();
        const refresh = () => void load();
        socket.on('lobby:update', refresh);
        return () => {
            cancelled = true;
            socket.off('lobby:update', refresh);
        };
    }, [auth.status]);

    // Deep link: /join/<code> auto-joins then redirects to the game.
    useEffect(() => {
        if (auth.status !== 'in' || route.view !== 'join') return;
        let cancelled = false;
        api.joinByCode(route.code)
            .then((g) => {
                if (!cancelled) navigate(`/g/${g.id}`);
            })
            .catch((e) => {
                if (!cancelled) {
                    alert(e instanceof ApiError ? e.message : 'Could not join');
                    navigate('/');
                }
            });
        return () => {
            cancelled = true;
        };
    }, [auth.status, route]);

    if (auth.status === 'loading') {
        return <div className="app-loading">Loading…</div>;
    }

    if (auth.status === 'out') {
        return <Login />;
    }

    return (
        <div className="app">
            <Header
                user={auth.user}
                title={route.view === 'game' ? gameTitle ?? undefined : undefined}
                games={myGames}
                currentGameId={route.view === 'game' ? route.id : undefined}
                onOpenGame={(id) => navigate(`/g/${id}`)}
                onHome={() => navigate('/')}
                onSettings={() => navigate('/settings')}
                showReturnToGame={ongoingGame != null && route.view !== 'game'}
                onReturnToGame={() => ongoingGame && navigate(`/g/${ongoingGame.id}`)}
                onLogout={async () => {
                    await api.logout();
                    setAuth({ status: 'out' });
                    navigate('/');
                }}
            />
            <main className="app-main">
                {route.view === 'game' ? (
                    <GameView gameId={route.id} me={auth.user} onTitleChange={setGameTitle} />
                ) : route.view === 'settings' ? (
                    <Settings
                        user={auth.user}
                        isAdmin={auth.isAdmin}
                        onUserUpdated={(user) =>
                            setAuth((prev) => (prev.status === 'in' ? { ...prev, user } : prev))
                        }
                    />
                ) : (
                    <Lobby me={auth.user} />
                )}
            </main>
        </div>
    );
}
