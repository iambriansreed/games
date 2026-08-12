import { useEffect, useMemo, useRef, useState } from 'react';
import { GameDetail, PublicUser } from '../../../shared/types';
import { CardColor, SplendorCard, SplendorState } from '../../../shared/splendor/types';
import { createInitialState } from '../../../shared/splendor/engine';
import { navigate } from '../../router';
import { SplendorBoard } from './SplendorBoard';

// A self-contained reel that drives the *real* SplendorBoard through a series of
// scripted state frames so an admin can preview every animation back to back —
// no server, no live game. Each step seeds a valid state (board mounts, effects
// seed their refs, nothing animates), then either transitions to a second state
// (firing the diff-driven animations: token/noble flights, rainbow, turn change,
// game over) or performs a real click (the card buy/reserve flights are driven
// by the click handlers, so we click the rendered card and its action button).

const ISO = '2020-01-01T00:00:00.000Z';
const BOT_ID = 'dev-bot';
const COLORS: CardColor[] = ['white', 'blue', 'green', 'red', 'brown'];

interface AnimStep {
    key: string;
    label: string;
    desc: string;
    seed: SplendorState;
    fired?: SplendorState;
    interact?: () => Promise<void>;
    hold: number;
}

function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
}

function wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function makeDetail(state: SplendorState, meId: string): GameDetail {
    return {
        id: 'anim-demo',
        type: 'splendor',
        name: 'Animation demo',
        visibility: 'private',
        status: state.winnerId ? 'finished' : 'active',
        hostId: meId,
        joinCode: 'DEMO',
        maxPlayers: 4,
        minPlayers: 2,
        players: [
            { userId: meId, name: 'You', picture: null, seat: 0, record: { wins: 0, losses: 0 } },
            { userId: BOT_ID, name: 'Dev Bot', picture: null, seat: 1, record: { wins: 3, losses: 1 } },
        ],
        winnerId: state.winnerId,
        createdAt: ISO,
        updatedAt: ISO,
        state,
        youSeat: 0,
    };
}

// Find a face-up board card that's a real (coloured) card, not an empty slot.
function firstRealCard(): HTMLElement | null {
    const cards = document.querySelectorAll<HTMLElement>('.card-row .cards .card');
    for (const c of cards) {
        if (COLORS.some((col) => c.classList.contains(col))) return c;
    }
    return null;
}

async function clickCardAction(card: HTMLElement | null, actionSelector: string): Promise<void> {
    if (!card) return;
    card.click(); // opens the buy/reserve menu
    await wait(220); // let the menu render + position
    document.querySelector<HTMLElement>(actionSelector)?.click();
}

function buildSteps(meId: string): AnimStep[] {
    let cardSeq = 0;
    const card = (color: CardColor, level: 1 | 2 | 3 = 1, points = 0): SplendorCard => ({
        id: `demo-card-${cardSeq++}`,
        level,
        color,
        points,
        cost: {},
    });
    const base = (): SplendorState => {
        const s = createInitialState([meId, BOT_ID], ISO);
        s.startSeat = 0;
        s.current = 0; // your turn by default
        s.turn = 3; // past the opening round, so no skip offer clutters the frames
        return s;
    };

    const steps: AnimStep[] = [];

    // 1. Turn passes to you.
    {
        const seed = base();
        seed.current = 1; // bot's turn
        const fired = clone(seed);
        fired.current = 0; // now yours
        steps.push({
            key: 'your-turn',
            label: 'Your turn',
            desc: 'Full-screen flash announcing whose turn it is',
            seed,
            fired,
            hold: 2600,
        });
    }

    // 2. You take three tokens.
    {
        const seed = base();
        const fired = clone(seed);
        for (const g of ['white', 'blue', 'green'] as const) {
            fired.players[0].tokens[g] += 1;
            fired.bank[g] -= 1;
        }
        steps.push({
            key: 'take',
            label: 'Take tokens',
            desc: 'Chips lift off the bank, then arc into your tray',
            seed,
            fired,
            hold: 3800,
        });
    }

    // 3. An opponent takes tokens (opponents animate too).
    {
        const seed = base();
        seed.current = 1;
        const fired = clone(seed);
        fired.players[1].tokens.red += 2;
        fired.bank.red -= 2;
        steps.push({
            key: 'opp-take',
            label: 'Opponent takes tokens',
            desc: "Opponents' moves animate to their trays as well",
            seed,
            fired,
            hold: 3600,
        });
    }

    // 3b. An opponent reserves a board card (diff-driven from synced state).
    {
        const seed = base();
        seed.current = 1;
        const taken = seed.board[1].find(Boolean) as SplendorCard;
        const fired = clone(seed);
        fired.board[1] = fired.board[1].map((c) => (c?.id === taken.id ? null : c));
        // Opponents see reserved cards redacted to a hidden tile with a fresh id.
        fired.players[1].reserved = [
            ...fired.players[1].reserved,
            { id: 'demo-hidden', level: 1, hidden: true },
        ];
        if (fired.bank.gold > 0) {
            fired.players[1].tokens.gold += 1;
            fired.bank.gold -= 1;
        }
        steps.push({
            key: 'opp-reserve',
            label: 'Opponent reserves a card',
            desc: 'The board card flies to their reserved pile',
            seed,
            fired,
            hold: 2400,
        });
    }

    // 3c. An opponent buys a board card (diff-driven from synced state).
    {
        const seed = base();
        seed.current = 1;
        const bought = seed.board[2].find(Boolean) as SplendorCard;
        const fired = clone(seed);
        fired.board[2] = fired.board[2].map((c) => (c?.id === bought.id ? null : c));
        fired.players[1].cards = [...fired.players[1].cards, bought];
        fired.players[1].points += bought.points;
        steps.push({
            key: 'opp-buy',
            label: 'Opponent buys a card',
            desc: "The card flies into the opponent's colour column",
            seed,
            fired,
            hold: 2400,
        });
    }

    // 3d. A noble visits an opponent.
    {
        const seed = base();
        seed.current = 1;
        const noble = seed.nobles[0];
        const fired = clone(seed);
        fired.nobles = fired.nobles.filter((n) => n.id !== noble.id);
        fired.players[1].nobles = [noble];
        fired.players[1].points += noble.points;
        steps.push({
            key: 'opp-noble',
            label: 'Opponent wins a noble',
            desc: 'The noble glides from the board into their court',
            seed,
            fired,
            hold: 2400,
        });
    }

    // 4. Reserve a card (click-driven flight to your reserved row).
    {
        const seed = base();
        steps.push({
            key: 'reserve',
            label: 'Reserve a card',
            desc: 'The card flies to your reserved row',
            seed,
            interact: () => clickCardAction(firstRealCard(), '.card-action--reserve'),
            hold: 2200,
        });
    }

    // 5. Buy a card (click-driven flight into your colour column).
    {
        const seed = base();
        seed.players[0].tokens = { white: 7, blue: 7, green: 7, red: 7, brown: 7, gold: 5 };
        steps.push({
            key: 'buy',
            label: 'Buy a card',
            desc: 'The bought card flies into your collection',
            seed,
            interact: () =>
                clickCardAction(
                    document.querySelector<HTMLElement>('.card-row .cards .card.can-buy') ??
                        firstRealCard(),
                    '.card-action--buy',
                ),
            hold: 2200,
        });
    }

    // 6. A noble visits you.
    {
        const seed = base();
        const noble = seed.nobles[0];
        const fired = clone(seed);
        fired.nobles = fired.nobles.filter((n) => n.id !== noble.id);
        fired.players[0].nobles = [noble];
        fired.players[0].points += noble.points;
        steps.push({
            key: 'noble',
            label: 'Noble visit',
            desc: 'The noble glides from the board into your court',
            seed,
            fired,
            hold: 2400,
        });
    }

    // 7. Rainbow — one card of every colour.
    {
        const seed = base();
        seed.players[0].cards = [card('white'), card('blue'), card('green'), card('red')];
        const fired = clone(seed);
        fired.players[0].cards = [...fired.players[0].cards, card('brown')];
        steps.push({
            key: 'rainbow',
            label: 'Rainbow!',
            desc: 'Completing one card of every colour arcs a rainbow across the board',
            seed,
            fired,
            hold: 6700,
        });
    }

    // 8. Final round banner.
    {
        const seed = base();
        const fired = clone(seed);
        fired.finalRound = true;
        steps.push({
            key: 'final',
            label: 'Final round',
            desc: 'A last-move warning pins under the bank',
            seed,
            fired,
            hold: 2600,
        });
    }

    // 9. Victory — confetti.
    {
        const seed = base();
        seed.players[0].points = 18;
        seed.players[1].points = 9;
        const fired = clone(seed);
        fired.winnerId = meId;
        steps.push({
            key: 'win',
            label: 'Victory',
            desc: 'Confetti cannons fire from both sides for the winner',
            seed,
            fired,
            hold: 4400,
        });
    }

    // 10. Defeat — greyscale + score.
    {
        const seed = base();
        seed.players[0].points = 12;
        seed.players[1].points = 17;
        const fired = clone(seed);
        fired.winnerId = BOT_ID;
        steps.push({
            key: 'loss',
            label: 'Defeat',
            desc: 'The board drains to greyscale with the final margin',
            seed,
            fired,
            hold: 4600,
        });
    }

    return steps;
}

export function AnimationTester({ me }: { me: PublicUser }) {
    const steps = useMemo(() => buildSteps(me.id), [me.id]);
    const [i, setI] = useState(0);
    // Bumped on every (re)start so the board remounts and its diff refs reseed —
    // even when replaying the same step index.
    const [run, setRun] = useState(0);
    const [displayState, setDisplayState] = useState<SplendorState>(steps[0].seed);
    const [toast, setToast] = useState<string | null>(null);
    const toastTimer = useRef<number>();
    // When on, the current step replays continuously instead of advancing. Read
    // from a ref inside the timer so toggling never restarts the running step.
    const [repeat, setRepeat] = useState(false);
    const repeatRef = useRef(false);
    function toggleRepeat() {
        setRepeat((r) => {
            repeatRef.current = !r;
            return !r;
        });
    }

    const step = steps[i];
    const n = steps.length;

    function goTo(idx: number) {
        setToast(null);
        setDisplayState(steps[idx].seed);
        setI(idx);
        setRun((r) => r + 1);
    }

    // Per step: mount the seed, then (after a beat) fire the animation, hold, and
    // auto-advance. The board remounts every run (key={run}), reseeding its diff
    // refs so the seed frame never animates.
    useEffect(() => {
        let alive = true;
        const timers: number[] = [];
        timers.push(
            window.setTimeout(async () => {
                if (!alive) return;
                const s = steps[i];
                if (s.interact) await s.interact();
                else if (s.fired) setDisplayState(s.fired);
                timers.push(
                    window.setTimeout(() => {
                        if (alive) goTo(repeatRef.current ? i : (i + 1) % n);
                    }, s.hold),
                );
            }, 750),
        );
        return () => {
            alive = false;
            timers.forEach((t) => window.clearTimeout(t));
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [run]);

    function pushToast(msg: string) {
        setToast(msg);
        window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 2300);
    }

    return (
        <div className="anim-tester">
            <SplendorBoard
                key={run}
                detail={makeDetail(displayState, me.id)}
                me={me}
                dispatch={() => {}}
                onToast={pushToast}
                suppressStartFlash
            />
            {toast && <div className="toast">{toast}</div>}

            <div className="anim-tester-bar">
                <div className="anim-tester-info">
                    <span className="anim-tester-count">
                        {i + 1}/{n}
                    </span>
                    <span className="anim-tester-label">{step.label}</span>
                    <span className="anim-tester-desc">{step.desc}</span>
                </div>
                <div className="anim-tester-controls">
                    <button aria-label="Previous" onClick={() => goTo((i - 1 + n) % n)}>
                        ◀
                    </button>
                    <button aria-label="Replay" onClick={() => goTo(i)}>
                        ↻
                    </button>
                    <button aria-label="Next" onClick={() => goTo((i + 1) % n)}>
                        ▶
                    </button>
                    <button
                        className={repeat ? 'anim-tester-on' : ''}
                        aria-pressed={repeat}
                        title="Repeat this animation"
                        onClick={toggleRepeat}
                    >
                        ⟳ Repeat
                    </button>
                    <button className="anim-tester-exit" onClick={() => navigate('/settings')}>
                        Exit
                    </button>
                </div>
            </div>
        </div>
    );
}
