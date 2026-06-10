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
}: {
    detail: GameDetail;
    me: PublicUser;
    dispatch: (action: unknown) => void;
    onToast: (msg: string) => void;
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

    // Fly a clone of a board card to the reserved area, melting into the new chip
    // (ported from the original mockup's flyCardTo).
    function flyCard(sourceEl: HTMLElement, targetEl: Element | null) {
        const layer = flyLayerRef.current;
        if (!layer || !targetEl) return;
        const s = sourceEl.getBoundingClientRect();
        const t = targetEl.getBoundingClientRect();
        const clone = sourceEl.cloneNode(true) as HTMLElement;
        clone.classList.remove('is-lifted');
        clone.classList.add('flying-card');
        clone.style.left = `${s.left}px`;
        clone.style.top = `${s.top}px`;
        clone.style.width = `${s.width}px`;
        clone.style.height = `${s.height}px`;
        layer.appendChild(clone);
        clone.getBoundingClientRect(); // force reflow before transition

        let scale = Math.min(t.width / s.width, t.height / s.height);
        if (!isFinite(scale) || scale <= 0) scale = 0.2;
        const dx = t.left + t.width / 2 - (s.left + s.width / 2);
        const dy = t.top + t.height / 2 - (s.top + s.height / 2);
        clone.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;

        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            clone.style.transition = 'opacity 0.16s ease';
            clone.style.opacity = '0';
            setTimeout(() => clone.remove(), 170);
        };
        clone.addEventListener('transitionend', finish, { once: true });
        setTimeout(finish, 700);
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
    const turnStatus = state.winnerId
        ? winnerName
            ? `${winnerName.userId === me.id ? 'You' : winnerName.name} won`
            : 'Game over'
        : mustChooseNoble
          ? 'Choose a noble'
          : isMyTurn
            ? 'Your turn'
            : `${seatName(state.current)}’s turn`;

    return (
        <div className="splendor-board">
            <div className="fly-layer" ref={flyLayerRef} />
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

                    {/* Nobles */}
                    {state.nobles.length > 0 && (
                        <div className="nobles-scroll" ref={noblesScrollRef}>
                            <div className="nobles">
                                {state.nobles.map((n) => (
                                    <div className="noble" key={n.id}>
                                        {COLORS.filter((c) => n.cost[c]).map((c) => (
                                            <span className={`noble-cost ${c}`} key={c}>
                                                <span className="gem fill" />
                                                <span>{n.cost[c]}</span>
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
                                        {totalTokens(myPlayer)} tokens
                                    </span>
                                    {(state.winnerId || mustChooseNoble) && (
                                        <span className="self-turn">{turnStatus}</span>
                                    )}
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
                                                <span className="noble-cost" key={c}>
                                                    <span className={`gem gem--${c}`} />
                                                    <span className="noble-cost-count">{n.cost[c]}</span>
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
                                onClick={() => submit({ type: 'buy', cardId: menu.card.id }, [])}
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
                                onClick={() => submit({ type: 'buy', cardId: reservedView.card.id }, [])}
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
                                            <span className="noble-cost" key={c}>
                                                <span className={`gem gem--${c}`} />
                                                <span className="noble-cost-count">{n.cost[c]}</span>
                                            </span>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

function gemVar(g: Gem): string {
    return `var(--gem-${g})`;
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
    const safety = window.setTimeout(() => clone.remove(), delay + 1800);
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

    const mid = (scale + 1) / 2; // halfway size at the top of the arc
    const lift = Math.min(46, 22 + Math.abs(dx) * 0.18); // gentle toss height
    const spin = dx >= 0 ? 12 : -12;

    const flight = clone.animate(
        [
            { transform: 'translate(0px, 0px) scale(1) rotate(0deg)', offset: 0 },
            {
                transform: `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(${mid}) rotate(${spin}deg)`,
                offset: 0.55,
            },
            // Slight overshoot, then settle into the slot.
            {
                transform: `translate(${dx}px, ${dy}px) scale(${scale * 1.14}) rotate(0deg)`,
                offset: 0.84,
            },
            { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(0deg)`, offset: 1 },
        ],
        { duration: 900, delay, easing: 'cubic-bezier(0.31, 0.78, 0.32, 1)', fill: 'forwards' },
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
            onClick={onClick}
        >
            <div className="card-top fill">{card.points || ' '}</div>
            <div className="card-cost">
                {CARD_COLORS.filter((c) => card.cost[c]).map((c) => (
                    <span className={`cost ${c}`} key={c}>
                        ● {card.cost[c]}
                    </span>
                ))}
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
    return (
        <div className={`player ${active ? 'player--active' : ''}`}>
            <div className="player-row">
                <span className="player-name">{name}</span>
                <span className="player-score">{player.points}</span>
            </div>
            <PlayerCardsGems player={player} seat={seat} />
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
    size?: 'sm' | 'lg';
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
