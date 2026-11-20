import { useState } from 'react';
import { PublicUser } from '../../shared/types';
import { api, ApiError } from '../api';
import { navigate } from '../router';
import { getStoredTheme, setTheme, Theme } from '../theme';
import { isSfxOn, playSfx, setSfxOn } from '../sfx';

// Keys/labels mirror SPLENDOR_SCENARIOS in src/shared/splendor/dev.ts.
const SPLENDOR_DEV_SCENARIOS: { key: string; label: string; description: string }[] = [
    {
        key: 'reserved-and-nobles',
        label: 'You: 3 reserved cards + 3 nobles',
        description: "Your turn, holding 3 reserved cards and 3 nobles.",
    },
    {
        key: 'about-to-win',
        label: 'Your next move wins',
        description: 'Your turn with the most points — any move ends the game in your win.',
    },
    {
        key: 'opponent-loaded',
        label: '1v1: opponent has reserves + nobles',
        description: 'A 2-player game where the other player holds reserved cards and nobles.',
    },
];

export function Settings({
    user,
    isAdmin,
    onUserUpdated,
}: {
    user: PublicUser;
    isAdmin: boolean;
    onUserUpdated: (user: PublicUser) => void;
}) {
    const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
    const [sfx, setSfxState] = useState<boolean>(() => isSfxOn());

    const [name, setName] = useState(user.name ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    const [devBusy, setDevBusy] = useState<string | null>(null);
    const [devError, setDevError] = useState<string | null>(null);

    async function loadScenario(key: string) {
        setDevBusy(key);
        setDevError(null);
        try {
            const game = await api.devSplendorScenario(key);
            navigate(`/g/${game.id}`);
        } catch (e) {
            setDevError(e instanceof ApiError ? e.message : 'Failed to load scenario');
        } finally {
            setDevBusy(null);
        }
    }

    function chooseTheme(next: Theme) {
        setTheme(next);
        setThemeState(next);
    }

    function chooseSfx(on: boolean) {
        setSfxOn(on);
        setSfxState(on);
        // Confirm the choice audibly — the one tap that should always be heard.
        if (on) playSfx('ui-tap');
    }

    const trimmed = name.trim();
    const dirty = trimmed !== (user.name ?? '').trim();

    async function saveName() {
        if (!trimmed || !dirty) return;
        setBusy(true);
        setError(null);
        setSaved(false);
        try {
            const updated = await api.updateName(trimmed);
            onUserUpdated(updated);
            setName(updated.name ?? '');
            setSaved(true);
        } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Failed to save');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="settings">
            <section className="panel">
                <h2>Profile</h2>
                <label className="field">
                    <span>Username</span>
                    <input
                        value={name}
                        maxLength={40}
                        placeholder="Your display name"
                        onChange={(e) => {
                            setName(e.target.value);
                            setSaved(false);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveName();
                        }}
                    />
                </label>
                <p className="muted settings-hint">Signed in as {user.email}</p>
                {error && <p className="error">{error}</p>}
                <div className="settings-actions">
                    <button
                        className="btn btn-primary"
                        disabled={busy || !trimmed || !dirty}
                        onClick={() => void saveName()}
                    >
                        {busy ? 'Saving…' : 'Save'}
                    </button>
                    {saved && !dirty && <span className="muted">Saved</span>}
                </div>
            </section>

            <section className="panel">
                <h2>Appearance</h2>
                <div className="field">
                    <span>Theme</span>
                    <div className="seg">
                        <button
                            className={theme === 'light' ? 'seg-on' : ''}
                            onClick={() => chooseTheme('light')}
                        >
                            ☀ Light
                        </button>
                        <button
                            className={theme === 'dark' ? 'seg-on' : ''}
                            onClick={() => chooseTheme('dark')}
                        >
                            ☾ Dark
                        </button>
                    </div>
                </div>
            </section>

            <section className="panel">
                <h2>Sound</h2>
                <div className="field">
                    <span>Sound effects</span>
                    <div className="seg">
                        <button className={sfx ? 'seg-on' : ''} onClick={() => chooseSfx(true)}>
                            🔊 On
                        </button>
                        <button className={!sfx ? 'seg-on' : ''} onClick={() => chooseSfx(false)}>
                            🔇 Off
                        </button>
                    </div>
                </div>
                <p className="muted settings-hint">
                    Chips clack, cards slide and nobles chime as moves play out — yours and your
                    opponents’.
                </p>
            </section>

            {isAdmin && (
                <section className="panel">
                    <h2>Dev tools</h2>
                    <p className="muted settings-hint">
                        Load a Splendor scenario for testing. Each creates a private game against a
                        “Dev Bot” and drops you into it.
                    </p>
                    {devError && <p className="error">{devError}</p>}
                    <div className="dev-tools">
                        <button
                            className="btn dev-tool"
                            disabled={devBusy != null}
                            onClick={() => navigate('/dev/animations')}
                        >
                            <span className="dev-tool-label">▶ Test animations</span>
                            <span className="dev-tool-desc">
                                Play every Splendor animation back to back — tokens, card buy/reserve,
                                noble visit, rainbow, turn change, final round, and game over.
                            </span>
                        </button>
                        {SPLENDOR_DEV_SCENARIOS.map((s) => (
                            <button
                                key={s.key}
                                className="btn dev-tool"
                                disabled={devBusy != null}
                                onClick={() => void loadScenario(s.key)}
                            >
                                <span className="dev-tool-label">
                                    {devBusy === s.key ? 'Loading…' : s.label}
                                </span>
                                <span className="dev-tool-desc">{s.description}</span>
                            </button>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
