import { useCallback, useEffect, useState } from 'react';
import { GameDetail, PublicUser } from '../../shared/types';
import { api, ApiError } from '../api';
import { getSocket } from '../socket';
import { navigate } from '../router';
import { InvitePanel } from './InvitePanel';
import { SplendorBoard } from './splendor/SplendorBoard';
import { playSfx } from '../sfx';

export function GameView({
    gameId,
    me,
    onTitleChange,
}: {
    gameId: string;
    me: PublicUser;
    onTitleChange?: (title: string | null) => void;
}) {
    const [detail, setDetail] = useState<GameDetail | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setDetail(await api.getGame(gameId));
        } catch (e) {
            setErr(e instanceof ApiError ? e.message : 'Failed to load game');
        }
    }, [gameId]);

    useEffect(() => {
        void load();
        const socket = getSocket();
        const onUpdate = (d: GameDetail) => {
            if (d.id === gameId) setDetail(d);
        };
        const onClosed = (id: string) => {
            if (id === gameId) navigate('/');
        };
        const onRematch = (p: { from: string; to: string }) => {
            if (p.from === gameId) navigate(`/g/${p.to}`);
        };
        const join = () => socket.emit('game:join', gameId);
        socket.on('game:update', onUpdate);
        socket.on('game:closed', onClosed);
        socket.on('game:rematch', onRematch);
        socket.on('connect', join);
        join();
        return () => {
            socket.emit('game:leave', gameId);
            socket.off('game:update', onUpdate);
            socket.off('game:closed', onClosed);
            socket.off('game:rematch', onRematch);
            socket.off('connect', join);
        };
    }, [gameId, load]);

    // Surface the game's name to the app header while this view is mounted.
    useEffect(() => {
        if (!onTitleChange) return;
        const title = detail
            ? detail.type.charAt(0).toUpperCase() + detail.type.slice(1)
            : null;
        onTitleChange(title);
        return () => onTitleChange(null);
    }, [detail, onTitleChange]);

    const showToast = useCallback((msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 2600);
    }, []);

    const dispatch = useCallback(
        async (action: unknown) => {
            try {
                const d = await api.action(gameId, action);
                setDetail(d);
            } catch (e) {
                playSfx('error');
                showToast(e instanceof ApiError ? e.message : 'Illegal move');
            }
        },
        [gameId, showToast],
    );

    if (err) return <div className="game-view"><p className="error">{err}</p></div>;
    if (!detail) return <div className="game-view"><p className="muted">Loading game…</p></div>;

    return (
        <div className="game-view">
            {toast && <div className="toast">{toast}</div>}
            {detail.status === 'lobby' ? (
                <WaitingRoom detail={detail} me={me} onChange={load} />
            ) : (
                <SplendorBoard detail={detail} me={me} dispatch={dispatch} onToast={showToast} />
            )}
        </div>
    );
}

function WaitingRoom({
    detail,
    me,
    onChange,
}: {
    detail: GameDetail;
    me: PublicUser;
    onChange: () => void;
}) {
    const isHost = detail.hostId === me.id;
    const isParticipant = detail.players.some((p) => p.userId === me.id);
    const canStart = isHost && detail.players.length >= detail.minPlayers;
    const link = `${window.location.origin}/join/${detail.joinCode}`;

    return (
        <div className="waiting">
            <div className="waiting-head">
                <h1>{detail.name}</h1>
                <span className="muted">
                    {detail.type} · {detail.visibility}
                </span>
            </div>

            <section className="panel">
                <h2>Players ({detail.players.length}/{detail.maxPlayers})</h2>
                <ul className="player-chips">
                    {detail.players.map((p) => (
                        <li key={p.userId} className="player-chip">
                            {p.picture ? (
                                <img className="avatar sm" src={p.picture} alt="" referrerPolicy="no-referrer" />
                            ) : (
                                <span className="avatar sm avatar-fallback">
                                    {(p.name || '?').charAt(0).toUpperCase()}
                                </span>
                            )}
                            <span>{p.userId === me.id ? 'You' : p.name || 'Player'}</span>
                            {/* Optional-chained: a cached pre-update payload has no record. */}
                            <span
                                className="chip-record"
                                title={`${p.record?.wins ?? 0} won · ${p.record?.losses ?? 0} lost`}
                            >
                                {p.record?.wins ?? 0}–{p.record?.losses ?? 0}
                            </span>
                            {p.userId === detail.hostId && <span className="tag">host</span>}
                        </li>
                    ))}
                </ul>
            </section>

            {isParticipant && (
                <InvitePanel gameId={detail.id} joinLink={link} joinCode={detail.joinCode} />
            )}

            <div className="waiting-actions">
                {isHost ? (
                    <button
                        className="btn btn-primary"
                        disabled={!canStart}
                        onClick={async () => {
                            await api.startGame(detail.id);
                            onChange();
                        }}
                    >
                        {canStart
                            ? 'Start game'
                            : `Need ${detail.minPlayers}+ players`}
                    </button>
                ) : isParticipant ? (
                    <p className="muted">Waiting for the host to start…</p>
                ) : (
                    <button
                        className="btn btn-primary"
                        onClick={async () => {
                            await api.joinGame(detail.id);
                            onChange();
                        }}
                    >
                        Join game
                    </button>
                )}
                {isParticipant && !isHost && (
                    <button
                        className="btn btn-ghost"
                        onClick={async () => {
                            await api.leaveGame(detail.id);
                            navigate('/');
                        }}
                    >
                        Leave
                    </button>
                )}
            </div>
        </div>
    );
}
