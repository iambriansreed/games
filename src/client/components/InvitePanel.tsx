import { useEffect, useState } from 'react';
import { PublicUser } from '../../shared/types';
import { api, ApiError } from '../api';

export function InvitePanel({
    gameId,
    joinLink,
    joinCode,
}: {
    gameId: string;
    joinLink: string;
    joinCode: string;
}) {
    const [q, setQ] = useState('');
    const [results, setResults] = useState<PublicUser[]>([]);
    const [invited, setInvited] = useState<Record<string, boolean>>({});
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (q.trim().length < 2) {
            setResults([]);
            return;
        }
        let cancelled = false;
        const t = setTimeout(async () => {
            try {
                const { users } = await api.searchUsers(q.trim());
                if (!cancelled) setResults(users);
            } catch {
                /* ignore */
            }
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [q]);

    return (
        <section className="panel">
            <h2>Invite players</h2>

            <div className="share-row">
                <code className="join-code-pill">{joinCode}</code>
                <button
                    className="btn"
                    onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(joinLink);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                        } catch {
                            /* ignore */
                        }
                    }}
                >
                    {copied ? 'Copied!' : 'Copy invite link'}
                </button>
            </div>

            <label className="field">
                <span>Find a player</span>
                <input
                    value={q}
                    placeholder="Search by name or email"
                    onChange={(e) => setQ(e.target.value)}
                />
            </label>
            {error && <p className="error">{error}</p>}
            {results.length > 0 && (
                <ul className="list">
                    {results.map((u) => (
                        <li key={u.id} className="list-row">
                            <div>
                                <strong>{u.name || u.email}</strong>
                                <div className="muted">{u.email}</div>
                            </div>
                            <button
                                className="btn"
                                disabled={invited[u.id]}
                                onClick={async () => {
                                    try {
                                        await api.invite(gameId, u.id);
                                        setInvited((m) => ({ ...m, [u.id]: true }));
                                    } catch (e) {
                                        setError(e instanceof ApiError ? e.message : 'Failed');
                                    }
                                }}
                            >
                                {invited[u.id] ? 'Invited' : 'Invite'}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
