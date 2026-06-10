import { useCallback, useEffect, useState } from 'react';
import { GameSummary, GameType, GameVisibility, PublicUser } from '../../shared/types';
import { api, ApiError, LobbyData } from '../api';
import { getSocket } from '../socket';
import { navigate } from '../router';

const GAME_TYPES: { type: GameType; label: string; blurb: string }[] = [
    { type: 'splendor', label: 'Splendor', blurb: 'Gem-trading engine builder, 2–4 players' },
];

export function Lobby({ me }: { me: PublicUser }) {
    const [data, setData] = useState<LobbyData | null>(null);
    const [err, setErr] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setData(await api.lobby());
        } catch (e) {
            setErr(e instanceof ApiError ? e.message : 'Failed to load');
        }
    }, []);

    useEffect(() => {
        void load();
        const socket = getSocket();
        const refresh = () => void load();
        socket.on('invites:update', refresh);
        socket.on('lobby:update', refresh);
        return () => {
            socket.off('invites:update', refresh);
            socket.off('lobby:update', refresh);
        };
    }, [load]);

    if (err) return <div className="lobby"><p className="error">{err}</p></div>;
    if (!data) return <div className="lobby"><p className="muted">Loading lobby…</p></div>;

    return (
        <div className="lobby">
            {data.invites.length > 0 && (
                <section className="panel">
                    <h2>Invitations</h2>
                    <ul className="list">
                        {data.invites.map((inv) => (
                            <li key={inv.id} className="list-row">
                                <div>
                                    <strong>{inv.gameName}</strong>
                                    <span className="muted">
                                        {' '}
                                        · {inv.gameType} · from {inv.inviterName || 'someone'}
                                    </span>
                                </div>
                                <div className="row-actions">
                                    <button
                                        className="btn btn-primary"
                                        onClick={async () => {
                                            const g = await api.joinGame(inv.gameId);
                                            navigate(`/g/${g.id}`);
                                        }}
                                    >
                                        Join
                                    </button>
                                    <button
                                        className="btn btn-ghost"
                                        onClick={async () => {
                                            await api.declineInvite(inv.gameId);
                                            void load();
                                        }}
                                    >
                                        Decline
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <CreateGame onCreated={(id) => navigate(`/g/${id}`)} />

            <GameListSection
                title="Your games"
                games={data.mine}
                me={me}
                empty="You're not in any games yet."
                onClose={async (id) => {
                    if (!confirm('Close this game for everyone? This cannot be undone.')) return;
                    try {
                        await api.closeGame(id);
                        void load();
                    } catch (e) {
                        setErr(e instanceof ApiError ? e.message : 'Failed to close game');
                    }
                }}
            />
            <GameListSection
                title="Open games"
                games={data.open}
                me={me}
                empty="No public games waiting. Create one!"
                joinable
            />
        </div>
    );
}

function GameListSection({
    title,
    games,
    me,
    empty,
    joinable,
    onClose,
}: {
    title: string;
    games: GameSummary[];
    me: PublicUser;
    empty: string;
    joinable?: boolean;
    onClose?: (id: string) => void;
}) {
    return (
        <section className="panel">
            <h2>{title}</h2>
            {games.length === 0 ? (
                <p className="muted">{empty}</p>
            ) : (
                <ul className="list">
                    {games.map((g) => (
                        <li key={g.id} className="list-row">
                            <div>
                                <strong>{g.name}</strong>{' '}
                                <span className={`tag tag-${g.status}`}>{g.status}</span>{' '}
                                {g.visibility === 'private' && <span className="tag">private</span>}
                                <div className="muted">
                                    {g.type} · {g.players.length}/{g.maxPlayers} players
                                    {g.hostId === me.id ? ' · you host' : ''}
                                </div>
                            </div>
                            <div className="row-actions">
                                <button
                                    className="btn btn-primary"
                                    onClick={async () => {
                                        if (joinable && !g.players.some((p) => p.userId === me.id)) {
                                            const d = await api.joinGame(g.id);
                                            navigate(`/g/${d.id}`);
                                        } else {
                                            navigate(`/g/${g.id}`);
                                        }
                                    }}
                                >
                                    {joinable ? 'Join' : 'Open'}
                                </button>
                                {onClose && g.hostId === me.id && (
                                    <button
                                        className="btn btn-ghost"
                                        onClick={() => onClose(g.id)}
                                    >
                                        Close
                                    </button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function CreateGame({ onCreated }: { onCreated: (id: string) => void }) {
    const [type, setType] = useState<GameType>('splendor');
    const [name, setName] = useState('');
    const [visibility, setVisibility] = useState<GameVisibility>('private');
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    return (
        <section className="panel">
            <h2>New game</h2>
            <div className="create-grid">
                <label className="field">
                    <span>Game</span>
                    <select value={type} onChange={(e) => setType(e.target.value as GameType)}>
                        {GAME_TYPES.map((g) => (
                            <option key={g.type} value={g.type}>
                                {g.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="field">
                    <span>Name (optional)</span>
                    <input
                        value={name}
                        placeholder="Friday night Splendor"
                        onChange={(e) => setName(e.target.value)}
                    />
                </label>
                <div className="field">
                    <span>Visibility</span>
                    <div className="seg">
                        <button
                            className={visibility === 'private' ? 'seg-on' : ''}
                            onClick={() => setVisibility('private')}
                        >
                            Private
                        </button>
                        <button
                            className={visibility === 'public' ? 'seg-on' : ''}
                            onClick={() => setVisibility('public')}
                        >
                            Public
                        </button>
                    </div>
                </div>
            </div>
            {error && <p className="error">{error}</p>}
            <div className="create-actions">
                <button
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                            const g = await api.createGame({ type, name, visibility });
                            onCreated(g.id);
                        } catch (e) {
                            setError(e instanceof ApiError ? e.message : 'Failed to create');
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    Create game
                </button>
                <div className="join-code">
                    <input
                        value={code}
                        placeholder="Join code"
                        onChange={(e) => setCode(e.target.value.toUpperCase())}
                    />
                    <button
                        className="btn"
                        disabled={!code.trim()}
                        onClick={async () => {
                            try {
                                const g = await api.joinByCode(code.trim());
                                onCreated(g.id);
                            } catch (e) {
                                setError(e instanceof ApiError ? e.message : 'Failed to join');
                            }
                        }}
                    >
                        Join by code
                    </button>
                </div>
            </div>
        </section>
    );
}
