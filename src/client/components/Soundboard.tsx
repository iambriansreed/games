import { useEffect, useRef, useState } from 'react';
import { isSfxOn, playSfx, playSfxVariant, setSfxOn, SfxName, sfxVariantCount } from '../sfx';

// An unlisted preview page (/dev/sounds) of every sound effect in the game: what
// it sounds like, when it plays, and a button for each of its variants. Nothing
// links here — the README gives the address.

interface Entry {
    name: SfxName;
    label: string;
    /** When the game plays it. */
    when: string;
    /** Gap to leave after it in "Play all", for the longer sounds. */
    length?: number;
}

interface Group {
    title: string;
    entries: Entry[];
}

const GROUPS: Group[] = [
    {
        title: 'Chips',
        entries: [
            {
                name: 'chip-pick',
                label: 'Chip pick',
                when: 'Tapping a bank chip to select it (tap it again for a pair), or a chip in the return-tokens prompt.',
            },
            {
                name: 'chip-unpick',
                label: 'Chip unpick',
                when: 'Deselecting a chip, removing one from the return list, or tapping any chip in a tray.',
            },
            {
                name: 'chip-lift',
                label: 'Chip lift',
                when: 'A chip leaves the bank as a take (or a reserve’s gold) starts to fly — yours or an opponent’s, one per chip, staggered.',
            },
            {
                name: 'chip-land',
                label: 'Chip land',
                when: 'A flying chip lands in a player’s tray.',
            },
            {
                name: 'coins',
                label: 'Pay out',
                when: 'Chips going back to the bank: paying for a card, or returning the excess over ten.',
            },
        ],
    },
    {
        title: 'Cards',
        entries: [
            {
                name: 'card-slide',
                label: 'Card slide',
                when: 'Tapping a card to open Buy / Reserve; a card flying to a collection or reserve pile; a new card dealt into the empty slot; a noble gliding off the board; opening a reserved card.',
            },
            {
                name: 'card-land',
                label: 'Card land',
                when: 'A flying card lands in its collection or reserve pile.',
            },
        ],
    },
    {
        title: 'Celebrations',
        entries: [
            {
                name: 'twinkle',
                label: 'Twinkle',
                when: 'A rainbow — completing a set of one card of every colour. Several bursts across the arc’s sweep, more for a double or triple.',
            },
            {
                name: 'noble',
                label: 'Noble chime',
                when: 'A noble arrives in a player’s court.',
                length: 1800,
            },
        ],
    },
    {
        title: 'Turns',
        entries: [
            {
                name: 'turn-mine',
                label: 'Your turn',
                when: 'The “Your turn” announcement, and its reminder after thirty idle seconds.',
                length: 1800,
            },
            {
                name: 'turn-other',
                label: 'Their turn',
                when: 'Another player’s turn announcement.',
            },
        ],
    },
    {
        title: 'Interface',
        entries: [
            {
                name: 'ui-tap',
                label: 'Tap',
                when: 'Buttons — Take, Confirm, Continue, Skip, a noble choice, Play again, Leave — and a soft tap anywhere else on the table.',
            },
            {
                name: 'cancel',
                label: 'Cancel',
                when: 'Dismissing a menu or prompt: the × buttons, or tapping the dimmed backdrop.',
            },
            {
                name: 'error',
                label: 'Refused',
                when: 'An action the rules refuse — not your turn, can’t afford it, no chips left, a full return list — alongside its toast.',
            },
            {
                name: 'rewind',
                label: 'Rewind',
                when: 'Starting a replay of the moves you missed.',
            },
        ],
    },
    {
        title: 'Game flow',
        entries: [
            {
                name: 'final-round',
                label: 'Final round',
                when: 'The last-round banner appears.',
            },
            {
                name: 'win',
                label: 'Victory',
                when: 'Game over, and you won.',
                length: 2200,
            },
            {
                name: 'lose',
                label: 'Defeat',
                when: 'Game over, and you lost.',
                length: 2000,
            },
        ],
    },
];

const ALL = GROUPS.flatMap((g) => g.entries);

export function Soundboard() {
    const [on, setOn] = useState(() => isSfxOn());
    // The entry lit up as it plays, and the running "Play all" sequence.
    const [playing, setPlaying] = useState<SfxName | null>(null);
    const [touring, setTouring] = useState(false);
    const timers = useRef<number[]>([]);

    function clearTimers() {
        timers.current.forEach((t) => window.clearTimeout(t));
        timers.current = [];
    }
    useEffect(() => clearTimers, []);

    function flash(name: SfxName, ms = 600) {
        setPlaying(name);
        timers.current.push(window.setTimeout(() => setPlaying((p) => (p === name ? null : p)), ms));
    }

    function play(name: SfxName, variant?: number) {
        if (variant == null) playSfx(name);
        else playSfxVariant(name, variant);
        flash(name);
    }

    // Every effect in order, one random variant each, spaced for the longer ones.
    function playAll() {
        if (touring) {
            clearTimers();
            setTouring(false);
            setPlaying(null);
            return;
        }
        setTouring(true);
        let at = 0;
        for (const e of ALL) {
            const len = e.length ?? 900;
            timers.current.push(
                window.setTimeout(() => {
                    playSfx(e.name);
                    flash(e.name, len - 100);
                }, at),
            );
            at += len;
        }
        timers.current.push(window.setTimeout(() => setTouring(false), at));
    }

    function toggle(next: boolean) {
        setSfxOn(next);
        setOn(next);
        if (next) playSfx('ui-tap');
    }

    return (
        <div className="soundboard">
            <section className="panel">
                <div className="soundboard-head">
                    <div>
                        <h2>Soundboard</h2>
                        <p className="muted settings-hint">
                            Every sound effect, when it plays, and a button for each of its variants. In
                            the game, variants are picked at random and never repeat back to back.
                        </p>
                    </div>
                    <div className="soundboard-controls">
                        <div className="seg">
                            <button className={on ? 'seg-on' : ''} onClick={() => toggle(true)}>
                                🔊 On
                            </button>
                            <button className={!on ? 'seg-on' : ''} onClick={() => toggle(false)}>
                                🔇 Off
                            </button>
                        </div>
                        <button className="btn btn-primary sfx-play-all" onClick={playAll}>
                            {touring ? '■ Stop' : '▶ Play all'}
                        </button>
                    </div>
                </div>
                {!on && (
                    <p className="muted settings-hint">
                        Sound effects are switched off, so the buttons below stay silent until you turn
                        them on (this is the same setting as Settings → Sound).
                    </p>
                )}
            </section>

            {GROUPS.map((g) => (
                <section className="panel" key={g.title}>
                    <h2>{g.title}</h2>
                    <div className="sfx-list">
                        {g.entries.map((e) => {
                            const n = sfxVariantCount(e.name);
                            return (
                                <div
                                    className={`sfx-row ${playing === e.name ? 'is-playing' : ''}`}
                                    key={e.name}
                                    data-sfx={e.name}
                                >
                                    <div className="sfx-top">
                                        <span className="sfx-label">{e.label}</span>
                                        <span className="sfx-meta muted">
                                            <code>{e.name}</code> · {n} variant{n === 1 ? '' : 's'}
                                        </span>
                                    </div>
                                    <p className="sfx-when muted">{e.when}</p>
                                    <div className="sfx-buttons">
                                        <button className="btn btn-primary sfx-play" onClick={() => play(e.name)}>
                                            ▶ Play
                                        </button>
                                        {Array.from({ length: n }, (_, i) => (
                                            <button
                                                className="btn sfx-variant"
                                                key={i}
                                                title={`Variant ${i + 1}`}
                                                onClick={() => play(e.name, i)}
                                            >
                                                {i + 1}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            ))}
        </div>
    );
}
