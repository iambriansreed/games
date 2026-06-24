import {
    CSSProperties,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type MouseEventHandler,
    type RefObject,
} from 'react';
import { GameDetail, PublicUser } from '../../../shared/types';
import {
    CardColor,
    CARD_COLORS,
    Gem,
    GEMS,
    LEVELS,
    SplendorCard,
    SplendorPlayer,
    SplendorState,
} from '../../../shared/splendor/types';
import { bonuses, canAfford, isHidden, TOKEN_LIMIT, totalTokens } from './logic';
import { api } from '../../api';
import { navigate } from '../../router';

import './splendor.css';

const COLORS: CardColor[] = ['white', 'blue', 'green', 'red', 'brown'];

// Selection effects for bank/return tokens (passed via Token's `style` prop, since
// the Token component carries no className). `--pair` adds the outer glow ring.
const SEL_SHADOW = '0 0 0 3px #f2f0ea, 0 8px 16px rgba(0, 0, 0, 0.5)';
const PAIR_SHADOW = '0 0 0 3px #f2f0ea, 0 0 0 6px rgba(242, 240, 234, 0.35), 0 8px 16px rgba(0, 0, 0, 0.5)';
const selectStyle = (selected: boolean, pair = false): CSSProperties =>
    selected
        ? {
              position: 'relative',
              zIndex: 60,
              transform: 'translateY(-5px)',
              boxShadow: pair ? PAIR_SHADOW : SEL_SHADOW,
          }
        : {};

export function SplendorBoard({
    detail,
    me,
    dispatch,
    onToast,
    suppressStartFlash = false,
}: {
    detail: GameDetail;
    me: PublicUser;
    dispatch: (action: unknown) => void;
    onToast: (msg: string) => void;
    // The animation tester remounts the board per step with fresh (turn 1) seeds;
    // it sets this so each step doesn't fire the game-start turn flash.
    suppressStartFlash?: boolean;
}) {
    const state = detail.state as SplendorState;
    const mySeat = detail.youSeat;
    const myPlayer = mySeat != null ? state.players[mySeat] : null;
    const isMyTurn = myPlayer != null && state.current === mySeat && !state.winnerId;
    const pendingNoble = state.pendingNoble;
    const mustChooseNoble = pendingNoble != null && pendingNoble.seat === mySeat;
    const canAct = isMyTurn && pendingNoble == null;

    const [picks, setPicks] = useState<Gem[]>([]);
    const [menu, setMenu] = useState<{
        card: SplendorCard;
        source: 'board' | 'reserved';
        rect: DOMRect;
        el: HTMLElement;
    } | null>(null);
    const [pending, setPending] = useState<{
        action: Record<string, unknown>;
        over: number;
        // The tokens this action adds to your stack (e.g. the gems just taken, or
        // a gold from reserving) so the return prompt can show projected counts.
        added: Gem[];
    } | null>(null);
    const [returns, setReturns] = useState<Gem[]>([]);
    const [reservedView, setReservedView] = useState<{
        card: SplendorCard;
        rect: DOMRect;
        w: number;
        h: number;
    } | null>(null);
    // Bumped to (re)play the celebratory rainbow when a player first holds one
    // card of every colour; `rainbowOn` clears it after the animation.
    const [rainbowKey, setRainbowKey] = useState(0);
    const [rainbowOn, setRainbowOn] = useState(false);
    const rainbowTimer = useRef<number>();
    // Full-screen "whose turn" announcement, replayed (via `key`) each turn change
    // and cleared by a timer once its fade-out finishes.
    const [turnFlash, setTurnFlash] = useState<{ mine: boolean; name: string; key: number } | null>(null);
    const turnFlashTimer = useRef<number>();

    const playersScrollRef = useRef<HTMLDivElement>(null);
    const noblesScrollRef = useRef<HTMLDivElement>(null);
    const selfNoblesScrollRef = useRef<HTMLDivElement>(null);
    const screenRef = useRef<HTMLDivElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const tokenBarRef = useRef<HTMLDivElement>(null);
    const cardRowRef = useRef<HTMLDivElement>(null);
    const flyLayerRef = useRef<HTMLDivElement>(null);
    const reservedPopRef = useRef<HTMLDivElement>(null);
    // Remember where the take-tokens bar last sat so the return view can reuse the
    // same top/left/width and morph in place (it's taller, so centring it would
    // float it higher, and its bank of tokens would otherwise make it wider).
    const takeBarBoxRef = useRef<{ top: number; left: number; width: number } | null>(null);
    useScrollFade(playersScrollRef);
    useScrollFade(noblesScrollRef);
    useScrollFade(selfNoblesScrollRef);

    // Position the reserved-card preview just above the tapped chip, clamped in.
    useLayoutEffect(() => {
        const pop = reservedPopRef.current;
        const screen = screenRef.current;
        if (!reservedView || !pop || !screen) return;
        const place = () => {
            const app = screen.getBoundingClientRect();
            const margin = 8;
            const pw = pop.offsetWidth;
            const ph = pop.offsetHeight;
            let left = reservedView.rect.left + reservedView.rect.width / 2 - pw / 2;
            left = Math.max(app.left + margin, Math.min(left, app.right - pw - margin));
            let top = reservedView.rect.top - ph - 10;
            if (top < app.top + margin) top = app.top + margin;
            pop.style.left = `${left}px`;
            pop.style.top = `${top}px`;
        };
        place();
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
    }, [reservedView]);

    // A legal take: three different gems, or a matched pair (matches the mockup).
    const ready = picks.length === 3 || (picks.length === 2 && picks[0] === picks[1]);

    // Float the Buy/Reserve popup next to its card, clamped inside the board frame.
    useLayoutEffect(() => {
        const popup = popupRef.current;
        const screen = screenRef.current;
        if (!menu || !popup || !screen) return;
        const place = () => {
            const margin = 8;
            const app = screen.getBoundingClientRect();
            const pw = popup.offsetWidth;
            const ph = popup.offsetHeight;
            let left = menu.rect.left + menu.rect.width / 2 - pw / 2;
            left = Math.max(app.left + margin, Math.min(left, app.right - pw - margin));
            // Prefer the menu below the lifted card; flip above if it would overflow.
            let top = menu.rect.bottom + 6;
            if (top + ph > app.bottom - margin) top = menu.rect.top - ph - 6;
            top = Math.max(app.top + margin, top);
            popup.style.left = `${left}px`;
            popup.style.top = `${top}px`;
        };
        place();
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
    }, [menu]);

    // Float the take/return bar centred over the nobles, like the original mockup.
    // The same element is reused for the return prompt: when it morphs it keeps
    // the take bar's top/left/width and just grows downward, so the transition is
    // seamless. Falls back to centring when no take bar preceded it (e.g. a
    // reserve that pushes you over the limit).
    useLayoutEffect(() => {
        const bar = tokenBarRef.current;
        const screen = screenRef.current;
        if (!(ready || pending) || !bar || !screen) return;
        const place = () => {
            const anchor = noblesScrollRef.current || cardRowRef.current;
            if (!anchor) return;
            const r = anchor.getBoundingClientRect();
            const app = screen.getBoundingClientRect();
            const margin = 8;
            // Always span the board's bank (same left + width) in both modes, so
            // the bar is a consistent full width and the return tokens render at
            // bank size.
            const bankRect = screen.querySelector('.bank')?.getBoundingClientRect();
            const bw = bankRect?.width ?? bar.offsetWidth;
            bar.style.width = `${bw}px`;
            let left = bankRect?.left ?? r.left + r.width / 2 - bw / 2;
            left = Math.max(app.left + margin, Math.min(left, app.right - bw - margin));
            const bh = bar.offsetHeight;
            // Take mode centres over the nobles; the return view keeps the take
            // bar's top so it morphs in place and just grows downward.
            let top = (pending ? takeBarBoxRef.current?.top : undefined) ?? r.top + r.height / 2 - bh / 2;
            top = Math.max(app.top + margin, Math.min(top, app.bottom - bh - margin));
            bar.style.left = `${left}px`;
            bar.style.top = `${top}px`;
            if (!pending) takeBarBoxRef.current = { top, left, width: bw };
        };
        place();
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
    }, [ready, pending, picks, returns]);

    // Animate token gains for every seat by diffing each player's token counts
    // against the previous render. A move that increases a player's holding of a
    // colour (a take, or the gold from a reserve) flies that many chips from the
    // bank to their tray — yours and opponents' alike, driven purely by synced
    // state. The first render just seeds the snapshot so nothing animates on load.
    const tokenSig = state.players.map((p) => GEMS.map((g) => p.tokens[g]).join(',')).join('|');
    const prevTokensRef = useRef<Record<Gem, number>[] | null>(null);
    useEffect(() => {
        const curr = state.players.map((p) => ({ ...p.tokens }));
        const prev = prevTokensRef.current;
        prevTokensRef.current = curr;
        if (!prev) return; // first render: seed only
        curr.forEach((after, seat) => {
            const before = prev[seat];
            if (!before) return;
            const gained: Gem[] = [];
            for (const g of GEMS) {
                for (let k = (after[g] ?? 0) - (before[g] ?? 0); k > 0; k--) gained.push(g);
            }
            if (gained.length) flyGemsToSeat(seat, gained);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tokenSig]);

    // Animate a noble flying from the board to its new owner's stack. The board
    // node is gone by the time we'd want its position, so each commit snapshots
    // the on-table noble rects; the next commit, any id that vanished and is now
    // owned flies from its last-seen spot to that seat's noble area. Works for
    // every seat, driven by synced state.
    const nobleSnapRef = useRef<Map<string, DOMRect>>(new Map());
    useLayoutEffect(() => {
        const screen = screenRef.current;
        if (!screen) return;
        const next = new Map<string, DOMRect>();
        screen.querySelectorAll<HTMLElement>('.nobles .noble[data-noble-id]').forEach((el) => {
            next.set(el.dataset.nobleId as string, el.getBoundingClientRect());
        });
        const prev = nobleSnapRef.current;
        nobleSnapRef.current = next;
        if (prev.size === 0) return; // first paint: seed only
        prev.forEach((rect, id) => {
            if (next.has(id)) return; // still on the table
            const seat = state.players.findIndex((p) => p.nobles.some((n) => n.id === id));
            if (seat < 0) return;
            const pts = state.players[seat].nobles.find((n) => n.id === id)?.points ?? 3;
            flyNoble(rect, seat, pts);
        });
    });

    // Animate an *opponent's* card moves the same diff-driven way: snapshot every
    // face-up board card's rect each commit, then on the next commit any board
    // card that left the table flies to wherever it went. Your own buys/reserves
    // are already animated by the click handlers, so this skips your seat.
    //   • Buy   — the vanished card's id reappears in a player's collection; it
    //             flies into that seat's colour column.
    //   • Reserve — the card vanished but is owned by no one (opponents' reserved
    //             cards are redacted to a HiddenCard with a fresh id). It flies to
    //             that seat's reserved pile; the seat is the one whose reserved
    //             count grew. Deck reserves have no board source, so they don't fly.
    const cardSnapRef = useRef<Map<string, { rect: DOMRect; card: SplendorCard }>>(new Map());
    const prevHoldingsRef = useRef<{ cards: Set<string>; reserved: number }[] | null>(null);
    useLayoutEffect(() => {
        const screen = screenRef.current;
        if (!screen) return;
        const boardById = new Map<string, SplendorCard>();
        for (const lvl of LEVELS) for (const c of state.board[lvl]) if (c) boardById.set(c.id, c);
        const next = new Map<string, { rect: DOMRect; card: SplendorCard }>();
        screen.querySelectorAll<HTMLElement>('.card-row .cards .card[data-card-id]').forEach((el) => {
            const card = boardById.get(el.dataset.cardId as string);
            if (card) next.set(card.id, { rect: el.getBoundingClientRect(), card });
        });
        const prevSnap = cardSnapRef.current;
        cardSnapRef.current = next;

        const holdings = state.players.map((p) => ({
            cards: new Set(p.cards.map((c) => c.id)),
            reserved: p.reserved.length,
        }));
        const prevHold = prevHoldingsRef.current;
        prevHoldingsRef.current = holdings;
        if (prevSnap.size === 0 || !prevHold) return; // first paint: seed only

        // Board cards that left the table since the last commit.
        const vanished = new Map<string, { rect: DOMRect; card: SplendorCard }>();
        prevSnap.forEach((v, id) => {
            if (!next.has(id)) vanished.set(id, v);
        });

        // Opponent buys.
        state.players.forEach((p, seat) => {
            if (seat === mySeat) return;
            const before = prevHold[seat]?.cards;
            if (!before) return;
            for (const c of p.cards) {
                if (before.has(c.id)) continue; // not newly bought
                const from = vanished.get(c.id);
                vanished.delete(c.id); // consume so a reserve below doesn't reuse it
                // Bought off the board → fly from its slot; bought from the player's
                // own reserve pile → fly from there instead.
                const rect = from?.rect ?? oppReservedArea(seat)?.getBoundingClientRect();
                if (!rect) continue;
                flyCardNode(buildCardNode(c), rect, oppColumn(seat, c.color));
            }
        });

        // Opponent reserves — any board card left over after the buys above.
        state.players.forEach((p, seat) => {
            if (seat === mySeat) return;
            let grew = p.reserved.length - (prevHold[seat]?.reserved ?? p.reserved.length);
            while (grew-- > 0) {
                const entry = vanished.entries().next().value as
                    | [string, { rect: DOMRect; card: SplendorCard }]
                    | undefined;
                if (!entry) break; // reserved from the deck — no on-board source to fly
                vanished.delete(entry[0]);
                flyCardNode(buildCardNode(entry[1].card), entry[1].rect, oppReservedArea(seat));
            }
        });
    });

    // A seat's colour column (where a bought card's bonus lands) and reserved pile,
    // the destinations for the opponent card flights above.
    function oppColumn(seat: number, color: CardColor): HTMLElement | null {
        return (
            screenRef.current?.querySelector<HTMLElement>(
                `.player-gems[data-seat="${seat}"] .pg-col.${color} .pg-card`,
            ) ?? null
        );
    }
    function oppReservedArea(seat: number): HTMLElement | null {
        return screenRef.current?.querySelector<HTMLElement>(`.player[data-seat="${seat}"] .opp-reserved`) ?? null;
    }

    // A bare card face (colour + prestige) to fly when there's no live board node
    // to clone — i.e. an opponent's move, where the card was synced, not clicked.
    function buildCardNode(card: SplendorCard): HTMLElement {
        const el = document.createElement('div');
        el.className = `card ${card.color}`;
        const top = document.createElement('div');
        top.className = 'card-top fill';
        top.textContent = card.points ? String(card.points) : ' ';
        el.appendChild(top);
        return el;
    }

    // Build and fly a gold noble tile from a board position to a seat's stack.
    function flyNoble(from: DOMRect, seat: number, points: number) {
        const layer = flyLayerRef.current;
        const screen = screenRef.current;
        if (!layer || !screen) return;
        const target =
            seat === mySeat
                ? screen.querySelector<HTMLElement>('.self-nobles')
                : screen.querySelector<HTMLElement>(`.player[data-seat="${seat}"] .opp-nobles`);
        if (!target) return;
        const t = target.getBoundingClientRect();
        const tile = document.createElement('div');
        tile.className = 'flying-noble';
        tile.textContent = String(points);
        tile.style.left = `${from.left}px`;
        tile.style.top = `${from.top}px`;
        tile.style.width = `${from.width}px`;
        tile.style.height = `${from.height}px`;
        layer.appendChild(tile);
        tile.getBoundingClientRect(); // reflow

        let scale = Math.min(0.55, (t.height || 26) / from.height);
        if (!isFinite(scale) || scale <= 0) scale = 0.4;
        const dx = t.left + t.width / 2 - (from.left + from.width / 2);
        const dy = t.top + t.height / 2 - (from.top + from.height / 2);
        const mid = (scale + 1) / 2;
        const anim = tile.animate(
            [
                { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1, offset: 0 },
                {
                    transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 34}px) scale(${mid}) rotate(9deg)`,
                    opacity: 1,
                    offset: 0.55,
                },
                {
                    transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(0deg)`,
                    opacity: 1,
                    offset: 1,
                },
            ],
            { duration: 850, easing: 'cubic-bezier(0.31, 0.78, 0.32, 1)', fill: 'forwards' },
        );
        const cleanup = () => tile.remove();
        anim.onfinish = () => {
            target.animate(
                [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
                { duration: 280, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
            );
            const fade = tile.animate([{ opacity: 1 }, { opacity: 0 }], {
                duration: 180,
                delay: 60,
                fill: 'forwards',
            });
            fade.onfinish = cleanup;
        };
        setTimeout(cleanup, 1500);
    }

    // Rainbow! Fire the celebratory arc the first time any player holds at least
    // one card of every colour. Diffs against the previous render so it plays
    // once per player, on the move that completes the set.
    const rainbowSig = state.players
        .map((p) => (CARD_COLORS.every((c) => bonuses(p)[c] >= 1) ? '1' : '0'))
        .join('');
    const prevRainbowRef = useRef<boolean[] | null>(null);
    useEffect(() => {
        const curr = state.players.map((p) => CARD_COLORS.every((c) => bonuses(p)[c] >= 1));
        const prev = prevRainbowRef.current;
        prevRainbowRef.current = curr;
        if (!prev) return; // seed only
        curr.forEach((has, seat) => {
            if (has && !prev[seat]) {
                setRainbowKey((k) => k + 1);
                setRainbowOn(true);
                window.clearTimeout(rainbowTimer.current);
                rainbowTimer.current = window.setTimeout(() => setRainbowOn(false), 6500);
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rainbowSig]);

    // Announce each turn with a full-screen flash (your turn, or whose it is).
    // Fires on every turn change, plus once at game start (first render on turn 1)
    // so the opening turn is announced too. A mid-game reload (turn > 1) seeds
    // silently rather than flashing spuriously.
    const prevCurrentRef = useRef<number | null>(null);
    useEffect(() => {
        const prev = prevCurrentRef.current;
        prevCurrentRef.current = state.current;
        if (state.winnerId) return;
        const isStart = prev === null && !suppressStartFlash && state.turn === 1;
        const isChange = prev !== null && prev !== state.current;
        if (!isStart && !isChange) return;
        const mine = isMyTurn;
        setTurnFlash((f) => ({ mine, name: seatName(state.current), key: (f?.key ?? 0) + 1 }));
        window.clearTimeout(turnFlashTimer.current);
        // Others' turns auto-dismiss; your own turn stays until you click Continue.
        if (!mine) turnFlashTimer.current = window.setTimeout(() => setTurnFlash(null), 1600);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.current]);

    // Brief shake to signal a card the player can neither buy nor reserve.
    function shake(el: HTMLElement) {
        el.classList.remove('card-shake');
        void el.offsetWidth; // restart the animation
        el.classList.add('card-shake');
        setTimeout(() => el.classList.remove('card-shake'), 420);
    }

    function openCardMenu(card: SplendorCard, source: 'board' | 'reserved', el: HTMLElement) {
        if (pending || !myPlayer) return; // mid token-return flow, or spectator
        if (state.winnerId) return onToast('The game is over');
        if (!isMyTurn) return onToast('It’s not your turn');
        if (pendingNoble) return onToast('Choose a noble to finish your turn');
        const canBuyNow = canAfford(myPlayer, card);
        const canReserveNow = source === 'board' && myPlayer.reserved.length < 3;
        if (!canBuyNow && !canReserveNow) {
            shake(el); // nothing the player can do — nudge the card
            onToast('You can neither buy nor reserve that card');
            return;
        }
        setMenu({ card, source, rect: el.getBoundingClientRect(), el });
    }

    // Fly a clone of a board card to a target (the reserved area on reserve, or
    // your colour column on buy), melting into the destination on arrival
    // (ported from the original mockup's flyCardTo).
    function flyCard(sourceEl: HTMLElement, targetEl: Element | null) {
        flyCardNode(sourceEl.cloneNode(true) as HTMLElement, sourceEl.getBoundingClientRect(), targetEl);
    }

    // Fly an already-built node from `from` to `targetEl`, melting in on arrival.
    // Used both by flyCard (a clone of the clicked board card) and by the opponent
    // diff effect (a freshly built card face, since the real node is synced away).
    function flyCardNode(node: HTMLElement, from: DOMRect, targetEl: Element | null) {
        const layer = flyLayerRef.current;
        if (!layer || !targetEl) return;
        const t = targetEl.getBoundingClientRect();
        node.classList.remove('is-lifted');
        node.classList.add('flying-card');
        node.style.left = `${from.left}px`;
        node.style.top = `${from.top}px`;
        node.style.width = `${from.width}px`;
        node.style.height = `${from.height}px`;
        layer.appendChild(node);
        node.getBoundingClientRect(); // force reflow before transition

        let scale = Math.min(t.width / from.width, t.height / from.height);
        if (!isFinite(scale) || scale <= 0) scale = 0.2;
        const dx = t.left + t.width / 2 - (from.left + from.width / 2);
        const dy = t.top + t.height / 2 - (from.top + from.height / 2);
        node.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;

        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            // Bump the destination so the card visibly lands in it.
            (targetEl as HTMLElement).animate?.(
                [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
                { duration: 280, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
            );
            node.style.transition = 'opacity 0.16s ease';
            node.style.opacity = '0';
            setTimeout(() => node.remove(), 170);
        };
        node.addEventListener('transitionend', finish, { once: true });
        setTimeout(finish, 700);
    }

    // Target the colour column in your own tray (where a bought card's bonus
    // lands), so a purchase can fly there.
    function selfColumn(color: CardColor): HTMLElement | null {
        const screen = screenRef.current;
        if (!screen) return null;
        return screen.querySelector<HTMLElement>(`.player-gems--self .pg-col.${color} .pg-card`);
    }

    // Fly each gained chip from its bank slot to the matching colour in the given
    // seat's stack. Drives both your own takes and opponents' (see the diff effect
    // below), so the source of truth is always the synced state, not the click.
    function flyGemsToSeat(seat: number, gems: Gem[]) {
        const screen = screenRef.current;
        if (!screen) return;
        const bankTokens = Array.from(screen.querySelectorAll<HTMLElement>('.bank .token'));
        const tray = screen.querySelector<HTMLElement>(`.player-gems[data-seat="${seat}"]`);
        if (!tray) return;
        // Trays render a column per COLORS, then a trailing gold column.
        const cols = Array.from(tray.querySelectorAll<HTMLElement>('.pg-col'));
        gems.forEach((g, i) => {
            const source = bankTokens[GEMS.indexOf(g)] ?? null;
            const colIdx = g === 'gold' ? cols.length - 1 : COLORS.indexOf(g as CardColor);
            const col = cols[colIdx] ?? null;
            const target = col?.querySelector<HTMLElement>('.token') ?? col;
            flyToken(source, target, i);
        });
    }

    const seatName = (seat: number) => {
        const p = detail.players.find((x) => x.seat === seat);
        if (!p) return 'Player';
        return p.userId === me.id ? 'You' : p.name || 'Player';
    };

    function reset() {
        setPicks([]);
        setMenu(null);
        setPending(null);
        setReturns([]);
        setReservedView(null);
    }

    function openReserved(card: SplendorCard, el: HTMLElement) {
        const sample = screenRef.current?.querySelector('.cards .card');
        const sr = sample?.getBoundingClientRect();
        setReservedView({
            card,
            rect: el.getBoundingClientRect(),
            w: sr?.width ?? 76,
            h: sr?.height ?? 102,
        });
    }

    function submit(action: Record<string, unknown>, added: Gem[]) {
        if (!myPlayer) return;
        const over = totalTokens(myPlayer) + added.length - TOKEN_LIMIT;
        if (over > 0) {
            setPending({ action, over, added });
            setReturns([]);
            setMenu(null);
        } else {
            dispatch(action);
            reset();
        }
    }

    // Your token counts after the pending action is applied — what's returnable.
    function heldAfterPending(g: Gem): number {
        if (!myPlayer) return 0;
        const added = pending ? pending.added.filter((x) => x === g).length : 0;
        return myPlayer.tokens[g] + added;
    }

    function clickGem(g: Gem) {
        if (pending) return; // mid token-return flow
        if (state.winnerId) return onToast('The game is over');
        if (!isMyTurn) return onToast('It’s not your turn');
        if (pendingNoble) return onToast('Choose a noble to finish your turn');
        if (g === 'gold') return onToast('Gold is only gained by reserving a card');

        const count = picks.filter((x) => x === g).length;
        const isPair = picks.length === 2 && picks[0] === picks[1];

        if (count > 0) {
            if (picks.length === 1) {
                // Second tap on a lone pick → take two of this colour.
                if (state.bank[g] >= 4) return setPicks([g, g]);
                return onToast(`You can only take 2 ${label(g)} when 4+ remain in the bank`);
            }
            return setPicks(picks.filter((x) => x !== g)); // deselect one of three
        }
        if (isPair) return onToast('You’re taking a pair — confirm or clear it first');
        if (picks.length >= 3) return onToast('You can take at most 3 different tokens');
        if (state.bank[g] < 1) return onToast(`No ${label(g)} tokens left in the bank`);
        setPicks([...picks, g]);
    }

    function clickReturn(g: Gem) {
        if (!pending || !myPlayer) return;
        setReturns((prev) => {
            const used = prev.filter((x) => x === g).length;
            if (used >= heldAfterPending(g) || prev.length >= pending.over) return prev;
            return [...prev, g];
        });
    }

    // Deselect one token of a colour you'd marked for return.
    function removeReturn(g: Gem) {
        setReturns((prev) => {
            const i = prev.lastIndexOf(g);
            if (i === -1) return prev;
            const next = [...prev];
            next.splice(i, 1);
            return next;
        });
    }

    const opponents = state.players.map((p, seat) => ({ p, seat })).filter(({ seat }) => seat !== mySeat);
    const winnerName = state.winnerId ? detail.players.find((p) => p.userId === state.winnerId) : null;

    // End-of-game result, from the local player's vantage point.
    const iWon = state.winnerId != null && myPlayer != null && state.winnerId === myPlayer.id;
    const iLost = state.winnerId != null && myPlayer != null && state.winnerId !== myPlayer.id;
    const winnerSeat = state.winnerId ? state.players.findIndex((p) => p.id === state.winnerId) : -1;
    const winnerPoints = winnerSeat >= 0 ? state.players[winnerSeat].points : 0;
    const lossMargin = myPlayer ? Math.max(0, winnerPoints - myPlayer.points) : 0;

    async function playAgain() {
        try {
            const next = await api.rematch(detail.id);
            navigate(`/g/${next.id}`);
        } catch {
            onToast('Could not start a rematch');
        }
    }

    return (
        <div className={`splendor-board ${iLost ? 'board-lost' : ''}`}>
            <div className="fly-layer" ref={flyLayerRef} />
            {rainbowOn && <RainbowArc key={rainbowKey} />}
            {turnFlash && (
                <div
                    key={turnFlash.key}
                    className={`turn-flash ${turnFlash.mine ? 'turn-flash--mine' : ''}`}
                    aria-hidden={!turnFlash.mine}
                >
                    <div className="turn-flash-box">
                        <div className="turn-flash-text">
                            {turnFlash.mine ? 'Your turn' : `${turnFlash.name}’s turn`}
                        </div>
                        {turnFlash.mine && (
                            <button
                                className="token-btn token-btn--confirm turn-flash-continue"
                                onClick={() => setTurnFlash(null)}
                            >
                                Continue
                            </button>
                        )}
                    </div>
                </div>
            )}
            <div className="device">
                <div className="screen" ref={screenRef}>
                    {/* Opponents */}
                    {opponents.length > 0 && (
                        <div className="players-scroll" ref={playersScrollRef}>
                            <div className="players">
                                {opponents.map(({ p, seat }) => (
                                    <Opponent
                                        key={p.id}
                                        player={p}
                                        seat={seat}
                                        name={seatName(seat)}
                                        active={seat === state.current}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Bank */}
                    <div className="bank">
                        {GEMS.map((g) => {
                            const sel = picks.filter((x) => x === g).length;
                            return (
                                <Token
                                    key={g}
                                    color={g}
                                    count={state.bank[g]}
                                    size="lg"
                                    onClick={() => clickGem(g)}
                                    style={{
                                        cursor: canAct && g !== 'gold' ? 'pointer' : 'default',
                                        ...selectStyle(g !== 'gold' && sel >= 1, sel === 2),
                                    }}
                                />
                            );
                        })}
                    </div>

                    {/* Final-round warning, pinned under the bank */}
                    {!state.winnerId && state.finalRound && (
                        <div className="status-bar">
                            <div className="final-banner">Last round — everyone gets one final turn</div>
                        </div>
                    )}

                    {/* Nobles */}
                    {state.nobles.length > 0 && (
                        <div className="nobles-scroll" ref={noblesScrollRef}>
                            <div className="nobles">
                                {state.nobles.map((n) => (
                                    <div className="noble" key={n.id} data-noble-id={n.id}>
                                        {COLORS.filter((c) => n.cost[c]).map((c) => (
                                            <span className={`noble-cost ${c}`} key={c}>
                                                {n.cost[c]}
                                            </span>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Card rows */}
                    {LEVELS.map((level, idx) => (
                        <div
                            className={`card-row ${idx === LEVELS.length - 1 ? 'card-row--last' : ''}`}
                            key={level}
                            ref={idx === 0 ? cardRowRef : undefined}
                        >
                            <div className="cards">
                                {state.board[level].map((card, i) =>
                                    card ? (
                                        <Card
                                            key={card.id}
                                            card={card}
                                            lifted={menu?.card.id === card.id}
                                            affordable={!!(canAct && myPlayer && canAfford(myPlayer, card))}
                                            onClick={(e) => openCardMenu(card, 'board', e.currentTarget)}
                                        />
                                    ) : (
                                        <div
                                            key={`empty-${level}-${i}`}
                                            className={`card`}
                                            style={{ opacity: 0.2, cursor: 'default' }}
                                        />
                                    ),
                                )}
                            </div>
                        </div>
                    ))}

                    {/* You */}
                    {myPlayer && (
                        <>
                            <div className="self-head">
                                <div className="self-head-left">
                                    <span
                                        className={`self-tokens ${
                                            totalTokens(myPlayer) >= TOKEN_LIMIT ? 'is-full' : ''
                                        }`}
                                    >
                                        {totalTokens(myPlayer)} token{totalTokens(myPlayer) === 1 ? '' : 's'}
                                    </span>
                                </div>
                                <span className="self-score">{myPlayer.points}</span>
                            </div>
                            <PlayerCardsGems player={myPlayer} self seat={mySeat ?? undefined} />
                            <div className="self-nobles-scroll" ref={selfNoblesScrollRef}>
                                <div className="self-nobles">
                                    <div className="reserved">
                                        {myPlayer.reserved.map((c) =>
                                            isHidden(c) ? null : (
                                                <ReservedCard
                                                    key={c.id}
                                                    card={c}
                                                    affordable={canAct && canAfford(myPlayer, c)}
                                                    onClick={(e) => openReserved(c, e.currentTarget)}
                                                />
                                            ),
                                        )}
                                    </div>
                                    {myPlayer.nobles.map((n) => (
                                        <div className="noble" key={n.id}>
                                            {COLORS.filter((c) => n.cost[c]).map((c) => (
                                                <span className={`noble-cost ${c}`} key={c}>
                                                    {n.cost[c]}
                                                </span>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Take/return confirm bar — one element floated over the nobles. It
                opens on a legal take and, if that take puts you over the limit,
                morphs in place into the return prompt for a seamless transition. */}
            {(ready || pending) && myPlayer && (
                <>
                    <div className="backdrop is-open" onClick={() => (pending ? reset() : setPicks([]))} />
                    <div
                        className={`token-confirm is-open ${pending ? 'token-confirm--return' : ''}`}
                        ref={tokenBarRef}
                    >
                        {pending ? (
                            <>
                                <button
                                    className="token-btn token-btn--cancel token-x"
                                    aria-label="Cancel"
                                    onClick={reset}
                                >
                                    ×
                                </button>
                                <div className="token-summary" style={{ whiteSpace: 'normal' }}>
                                    Select {pending.over} token{pending.over === 1 ? '' : 's'} to return
                                </div>
                                <div className="bank" style={{ margin: 0, padding: 0 }}>
                                    {GEMS.map((g) => {
                                        const used = returns.filter((x) => x === g).length;
                                        const remaining = heldAfterPending(g) - used;
                                        return (
                                            <Token
                                                key={g}
                                                color={g}
                                                count={remaining}
                                                size="lg"
                                                onClick={() => clickReturn(g)}
                                                style={{
                                                    cursor: remaining === 0 ? 'default' : 'pointer',
                                                    ...selectStyle(used > 0),
                                                }}
                                            />
                                        );
                                    })}
                                </div>
                                {returns.length > 0 && (
                                    <div
                                        className="token-summary"
                                        style={{ flexWrap: 'wrap', justifyContent: 'center' }}
                                    >
                                        {dedupe(returns).map(([g, n]) => (
                                            <span
                                                className="sel-chip"
                                                key={g}
                                                onClick={() => removeReturn(g)}
                                                style={{ cursor: 'pointer' }}
                                                title="Remove"
                                            >
                                                <span className="sel-dot" style={{ background: gemVar(g) }} />
                                                {n > 1 ? `${n} × ` : ''}
                                                {label(g)}
                                                <span className="sel-chip-x">×</span>
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <div
                                    style={{
                                        display: 'flex',
                                        gap: '8px',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <button
                                        className="token-btn token-btn--confirm"
                                        style={{ marginLeft: 0 }}
                                        disabled={returns.length !== pending.over}
                                        onClick={() => {
                                            dispatch({ ...pending.action, returns });
                                            reset();
                                        }}
                                    >
                                        Confirm ({returns.length}/{pending.over})
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="token-summary" style={{ flex: 1 }}>
                                    {dedupe(picks).map(([g, n]) => (
                                        <span className="sel-chip" key={g}>
                                            <span className="sel-dot" style={{ background: gemVar(g) }} />
                                            {n === 2 ? '2 × ' : ''}
                                            {label(g)}
                                        </span>
                                    ))}
                                </div>
                                <button
                                    className="token-btn token-btn--confirm"
                                    onClick={() => submit({ type: 'take', gems: picks }, picks)}
                                >
                                    Take
                                </button>
                                <button
                                    className="token-btn token-btn--cancel"
                                    aria-label="Cancel"
                                    onClick={() => setPicks([])}
                                >
                                    ×
                                </button>
                            </>
                        )}
                    </div>
                </>
            )}

            {/* Card action menu */}
            {menu && (
                <>
                    <div className="backdrop is-open" onClick={reset} />
                    <div className="card-popup is-open" ref={popupRef}>
                        {myPlayer && canAfford(myPlayer, menu.card) && (
                            <button
                                className="card-action card-action--buy"
                                onClick={() => {
                                    flyCard(menu.el, selfColumn(menu.card.color));
                                    submit({ type: 'buy', cardId: menu.card.id }, []);
                                }}
                            >
                                Buy
                            </button>
                        )}
                        {menu.source === 'board' && (myPlayer?.reserved.length ?? 0) < 3 && (
                            <button
                                className="card-action card-action--reserve"
                                onClick={() => {
                                    const target =
                                        screenRef.current?.querySelector('.self-nobles .reserved') ?? null;
                                    flyCard(menu.el, target);
                                    submit(
                                        { type: 'reserve', cardId: menu.card.id },
                                        state.bank.gold > 0 ? ['gold'] : [],
                                    );
                                }}
                            >
                                Reserve
                            </button>
                        )}
                    </div>
                </>
            )}

            {/* Reserved card preview — tap a reserved chip to view it (and buy) */}
            {reservedView && (
                <>
                    <div className="backdrop is-open" onClick={() => setReservedView(null)} />
                    <div
                        ref={reservedPopRef}
                        style={{
                            position: 'fixed',
                            zIndex: 80,
                            width: reservedView.w,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                        }}
                    >
                        <Card card={reservedView.card} lifted />
                        {myPlayer && canAct && canAfford(myPlayer, reservedView.card) && (
                            <button
                                className="card-action card-action--buy reserved-buy"
                                onClick={() => {
                                    const src = reservedPopRef.current?.querySelector<HTMLElement>('.card');
                                    if (src) flyCard(src, selfColumn(reservedView.card.color));
                                    submit({ type: 'buy', cardId: reservedView.card.id }, []);
                                }}
                            >
                                Buy
                            </button>
                        )}
                    </div>
                </>
            )}

            {/* Noble choice */}
            {mustChooseNoble && pendingNoble && (
                <>
                    <div className="backdrop is-open" />
                    <div
                        className="token-confirm"
                        style={{
                            left: '50%',
                            top: '50%',
                            transform: 'translate(-50%, -50%)',
                            flexDirection: 'column',
                            alignItems: 'stretch',
                            gap: '12px',
                            opacity: 1,
                            visibility: 'visible',
                        }}
                    >
                        <div className="token-summary" style={{ whiteSpace: 'normal' }}>
                            Choose a noble:
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {pendingNoble.options.map((id) => {
                                const n = state.nobles.find((x) => x.id === id);
                                if (!n) return null;
                                return (
                                    <div
                                        className="noble"
                                        key={id}
                                        style={{ cursor: 'pointer', flex: '0 0 auto', minWidth: 80 }}
                                        onClick={() => {
                                            dispatch({ type: 'chooseNoble', nobleId: id });
                                            reset();
                                        }}
                                    >
                                        {COLORS.filter((c) => n.cost[c]).map((c) => (
                                            <span className={`noble-cost ${c}`} key={c}>
                                                {n.cost[c]}
                                            </span>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}

            {/* Game over — celebrate the winner, mourn for the rest */}
            {state.winnerId && (
                <div className={`game-over ${iLost ? 'game-over--loss' : 'game-over--win'}`}>
                    {!iLost && <ConfettiCannons />}
                    <div className="game-over-card">
                        <h2 className="game-over-title">
                            {iWon ? 'You won!' : iLost ? 'You lost' : 'Game over'}
                        </h2>
                        <p className="game-over-sub">
                            {iWon
                                ? `Victory with ${winnerPoints} points`
                                : iLost
                                  ? `You lost to ${winnerName?.name || 'the winner'} by ${lossMargin} point${lossMargin === 1 ? '' : 's'}`
                                  : `${winnerName?.name || 'A player'} won with ${winnerPoints} points`}
                        </p>
                        <div className="game-over-actions">
                            {myPlayer && (
                                <button className="token-btn token-btn--confirm" onClick={playAgain}>
                                    Play again
                                </button>
                            )}
                            <button className="token-btn game-over-leave" onClick={() => navigate('/')}>
                                Leave
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function gemVar(g: Gem): string {
    return `var(--gem-${g})`;
}

/**
 * A celebratory rainbow that draws from the lower-left, arches over the top of
 * the screen, and lands at the lower-right — seven parallel colour bands that
 * sweep in, hold, then fade. Played when a player first owns one card of every
 * colour. Full-viewport, pointer-transparent, and self-removing via its parent.
 */
function RainbowArc() {
    const bands = ['#e0413b', '#e98c2e', '#e9c83a', '#4f9d6b', '#5a8fd6', '#5b6bd6', '#9b59c6'];
    return (
        <svg className="rainbow-arc" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMax slice" aria-hidden>
            {bands.map((color, i) => (
                <path key={color} d={`M -40 660 Q 500 ${-360 + i * 32} 1040 660`} stroke={color} />
            ))}
        </svg>
    );
}

/**
 * Two confetti cannons firing from the bottom corners toward the centre, in a
 * few staggered bursts. Each bit is a small div tossed along an arc with the
 * Web Animations API, then removed. Honours reduced-motion (renders nothing).
 */
function ConfettiCannons() {
    const hostRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        const colors = ['#e0413b', '#e98c2e', '#e9c83a', '#4f9d6b', '#5a8fd6', '#9b59c6', '#f2f0ea'];
        const W = window.innerWidth;
        const H = window.innerHeight;
        const timers: number[] = [];

        // One spurt fires a cone of confetti, shooting inward, from a point just
        // off the screen. The origin is placed at fraction `t` (0→1) along the
        // lower perimeter — left side (lower half) → bottom → right side (lower
        // half) — so spurts spread evenly across the bottom and sides.
        const off = 70; // how far past the edge it starts
        const sideH = H * 0.5; // active height of each side (lower half)
        const perimeter = sideH + W + sideH;
        const spurt = (count: number, t: number) => {
            const d = t * perimeter;
            let ox: number;
            let oy: number;
            let inward: number; // +1 to fly right, -1 to fly left
            if (d < sideH) {
                // Left side, from the bottom upward into the lower half.
                ox = -off;
                oy = H - 30 - (d / sideH) * sideH;
                inward = 1;
            } else if (d < sideH + W) {
                // Bottom edge, left → right; shoot toward the centre.
                ox = d - sideH;
                oy = H + off;
                inward = ox < W / 2 ? 1 : -1;
            } else {
                // Right side, from the lower half down toward the bottom.
                ox = W + off;
                oy = H - 30 - sideH + ((d - sideH - W) / sideH) * sideH;
                inward = -1;
            }

            for (let i = 0; i < count; i++) {
                const bit = document.createElement('div');
                bit.className = 'confetti-bit';
                const w = 5 + Math.random() * 8;
                bit.style.width = `${w}px`;
                bit.style.height = `${Math.max(4, w * (0.4 + Math.random() * 0.6))}px`;
                bit.style.background = colors[(Math.random() * colors.length) | 0];
                bit.style.left = `${ox}px`;
                bit.style.top = `${oy}px`;
                host.appendChild(bit);

                // Burst inward + up fast, crest early, then flutter down slowly and
                // exit past the bottom regardless of where it launched from.
                const reach = W * (0.12 + Math.random() * 0.5);
                const dx = inward * reach + (Math.random() - 0.5) * W * 0.14; // cone spread
                const apexX = dx * (0.45 + Math.random() * 0.3);
                // Up from origin, but never high enough to crest over the top edge.
                const apex = -Math.min(H * 0.16 + Math.random() * H * 0.4, oy - 30);
                const fall = H + 120 - oy + Math.random() * H * 0.25; // below the screen
                const spin = (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 900);
                const sway = (Math.random() < 0.5 ? -1 : 1) * (16 + Math.random() * 48);
                const crest = 0.12 + Math.random() * 0.06; // shoots out quickly
                const dur = 4200 + Math.random() * 3000; // long, slow descent
                const lerpX = (t: number) => apexX + (dx - apexX) * t;
                const anim = bit.animate(
                    [
                        {
                            transform: 'translate(0px, 0px) rotate(0deg)',
                            opacity: 1,
                            offset: 0,
                            easing: 'cubic-bezier(0.1, 0.75, 0.3, 1)', // explosive launch
                        },
                        {
                            transform: `translate(${apexX}px, ${apex}px) rotate(${spin * 0.18}deg)`,
                            opacity: 1,
                            offset: crest,
                            easing: 'ease-in-out',
                        },
                        {
                            transform: `translate(${lerpX(0.4) + sway}px, ${apex + (fall - apex) * 0.4}px) rotate(${spin * 0.45}deg)`,
                            opacity: 1,
                            offset: crest + (1 - crest) * 0.4,
                            easing: 'ease-in-out',
                        },
                        {
                            transform: `translate(${lerpX(0.72) - sway}px, ${apex + (fall - apex) * 0.72}px) rotate(${spin * 0.75}deg)`,
                            opacity: 1,
                            offset: crest + (1 - crest) * 0.72,
                            easing: 'ease-in-out',
                        },
                        {
                            transform: `translate(${dx}px, ${fall}px) rotate(${spin}deg)`,
                            opacity: 0,
                            offset: 1,
                        },
                    ],
                    { duration: dur, delay: Math.random() * 260, fill: 'forwards' },
                );
                anim.onfinish = () => bit.remove();
            }
        };

        // Several spurts, evenly spread along the perimeter (one per stratified
        // slice, jittered within it) and fired in a shuffled order over ~2s.
        const SPURTS = 6;
        const slices = Array.from({ length: SPURTS }, (_, k) => (k + Math.random()) / SPURTS);
        // Shuffle so the even spread doesn't fire in a predictable sweep.
        for (let k = slices.length - 1; k > 0; k--) {
            const j = (Math.random() * (k + 1)) | 0;
            [slices[k], slices[j]] = [slices[j], slices[k]];
        }
        slices.forEach((t, k) => {
            timers.push(window.setTimeout(() => spurt(45 + ((Math.random() * 35) | 0), t), k * 360));
        });

        return () => {
            timers.forEach((t) => window.clearTimeout(t));
            host.replaceChildren();
        };
    }, []);
    return <div className="confetti-layer" ref={hostRef} aria-hidden />;
}

function label(g: Gem): string {
    return g.charAt(0).toUpperCase() + g.slice(1);
}

function dedupe(picks: Gem[]): [Gem, number][] {
    const map = new Map<Gem, number>();
    for (const g of picks) map.set(g, (map.get(g) ?? 0) + 1);
    return [...map.entries()];
}

/**
 * Fly a clone of `sourceEl` so it lands exactly on `targetEl` (the token slot),
 * shrinking to the slot's size. A tossed arc, a little spin, a stagger between
 * chips and a settle-bounce on arrival make it feel like a real chip thrown into
 * the stack — a livelier take on the original mockup's flyCardTo.
 */
function flyToken(sourceEl: HTMLElement | null, targetEl: HTMLElement | null, index = 0) {
    if (!sourceEl || !targetEl) return;
    const s = sourceEl.getBoundingClientRect();
    const t = targetEl.getBoundingClientRect();
    const clone = sourceEl.cloneNode(true) as HTMLElement;
    clone.classList.remove('is-selected', 'is-pair');
    clone.classList.add('flying-token');
    // The clone copies the bank chip's number (the count *before* the move);
    // a chip in flight should be a bare token, so drop the text.
    clone.textContent = '';
    clone.style.left = `${s.left}px`;
    clone.style.top = `${s.top}px`;
    clone.style.width = `${s.width}px`;
    clone.style.height = `${s.height}px`;
    // Keep the clone inside .splendor-board so the scoped fill/shape styles apply.
    const host = sourceEl.closest('.splendor-board') ?? document.body;
    host.appendChild(clone);

    // Land perfectly on the placeholder: scale the chip down to the slot's exact
    // size and move centre-to-centre.
    let scale = t.width / s.width;
    if (!isFinite(scale) || scale <= 0) scale = 0.5;
    const dx = t.left + t.width / 2 - (s.left + s.width / 2);
    const dy = t.top + t.height / 2 - (s.top + s.height / 2);

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const delay = index * 160;
    const safety = window.setTimeout(() => clone.remove(), delay + 2900);
    const cleanup = () => {
        window.clearTimeout(safety);
        clone.remove();
    };

    if (reduce) {
        const a = clone.animate(
            [
                { transform: 'translate(0,0) scale(1)', opacity: 1 },
                { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0 },
            ],
            { duration: 420, delay, easing: 'ease', fill: 'forwards' },
        );
        a.onfinish = cleanup;
        return;
    }

    const liftUp = 34; // how far it pops straight up before travelling
    const spin = dx >= 0 ? 10 : -10;

    // The travel leg follows a single quadratic Bézier from the lifted chip to
    // its slot, with the control point bowed well to the right and up — so the
    // whole path is one smooth, organic curve rather than angular segments.
    const p0 = { x: 0, y: -liftUp };
    const p1 = { x: dx, y: dy };
    const dist = Math.hypot(dx, dy + liftUp);
    const ctrl = {
        x: (p0.x + p1.x) / 2 + (90 + dist * 0.16), // strong rightward bow
        y: (p0.y + p1.y) / 2 - (40 + dist * 0.12), // gentle lift over the top
    };
    const bezier = (t: number) => {
        const u = 1 - t;
        return {
            x: u * u * p0.x + 2 * u * t * ctrl.x + t * t * p1.x,
            y: u * u * p0.y + 2 * u * t * ctrl.y + t * t * p1.y,
        };
    };
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    // Densely sample the curve so the motion reads as a continuous sweep.
    const travelStart = 0.45;
    const travel = [0.16, 0.34, 0.52, 0.7, 0.85, 1].map((t) => {
        const p = bezier(t);
        return {
            transform: `translate(${p.x}px, ${p.y}px) scale(${lerp(1.12, scale, t)}) rotate(${lerp(spin, 0, t)}deg)`,
            offset: travelStart + (1 - travelStart) * t,
            easing: 'linear' as const,
        };
    });

    const flight = clone.animate(
        [
            // 1) Pop straight up off the bank, no sideways motion yet.
            {
                transform: 'translate(0px, 0px) scale(1) rotate(0deg)',
                offset: 0,
                easing: 'cubic-bezier(0.25, 0.9, 0.3, 1)',
            },
            {
                transform: `translate(0px, ${-liftUp}px) scale(1.12) rotate(0deg)`,
                offset: 0.2,
                easing: 'linear',
            },
            // 2) Hold at the top for ~half a second, then ease into the curve.
            {
                transform: `translate(0px, ${-liftUp}px) scale(1.12) rotate(0deg)`,
                offset: travelStart,
                easing: 'cubic-bezier(0.45, 0, 0.5, 1)',
            },
            // 3) Sweep along the bowed curve into the slot.
            ...travel,
        ],
        { duration: 1700, delay, easing: 'cubic-bezier(0.31, 0.78, 0.32, 1)', fill: 'forwards' },
    );

    flight.onfinish = () => {
        // The chip melts into the real token, which gives a little bump.
        targetEl.animate(
            [{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }],
            { duration: 300, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
        );
        const fade = clone.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: 200,
            delay: 80,
            easing: 'ease-in',
            fill: 'forwards',
        });
        fade.onfinish = cleanup;
    };
}

function Card({
    card,
    lifted,
    affordable,
    onClick,
}: {
    card: SplendorCard;
    lifted: boolean;
    affordable?: boolean;
    onClick?: MouseEventHandler<HTMLDivElement>;
}) {
    return (
        <div
            className={`card ${card.color} ${lifted ? 'is-lifted' : ''} ${affordable ? 'can-buy' : ''}`}
            data-card-id={card.id}
            onClick={onClick}
        >
            <div className="card-top fill">{card.points || ' '}</div>
            <div className="card-cost">
                {(() => {
                    const costs = CARD_COLORS.filter((c) => card.cost[c]);
                    const n = costs.length;
                    return costs.map((c, idx) => {
                        const i = idx + 1;
                        const col = i <= 2 ? 1 : 2;
                        const cnt = col === 1 ? Math.min(n, 2) : n - 2;
                        const within = col === 1 ? i - 1 : i - 3;
                        const place: CSSProperties | undefined =
                            n <= 4 ? { gridColumn: col, gridRow: 2 - cnt + within + 1 } : undefined;
                        return (
                            <Token key={c} color={c} count={card.cost[c] ?? 0} size="x-sm" style={place} />
                        );
                    });
                })()}
            </div>
        </div>
    );
}

function ReservedCard({
    card,
    affordable,
    onClick,
}: {
    card: SplendorCard;
    affordable?: boolean;
    onClick: MouseEventHandler<HTMLDivElement>;
}) {
    return (
        <div className={`reserved-card ${card.color} ${affordable ? 'can-buy' : ''}`} onClick={onClick}>
            <div className={`reserved-card-top fill`}>{card.points || ''}</div>
        </div>
    );
}

function Opponent({
    player,
    seat,
    name,
    active,
}: {
    player: SplendorPlayer;
    seat: number;
    name: string;
    active: boolean;
}) {
    const reservedCount = player.reserved.length;
    return (
        <div className={`player ${active ? 'player--active' : ''}`} data-seat={seat}>
            <div className="player-row">
                <span className="player-name">{name}</span>
                <span className="player-score">{player.points}</span>
            </div>
            <PlayerCardsGems player={player} seat={seat} />
            {(reservedCount > 0 || player.nobles.length > 0) && (
                <div className="opp-extras">
                    {reservedCount > 0 && (
                        <div className="opp-reserved" title={`${reservedCount} reserved`}>
                            {player.reserved.map((c) => (
                                <span className={`opp-reserved-back lvl-${c.level}`} key={c.id}>
                                    {c.level}
                                </span>
                            ))}
                        </div>
                    )}
                    <div className="opp-nobles" title={`${player.nobles.length} nobles`}>
                        {player.nobles.map((n) => (
                            <span className="opp-noble" key={n.id}>
                                {n.points}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function PlayerCardsGems({ player, self, seat }: { player: SplendorPlayer; self?: boolean; seat?: number }) {
    const b = bonuses(player);
    return (
        <div className={`player-gems ${self ? 'player-gems--self' : ''}`} data-seat={seat}>
            {COLORS.map((c) => (
                <div className={`pg-col ${c}`} key={c}>
                    <div
                        className={`pg-card ${player.cards.filter((card) => card.color === c).length > 0 ? 'fill' : 'empty'}`}
                    >
                        {b[c]}
                    </div>
                    <Token
                        color={c}
                        count={player.tokens[c]}
                        size="sm"
                        style={{
                            position: 'absolute',
                            left: '-8px',
                            bottom: '-9px',
                            ...(player.tokens[c] ? { boxShadow: '0 0 0 2px #07080a' } : {}),
                        }}
                    />
                </div>
            ))}
            <div className="pg-col">
                <Token color="gold" count={player.tokens.gold} size="lg" style={{ marginInline: 'auto' }} />
            </div>
        </div>
    );
}

/** Toggle has-left / has-right shadows as a scroll row moves (matches original). */
function useScrollFade(ref: RefObject<HTMLDivElement>) {
    useEffect(() => {
        const scroll = ref.current;
        const track = scroll?.firstElementChild as HTMLElement | null;
        if (!scroll || !track) return;
        const update = () => {
            const max = track.scrollWidth - track.clientWidth;
            scroll.classList.toggle('has-left', track.scrollLeft > 1);
            scroll.classList.toggle('has-right', track.scrollLeft < max - 1);
        };
        track.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        update();
        return () => {
            track.removeEventListener('scroll', update);
            window.removeEventListener('resize', update);
        };
    });
}

/**
 * A round token chip. Used everywhere a token is shown — the board bank, the
 * return prompt, and each player's tray. `size` is `sm` (32px) or `lg` (45px);
 * when `count` is 0 it renders the neutral dashed-outline empty slot (identical
 * for every color) instead of a number. Positioning and selection effects are
 * passed in via the `style` prop at the call site.
 */
export function Token({
    color,
    count,
    onClick,
    style,
    title,
    size = 'lg',
}: {
    color: Gem;
    count: number;
    onClick?: MouseEventHandler<HTMLDivElement>;
    style?: CSSProperties;
    title?: string;
    size?: 'sm' | 'lg' | 'x-sm';
}) {
    return (
        <div
            className={`token ${color} ${size} ${count ? 'fill' : 'empty'}`}
            onClick={onClick}
            title={title}
            style={style}
        >
            {count || '0'}
        </div>
    );
}
