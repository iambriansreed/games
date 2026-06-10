import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GameSummary, PublicUser } from '../../shared/types';

export function Header({
    user,
    title,
    games = [],
    currentGameId,
    onOpenGame,
    onHome,
    onSettings,
    onLogout,
    showReturnToGame,
    onReturnToGame,
}: {
    user: PublicUser;
    title?: string;
    games?: GameSummary[];
    currentGameId?: string;
    onOpenGame?: (id: string) => void;
    onHome: () => void;
    onSettings: () => void;
    onLogout: () => void;
    showReturnToGame: boolean;
    onReturnToGame: () => void;
}) {
    const initial = (user.name || user.email || '?').charAt(0).toUpperCase();
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, right: 0 });
    const anchorRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Position the portalled menu under the avatar (right-aligned).
    useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
            const r = anchorRef.current?.getBoundingClientRect();
            if (r) setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            const t = e.target as Node;
            if (anchorRef.current?.contains(t) || menuRef.current?.contains(t)) return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
        document.addEventListener('mousedown', onDoc);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDoc);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return (
        <header className="header">
            <button className="brand" onClick={onHome}>
                <span className="brand-dot" />
                {title || 'Games'}
            </button>
            <div className="header-right">
                {showReturnToGame && (
                    <button className="btn btn-primary header-return" onClick={onReturnToGame}>
                        Return to game
                    </button>
                )}
                <div className="user-menu">
                    <button
                        ref={anchorRef}
                        className="avatar-btn"
                        onClick={() => setOpen((o) => !o)}
                        aria-haspopup="menu"
                        aria-expanded={open}
                        aria-label="Account menu"
                    >
                        {user.picture ? (
                            <img className="avatar" src={user.picture} alt="" referrerPolicy="no-referrer" />
                        ) : (
                            <span className="avatar avatar-fallback">{initial}</span>
                        )}
                    </button>
                    {open &&
                        createPortal(
                            <>
                                <div className="backdrop is-open" onClick={() => setOpen(false)} />
                                <div
                                    ref={menuRef}
                                    className="menu-dropdown"
                                    role="menu"
                                    style={{ position: 'fixed', top: pos.top, right: pos.right }}
                                >
                                    <div className="menu-user">
                                        <strong>{user.name || 'Signed in'}</strong>
                                        <span className="muted">{user.email}</span>
                                    </div>
                                    <div className="menu-section">
                                        <div className="menu-section-label">Your games</div>
                                        {games.length === 0 ? (
                                            <div className="menu-empty muted">No active games</div>
                                        ) : (
                                            games.map((g) => (
                                                <button
                                                    key={g.id}
                                                    className={`menu-item menu-game ${
                                                        g.id === currentGameId ? 'is-current' : ''
                                                    }`}
                                                    role="menuitem"
                                                    onClick={() => {
                                                        setOpen(false);
                                                        onOpenGame?.(g.id);
                                                    }}
                                                >
                                                    <span className="menu-game-name">{g.name}</span>
                                                    <span className="menu-game-meta muted">
                                                        {g.status === 'lobby' ? 'Waiting' : g.type}
                                                    </span>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                    <button
                                        className="menu-item"
                                        role="menuitem"
                                        onClick={() => {
                                            setOpen(false);
                                            onSettings();
                                        }}
                                    >
                                        <span>Settings</span>
                                    </button>
                                    <button
                                        className="menu-item"
                                        role="menuitem"
                                        onClick={() => {
                                            setOpen(false);
                                            onLogout();
                                        }}
                                    >
                                        <span>Sign out</span>
                                    </button>
                                </div>
                            </>,
                            document.body,
                        )}
                </div>
            </div>
        </header>
    );
}
