import { useCallback, useEffect, useState } from 'react';
import { GameSummary, GameType, GameVisibility, PlayerRecord, PublicUser } from '../../shared/types';
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
            <RecordPanel record={data.record} />

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

            <CreateGame
                onCreated={(id) => navigate(`/g/${id}`)}
                blocking={
                    data.mine.find((g) => g.hostId === me.id && g.status !== 'finished') ?? null
                }
            />

            <JoinGame onJoined={(id) => navigate(`/g/${id}`)} />

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
                onExit={async (id) => {
                    try {
                        await api.leaveGame(id);
                        void load();
                    } catch (e) {
                        setErr(e instanceof ApiError ? e.message : 'Failed to leave game');
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

/**
 * Your all-time tally, derived server-side from every finished game you were in.
 * The service worker can serve a cached lobby payload from before this shipped,
 * so a missing record reads as 0–0 rather than blanking the page.
 */
function RecordPanel({ record }: { record?: PlayerRecord }) {
    const { wins, losses } = record ?? { wins: 0, losses: 0 };
    const played = wins + losses;
    return (
        <section className="panel record-panel">
            <h2>Your record</h2>
            <div className="record-stats">
                <div className="record-stat record-stat--win">
                    <strong>{wins}</strong>
                    <span>won</span>
                </div>
                <div className="record-stat record-stat--loss">
                    <strong>{losses}</strong>
                    <span>lost</span>
                </div>
                <div className="record-stat">
                    <strong>{played ? `${Math.round((wins / played) * 100)}%` : '—'}</strong>
                    <span>win rate</span>
                </div>
            </div>
            {played === 0 && <p className="muted">Finish a game to start your record.</p>}
        </section>
    );
}

/** Who took a finished game, phrased from the viewer's point of view. */
function winnerLabel(game: GameSummary, me: PublicUser): string {
    if (!game.winnerId) return 'Ended with no winner';
    if (game.winnerId === me.id) return 'You won';
    const winner = game.players.find((p) => p.userId === game.winnerId);
    return `${winner?.name || 'Another player'} won`;
}

function GameListSection({
    title,
    games,
    me,
    empty,
    joinable,
    onClose,
    onExit,
}: {
    title: string;
    games: GameSummary[];
    me: PublicUser;
    empty: string;
    joinable?: boolean;
    onClose?: (id: string) => void;
    onExit?: (id: string) => void;
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
                                {g.status === 'finished' && (
                                    <div
                                        className={`winner-line ${
                                            g.winnerId === me.id ? 'winner-line--mine' : ''
                                        }`}
                                    >
                                        {winnerLabel(g, me)}
                                    </div>
                                )}
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
                                {onExit && g.status === 'finished' && (
                                    <button
                                        className="btn btn-ghost"
                                        onClick={() => onExit(g.id)}
                                    >
                                        Exit
                                    </button>
                                )}
                                {onClose && g.hostId === me.id && g.status !== 'finished' && (
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

function CreateGame({
    onCreated,
    blocking,
}: {
    onCreated: (id: string) => void;
    blocking: GameSummary | null;
}) {
    const [type, setType] = useState<GameType>('splendor');
    const [visibility, setVisibility] = useState<GameVisibility>('private');
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
            {blocking ? (
                <p className="muted">
                    You already have a game (<strong>{blocking.name}</strong>). Leave or close it
                    before creating another.
                </p>
            ) : null}
            {error && <p className="error">{error}</p>}
            <div className="create-actions">
                <button
                    className="btn btn-primary"
                    disabled={busy || blocking != null}
                    onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                            const g = await api.createGame({ type, visibility });
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
            </div>
        </section>
    );
}

function JoinGame({ onJoined }: { onJoined: (id: string) => void }) {
    const [code, setCode] = useState('');
    const [error, setError] = useState<string | null>(null);

    return (
        <section className="panel">
            <h2>Join game</h2>
            {error && <p className="error">{error}</p>}
            <div className="create-actions">
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
                                onJoined(g.id);
                            } catch (e) {
                                setError(e instanceof ApiError ? e.message : 'Failed to join');
                            }
                        }}
                    >
                        Join
                    </button>
                </div>
            </div>
        </section>
    );
}
