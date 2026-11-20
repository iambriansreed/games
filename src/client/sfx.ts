// Sound effects for the games, synthesised on the fly with the Web Audio API —
// there are no audio files to ship, cache or fail to load. Every effect has a
// handful of variants (a different pitch, timing or pattern) and each play picks
// one at random, never the one that played last for that effect, so a run of
// chip taps or card slides doesn't sound like the same sample on repeat.
//
// Browsers only let audio start after a user gesture, so `installSfxUnlock`
// opens (and re-opens, after the app is backgrounded) the audio context on any
// tap or key. Sounds asked for while the context is still locked are dropped
// rather than queued, so unlocking never releases a burst of stale clicks.

export type SfxName =
    // Poker-chip tokens: selecting / deselecting in the bank or return prompt,
    // a chip lifting off the bank, a chip landing in a tray, paying for a card.
    | 'chip-pick'
    | 'chip-unpick'
    | 'chip-lift'
    | 'chip-land'
    | 'coins'
    // Development cards sliding out of the row and landing in a collection.
    | 'card-slide'
    | 'card-land'
    // Celebrations: the rainbow's twinkles and a noble's chime.
    | 'twinkle'
    | 'noble'
    // Turn announcements.
    | 'turn-mine'
    | 'turn-other'
    // UI: buttons, dismissals, refused actions, the replay rewind.
    | 'ui-tap'
    | 'cancel'
    | 'error'
    | 'rewind'
    // Game flow.
    | 'final-round'
    | 'win'
    | 'lose';

type Synth = (ctx: AudioContext, out: AudioNode, t: number) => void;

// ---------------------------------------------------------------------------
// Preference
// ---------------------------------------------------------------------------

const PREF_KEY = 'games_sfx';
let enabled: boolean | null = null;

export function isSfxOn(): boolean {
    if (enabled == null) {
        try {
            enabled = localStorage.getItem(PREF_KEY) !== 'off';
        } catch {
            enabled = true;
        }
    }
    return enabled;
}

export function setSfxOn(on: boolean): void {
    enabled = on;
    try {
        localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
    } catch {
        /* ignore — the in-memory flag still applies for this session */
    }
}

// ---------------------------------------------------------------------------
// Audio context + unlock
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
        ctx = new AC();
        // A gentle compressor keeps a flurry of chips (three landing at once, say)
        // from clipping, without squashing a single sound.
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 20;
        comp.ratio.value = 4;
        comp.attack.value = 0.003;
        comp.release.value = 0.2;
        master = ctx.createGain();
        master.gain.value = 0.6;
        master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    return ctx;
}

/**
 * Open the audio context on the first user gesture and keep nudging it awake on
 * later ones — mobile browsers suspend it whenever the app goes to the
 * background, and only a gesture may bring it back. Safe to call once at boot.
 */
export function installSfxUnlock(): void {
    if (typeof window === 'undefined') return;
    const unlock = () => {
        if (isSfxOn()) ensureContext();
    };
    for (const e of ['pointerdown', 'touchend', 'keydown'] as const) {
        window.addEventListener(e, unlock, { capture: true, passive: true });
    }
}

// ---------------------------------------------------------------------------
// Variant picking: random, but never the same variant twice in a row
// ---------------------------------------------------------------------------

const lastVariant = new Map<SfxName, number>();

function pickVariant(name: SfxName, n: number): number {
    if (n <= 1) return 0;
    const prev = lastVariant.get(name);
    // Draw from n-1 slots and skip past the previous index, so every other
    // variant stays equally likely and the last one is never repeated.
    let i = Math.floor(Math.random() * (prev == null ? n : n - 1));
    if (prev != null && i >= prev) i += 1;
    lastVariant.set(name, i);
    return i;
}

/**
 * Play an effect. `delayMs` schedules it a little later on the audio clock,
 * which is how a stagger of chips lands one clack at a time.
 */
export function playSfx(name: SfxName, delayMs = 0): void {
    schedule(name, pickVariant(name, BANK[name].length), delayMs);
}

/** Play one specific variant of an effect (the soundboard's per-variant buttons). */
export function playSfxVariant(name: SfxName, variant: number, delayMs = 0): void {
    const n = BANK[name].length;
    const i = ((variant % n) + n) % n;
    lastVariant.set(name, i);
    schedule(name, i, delayMs);
}

/** How many variants an effect has — for the soundboard's per-variant buttons. */
export function sfxVariantCount(name: SfxName): number {
    return BANK[name].length;
}

function schedule(name: SfxName, variant: number, delayMs: number): void {
    if (!isSfxOn()) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const c = ensureContext();
    if (!c || !master) return;
    // Still locked (no gesture yet) or suspended: drop it rather than queue it.
    if (c.state !== 'running') return;
    const synth = BANK[name][variant];
    const t = c.currentTime + Math.max(0, delayMs) / 1000 + 0.005;
    try {
        synth(c, master, t);
    } catch {
        /* sound is garnish — never let it break the game */
    }
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

let noiseBuf: AudioBuffer | null = null;

/** One second of white noise, built once per context and reused by every burst. */
function noiseBuffer(c: AudioContext): AudioBuffer {
    if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
        noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
}

/** Percussive envelope: near-instant attack, exponential decay to silence. */
function envelope(c: AudioContext, t: number, dur: number, gain: number, attack: number): GainNode {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
}

function tone(
    c: AudioContext,
    out: AudioNode,
    o: {
        t: number;
        freq: number;
        dur: number;
        gain: number;
        type?: OscillatorType;
        attack?: number;
        /** Glide the pitch to this frequency over the sound's length. */
        slideTo?: number;
    },
): void {
    const osc = c.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, o.t);
    if (o.slideTo != null) osc.frequency.exponentialRampToValueAtTime(o.slideTo, o.t + o.dur);
    const g = envelope(c, o.t, o.dur, o.gain, o.attack ?? 0.003);
    osc.connect(g).connect(out);
    osc.start(o.t);
    osc.stop(o.t + o.dur + 0.03);
}

function noise(
    c: AudioContext,
    out: AudioNode,
    o: {
        t: number;
        dur: number;
        gain: number;
        type?: BiquadFilterType;
        freq: number;
        q?: number;
        /** Sweep the filter to this frequency over the sound's length. */
        freqTo?: number;
        attack?: number;
    },
): void {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const f = c.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(o.freq, o.t);
    if (o.freqTo != null) f.frequency.exponentialRampToValueAtTime(o.freqTo, o.t + o.dur);
    f.Q.value = o.q ?? 1;
    const g = envelope(c, o.t, o.dur, o.gain, o.attack ?? 0.001);
    src.connect(f).connect(g).connect(out);
    // Start somewhere random in the buffer so two bursts never share a grain.
    src.start(o.t, Math.random() * 0.5);
    src.stop(o.t + o.dur + 0.03);
}

/** A bell: the fundamental plus a softer octave and a quick inharmonic partial. */
function bell(c: AudioContext, out: AudioNode, t: number, freq: number, dur: number, gain: number): void {
    tone(c, out, { t, freq, dur, gain });
    tone(c, out, { t, freq: freq * 2, dur: dur * 0.55, gain: gain * 0.3 });
    tone(c, out, { t, freq: freq * 2.76, dur: dur * 0.3, gain: gain * 0.14 });
}

/**
 * A poker chip's click: a filtered snap, a sliver of high-frequency transient
 * and a short low thump as the clay hits.
 */
function chipClick(
    c: AudioContext,
    out: AudioNode,
    t: number,
    o: { freq: number; thump?: number; gain?: number },
): void {
    const gain = o.gain ?? 0.5;
    noise(c, out, { t, dur: 0.045, gain, freq: o.freq, q: 1.6 });
    noise(c, out, { t, dur: 0.018, gain: gain * 0.7, type: 'highpass', freq: 5200 });
    const thump = o.thump ?? 190;
    tone(c, out, { t, freq: thump, dur: 0.05, gain: gain * 0.5, slideTo: thump * 0.6 });
}

/** A short, bright button tick. */
function tick(c: AudioContext, out: AudioNode, t: number, freq: number, gain = 0.25): void {
    tone(c, out, { t, freq, dur: 0.028, gain });
    noise(c, out, { t, dur: 0.012, gain, type: 'highpass', freq: 4000 });
}

// A few notes, by name, so the patterns below read as music rather than numbers.
const N = {
    G3: 196.0,
    A3: 220.0,
    Bb3: 233.08,
    C4: 261.63,
    D4: 293.66,
    Eb4: 311.13,
    E4: 329.63,
    G4: 392.0,
    B4: 493.88,
    C5: 523.25,
    D5: 587.33,
    E5: 659.26,
    F5: 698.46,
    G5: 783.99,
    A5: 880.0,
    B5: 987.77,
    C6: 1046.5,
    D6: 1174.66,
    E6: 1318.51,
    F6: 1396.91,
    G6: 1567.98,
    A6: 1760.0,
    C7: 2093.0,
    E7: 2637.02,
};

/** Bell notes in sequence, each `step` seconds after the last. */
function arpeggio(
    c: AudioContext,
    out: AudioNode,
    t: number,
    notes: number[],
    step: number,
    dur: number,
    gain: number,
): void {
    notes.forEach((f, i) => bell(c, out, t + i * step, f, dur, gain));
}

// ---------------------------------------------------------------------------
// The bank of effects: several variants each
// ---------------------------------------------------------------------------

const BANK: Record<SfxName, Synth[]> = {
    'chip-pick': [
        (c, o, t) => chipClick(c, o, t, { freq: 3000, thump: 190 }),
        (c, o, t) => chipClick(c, o, t, { freq: 3600, thump: 215 }),
        (c, o, t) => chipClick(c, o, t, { freq: 2600, thump: 170 }),
        (c, o, t) => chipClick(c, o, t, { freq: 3300, thump: 200, gain: 0.45 }),
    ],
    'chip-unpick': [
        (c, o, t) => chipClick(c, o, t, { freq: 1800, thump: 140, gain: 0.3 }),
        (c, o, t) => chipClick(c, o, t, { freq: 2200, thump: 150, gain: 0.28 }),
        (c, o, t) => chipClick(c, o, t, { freq: 1500, thump: 130, gain: 0.3 }),
    ],
    'chip-lift': [
        (c, o, t) => {
            noise(c, o, { t, dur: 0.03, gain: 0.22, type: 'highpass', freq: 3000 });
            tone(c, o, { t, freq: 600, dur: 0.06, gain: 0.12, slideTo: 1300 });
        },
        (c, o, t) => {
            noise(c, o, { t, dur: 0.028, gain: 0.2, type: 'highpass', freq: 3600 });
            tone(c, o, { t, freq: 700, dur: 0.055, gain: 0.12, slideTo: 1500 });
        },
        (c, o, t) => {
            noise(c, o, { t, dur: 0.034, gain: 0.22, type: 'highpass', freq: 2600 });
            tone(c, o, { t, freq: 520, dur: 0.07, gain: 0.11, slideTo: 1100 });
        },
    ],
    // Landing on a stack: two clicks almost on top of each other, then the stack
    // settling with a low knock.
    'chip-land': [
        (c, o, t) => {
            chipClick(c, o, t, { freq: 2600, thump: 120, gain: 0.5 });
            chipClick(c, o, t + 0.032, { freq: 3100, thump: 110, gain: 0.3 });
        },
        (c, o, t) => {
            chipClick(c, o, t, { freq: 2900, thump: 125, gain: 0.5 });
            chipClick(c, o, t + 0.042, { freq: 2300, thump: 105, gain: 0.3 });
        },
        (c, o, t) => {
            chipClick(c, o, t, { freq: 3300, thump: 135, gain: 0.48 });
            chipClick(c, o, t + 0.026, { freq: 2700, thump: 115, gain: 0.32 });
        },
        (c, o, t) => {
            chipClick(c, o, t, { freq: 2400, thump: 115, gain: 0.5 });
            chipClick(c, o, t + 0.05, { freq: 2900, thump: 100, gain: 0.26 });
        },
    ],
    // Paying for a card: a quick run of chips sliding back to the bank.
    coins: [
        (c, o, t) =>
            [2200, 2700, 3200].forEach((f, i) =>
                chipClick(c, o, t + i * 0.06, { freq: f, thump: 170 - i * 15, gain: 0.4 }),
            ),
        (c, o, t) =>
            [2600, 2300, 3000, 3400].forEach((f, i) =>
                chipClick(c, o, t + i * 0.052, { freq: f, thump: 160 - i * 10, gain: 0.38 }),
            ),
        (c, o, t) =>
            [3100, 2500, 2900].forEach((f, i) =>
                chipClick(c, o, t + i * 0.07, { freq: f, thump: 180 - i * 20, gain: 0.4 }),
            ),
    ],
    // A card drawn across the felt: a low-pass sweep of noise.
    'card-slide': [
        (c, o, t) => noise(c, o, { t, dur: 0.16, gain: 0.3, type: 'lowpass', freq: 1500, freqTo: 450, attack: 0.02 }),
        (c, o, t) => noise(c, o, { t, dur: 0.2, gain: 0.28, type: 'lowpass', freq: 1200, freqTo: 380, attack: 0.03 }),
        (c, o, t) => noise(c, o, { t, dur: 0.14, gain: 0.3, type: 'lowpass', freq: 1900, freqTo: 600, attack: 0.015 }),
        (c, o, t) => noise(c, o, { t, dur: 0.18, gain: 0.26, type: 'bandpass', freq: 900, freqTo: 350, q: 0.7, attack: 0.03 }),
    ],
    'card-land': [
        (c, o, t) => {
            tone(c, o, { t, freq: 200, dur: 0.07, gain: 0.35, slideTo: 120 });
            noise(c, o, { t, dur: 0.04, gain: 0.3, type: 'lowpass', freq: 800 });
        },
        (c, o, t) => {
            tone(c, o, { t, freq: 230, dur: 0.065, gain: 0.33, slideTo: 130 });
            noise(c, o, { t, dur: 0.035, gain: 0.3, type: 'lowpass', freq: 1000 });
        },
        (c, o, t) => {
            tone(c, o, { t, freq: 180, dur: 0.08, gain: 0.36, slideTo: 110 });
            noise(c, o, { t, dur: 0.045, gain: 0.28, type: 'lowpass', freq: 700 });
        },
    ],
    // Rainbow twinkles: little bell runs in a high pentatonic.
    twinkle: [
        (c, o, t) => arpeggio(c, o, t, [N.C6, N.E6, N.G6, N.C7, N.E7], 0.08, 0.5, 0.2),
        (c, o, t) => arpeggio(c, o, t, [N.E7, N.C7, N.G6, N.E6], 0.09, 0.55, 0.2),
        (c, o, t) => arpeggio(c, o, t, [N.G6, N.C7, N.E6, N.A6, N.C6, N.E7], 0.075, 0.45, 0.19),
        (c, o, t) => arpeggio(c, o, t, [N.A6, N.E6, N.C7, N.G6, N.E7], 0.1, 0.5, 0.2),
        (c, o, t) => arpeggio(c, o, t, [N.D6, N.G6, N.A6, N.D6 * 2, N.E7], 0.085, 0.5, 0.2),
    ],
    // A noble's visit: a two-note chime with a little shimmer.
    noble: [
        (c, o, t) => {
            bell(c, o, t, N.E5, 1.1, 0.32);
            bell(c, o, t + 0.18, N.B5, 1.4, 0.32);
            noise(c, o, { t: t + 0.18, dur: 0.3, gain: 0.05, type: 'highpass', freq: 6000, attack: 0.05 });
        },
        (c, o, t) => {
            bell(c, o, t, N.G5, 1.1, 0.32);
            bell(c, o, t + 0.18, N.D6, 1.4, 0.32);
            noise(c, o, { t: t + 0.18, dur: 0.3, gain: 0.05, type: 'highpass', freq: 6000, attack: 0.05 });
        },
        (c, o, t) => {
            bell(c, o, t, N.A5, 1.1, 0.32);
            bell(c, o, t + 0.2, N.E6, 1.4, 0.32);
            noise(c, o, { t: t + 0.2, dur: 0.3, gain: 0.05, type: 'highpass', freq: 6000, attack: 0.05 });
        },
    ],
    // Your turn: a warm, rolled major chord.
    'turn-mine': [
        (c, o, t) => arpeggio(c, o, t, [N.C5, N.E5, N.G5], 0.07, 1.4, 0.24),
        (c, o, t) => arpeggio(c, o, t, [N.F5, N.A5, N.C6], 0.07, 1.4, 0.22),
        (c, o, t) => arpeggio(c, o, t, [N.G4, N.B4, N.D5, N.G5], 0.065, 1.5, 0.22),
    ],
    // Someone else's turn: a soft woodblock tap.
    'turn-other': [
        (c, o, t) => {
            tone(c, o, { t, freq: 480, dur: 0.09, gain: 0.22, slideTo: 420 });
            noise(c, o, { t, dur: 0.03, gain: 0.18, freq: 1200, q: 3 });
        },
        (c, o, t) => {
            tone(c, o, { t, freq: 560, dur: 0.085, gain: 0.22, slideTo: 480 });
            noise(c, o, { t, dur: 0.03, gain: 0.18, freq: 1400, q: 3 });
        },
        (c, o, t) => {
            tone(c, o, { t, freq: 430, dur: 0.1, gain: 0.22, slideTo: 380 });
            noise(c, o, { t, dur: 0.03, gain: 0.18, freq: 1000, q: 3 });
        },
    ],
    'ui-tap': [
        (c, o, t) => tick(c, o, t, 1500),
        (c, o, t) => tick(c, o, t, 1300),
        (c, o, t) => tick(c, o, t, 1750),
    ],
    // Dismiss / cancel: a short downward whoosh.
    cancel: [
        (c, o, t) => noise(c, o, { t, dur: 0.14, gain: 0.3, freq: 1600, freqTo: 450, q: 1.2, attack: 0.01 }),
        (c, o, t) => noise(c, o, { t, dur: 0.18, gain: 0.28, freq: 1300, freqTo: 380, q: 1.2, attack: 0.015 }),
        (c, o, t) => noise(c, o, { t, dur: 0.12, gain: 0.3, freq: 2000, freqTo: 600, q: 1.4, attack: 0.008 }),
    ],
    // Refused: a dull thud.
    error: [
        (c, o, t) => {
            tone(c, o, { t, freq: 120, dur: 0.16, gain: 0.5, type: 'triangle', slideTo: 70 });
            noise(c, o, { t, dur: 0.08, gain: 0.3, type: 'lowpass', freq: 400 });
        },
        (c, o, t) => {
            tone(c, o, { t, freq: 135, dur: 0.15, gain: 0.5, type: 'triangle', slideTo: 80 });
            noise(c, o, { t, dur: 0.07, gain: 0.3, type: 'lowpass', freq: 450 });
        },
        (c, o, t) => {
            tone(c, o, { t, freq: 100, dur: 0.18, gain: 0.5, type: 'triangle', slideTo: 60 });
            noise(c, o, { t, dur: 0.09, gain: 0.3, type: 'lowpass', freq: 350 });
        },
    ],
    // Replay rewind: a quick tape-style chirp down.
    rewind: [
        (c, o, t) => {
            tone(c, o, { t, freq: 900, dur: 0.22, gain: 0.16, type: 'triangle', slideTo: 320 });
            noise(c, o, { t, dur: 0.22, gain: 0.2, freq: 2500, freqTo: 600, q: 1.5, attack: 0.02 });
        },
        (c, o, t) => {
            tone(c, o, { t, freq: 1100, dur: 0.25, gain: 0.15, type: 'triangle', slideTo: 300 });
            noise(c, o, { t, dur: 0.25, gain: 0.2, freq: 3000, freqTo: 500, q: 1.5, attack: 0.02 });
        },
        (c, o, t) => {
            tone(c, o, { t, freq: 800, dur: 0.2, gain: 0.16, type: 'triangle', slideTo: 350 });
            noise(c, o, { t, dur: 0.2, gain: 0.2, freq: 2200, freqTo: 700, q: 1.5, attack: 0.02 });
        },
    ],
    // Final round: a two-beat alert.
    'final-round': [
        (c, o, t) => {
            tone(c, o, { t, freq: N.A5, dur: 0.13, gain: 0.26, type: 'triangle' });
            tone(c, o, { t: t + 0.17, freq: N.A5, dur: 0.22, gain: 0.26, type: 'triangle' });
        },
        (c, o, t) => {
            tone(c, o, { t, freq: N.E5, dur: 0.13, gain: 0.26, type: 'triangle' });
            tone(c, o, { t: t + 0.17, freq: N.A5, dur: 0.24, gain: 0.26, type: 'triangle' });
        },
        (c, o, t) => {
            tone(c, o, { t, freq: N.G5, dur: 0.1, gain: 0.26, type: 'triangle' });
            tone(c, o, { t: t + 0.13, freq: N.G5, dur: 0.1, gain: 0.26, type: 'triangle' });
            tone(c, o, { t: t + 0.26, freq: N.G5, dur: 0.24, gain: 0.26, type: 'triangle' });
        },
    ],
    // Victory: a rising fanfare that lands on a held note, with sparkles.
    win: [
        (c, o, t) => {
            [N.C5, N.E5, N.G5].forEach((f, i) =>
                tone(c, o, { t: t + i * 0.11, freq: f, dur: 0.32, gain: 0.26, type: 'triangle' }),
            );
            tone(c, o, { t: t + 0.33, freq: N.C6, dur: 1.1, gain: 0.3, type: 'triangle' });
            arpeggio(c, o, t + 0.45, [N.E6, N.G6, N.C7, N.E7], 0.09, 0.5, 0.16);
        },
        (c, o, t) => {
            [N.F5, N.A5, N.C6].forEach((f, i) =>
                tone(c, o, { t: t + i * 0.11, freq: f, dur: 0.32, gain: 0.25, type: 'triangle' }),
            );
            tone(c, o, { t: t + 0.33, freq: N.F6, dur: 1.1, gain: 0.28, type: 'triangle' });
            arpeggio(c, o, t + 0.45, [N.A6, N.C7, N.E7], 0.1, 0.5, 0.16);
        },
        (c, o, t) => {
            [N.G4, N.B4, N.D5, N.G5].forEach((f, i) =>
                tone(c, o, { t: t + i * 0.1, freq: f, dur: 0.3, gain: 0.25, type: 'triangle' }),
            );
            tone(c, o, { t: t + 0.4, freq: N.B5, dur: 1.1, gain: 0.28, type: 'triangle' });
            arpeggio(c, o, t + 0.5, [N.D6, N.G6, N.D6 * 2], 0.1, 0.5, 0.16);
        },
    ],
    // Defeat: three notes trudging downward.
    lose: [
        (c, o, t) =>
            [N.E4, N.C4, N.A3].forEach((f, i) =>
                tone(c, o, { t: t + i * 0.32, freq: f, dur: 0.6, gain: 0.26, type: 'triangle', attack: 0.02 }),
            ),
        (c, o, t) =>
            [N.D4, N.Bb3, N.G3].forEach((f, i) =>
                tone(c, o, { t: t + i * 0.34, freq: f, dur: 0.62, gain: 0.26, type: 'triangle', attack: 0.02 }),
            ),
        (c, o, t) =>
            [N.E4, N.Eb4, N.D4].forEach((f, i) =>
                tone(c, o, { t: t + i * 0.3, freq: f, dur: 0.58, gain: 0.26, type: 'triangle', attack: 0.02 }),
            ),
    ],
};

/** Every effect, in a stable order — for the soundboard. */
export const SFX_NAMES = Object.keys(BANK) as SfxName[];
