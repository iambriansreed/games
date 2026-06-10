(function () {
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';

  const popup = document.createElement('div');
  popup.className = 'card-popup';
  popup.innerHTML =
    '<button class="card-action card-action--buy" type="button">Buy</button>' +
    '<button class="card-action card-action--reserve" type="button">Reserve</button>';

  const toast = document.createElement('div');
  toast.className = 'toast';

  document.body.appendChild(backdrop);
  document.body.appendChild(popup);
  document.body.appendChild(toast);

  let toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('is-open');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('is-open');
    }, 2600);
  }

  let activeCard = null;

  // Bounds of the app itself, so floating UI never spills outside the frame.
  function appBounds() {
    const el = document.querySelector('.screen') || document.documentElement;
    return el.getBoundingClientRect();
  }

  function positionPopup(rect) {
    const margin = 8;
    const app = appBounds();
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;

    let left = rect.left + rect.width / 2 - pw / 2;
    left = Math.max(app.left + margin, Math.min(left, app.right - pw - margin));

    // Lifted card sits ~10px higher; prefer the menu below it, flip above if needed.
    let top = rect.bottom + 6;
    if (top + ph > app.bottom - margin) {
      top = rect.top - ph - 6;
    }
    top = Math.max(app.top + margin, top);

    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
  }

  function closeMenu() {
    if (activeCard) activeCard.classList.remove('is-lifted');
    activeCard = null;
    backdrop.classList.remove('is-open');
    popup.classList.remove('is-open');
  }

  const MAX_RESERVED = 3;
  const SELF_COLORS = ['white', 'blue', 'green', 'red', 'black'];
  const COST_TO_COLOR = {
    'cost--white': 'white',
    'cost--blue': 'blue',
    'cost--green': 'green',
    'cost--red': 'red',
    'cost--gray': 'black'
  };

  function reservedFull() {
    return reservedEl && reservedEl.children.length >= MAX_RESERVED;
  }

  function shakeEl(el, cls) {
    cls = cls || 'shake';
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
    setTimeout(function () {
      el.classList.remove(cls);
    }, 420);
  }

  function shakeCard(card) {
    shakeEl(card, 'card-shake');
  }

  function num(el) {
    const n = parseInt(el && el.textContent, 10);
    return isFinite(n) ? n : 0;
  }

  // What the current player can spend per colour (card bonuses + tokens).
  function selfTotals() {
    const totals = {};
    SELF_COLORS.forEach(function (c) {
      const fill = '.fill--' + c;
      totals[c] =
        num(document.querySelector('.player-gems--self .pg-card' + fill)) +
        num(document.querySelector('.player-gems--self .pg-token' + fill));
    });
    return totals;
  }

  function cardCost(card) {
    const cost = {};
    card.querySelectorAll('.card-cost .cost').forEach(function (span) {
      for (const cls in COST_TO_COLOR) {
        if (span.classList.contains(cls)) {
          cost[COST_TO_COLOR[cls]] = parseInt(span.textContent.replace(/\D/g, ''), 10) || 0;
        }
      }
    });
    return cost;
  }

  function canAfford(card) {
    const have = selfTotals();
    const cost = cardCost(card);
    for (const color in cost) {
      if ((have[color] || 0) < cost[color]) return false;
    }
    return true;
  }

  function openMenu(card) {
    if (activeCard) activeCard.classList.remove('is-lifted');
    const buyEl = popup.querySelector('.card-action--buy');
    const reserveEl = popup.querySelector('.card-action--reserve');
    // Only offer Buy if affordable; no reserving past the max of 3.
    buyEl.style.display = canAfford(card) ? '' : 'none';
    reserveEl.style.display = reservedFull() ? 'none' : '';
    if (buyEl.style.display === 'none' && reserveEl.style.display === 'none') {
      shakeCard(card); // nothing the player can do — nudge to show it
      showToast('You can neither buy nor reserve that card');
      return;
    }
    activeCard = card;
    positionPopup(card.getBoundingClientRect());
    card.classList.add('is-lifted');
    backdrop.classList.add('is-open');
    popup.classList.add('is-open');
  }

  document.querySelectorAll('.card').forEach(function (card) {
    card.addEventListener('click', function (e) {
      e.stopPropagation();
      if (activeCard === card) {
        closeMenu();
      } else {
        openMenu(card);
      }
    });
  });

  const reservedEl = document.getElementById('reserved');
  const buyBtn = popup.querySelector('.card-action--buy');
  const reserveBtn = popup.querySelector('.card-action--reserve');
  const COLOR_CLASSES = [
    'fill--white',
    'fill--blue',
    'fill--green',
    'fill--red',
    'fill--black'
  ];

  function cardColor(card) {
    const top = card.querySelector('.card-top');
    if (!top) return null;
    for (let i = 0; i < COLOR_CLASSES.length; i++) {
      if (top.classList.contains(COLOR_CLASSES[i])) return COLOR_CLASSES[i];
    }
    return null;
  }

  function flyCardTo(sourceEl, targetEl, onDone, opts) {
    opts = opts || {};
    if (!targetEl) {
      if (onDone) onDone();
      return;
    }
    const s = sourceEl.getBoundingClientRect();
    const t = targetEl.getBoundingClientRect();
    const clone = sourceEl.cloneNode(true);
    clone.classList.remove('is-lifted');
    clone.classList.add('flying-card');
    clone.style.left = s.left + 'px';
    clone.style.top = s.top + 'px';
    clone.style.width = s.width + 'px';
    clone.style.height = s.height + 'px';
    document.body.appendChild(clone);
    clone.getBoundingClientRect(); // force reflow before transition

    let scale = Math.min(t.width / s.width, t.height / s.height);
    if (!isFinite(scale) || scale <= 0) scale = 0.2;
    const dx = t.left + t.width / 2 - (s.left + s.width / 2);
    const dy = t.top + t.height / 2 - (s.top + s.height / 2);
    clone.style.transform =
      'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')';
    if (opts.fade !== false) clone.style.opacity = '0.15';

    let done = false;
    function finish() {
      if (done) return;
      done = true;
      if (onDone) onDone();
      if (opts.crossfade) {
        // Briefly fade the landed clone out so it melts into the real chip
        clone.style.transition = 'opacity 0.16s ease';
        clone.style.opacity = '0';
        setTimeout(function () {
          clone.remove();
        }, 170);
      } else {
        clone.remove();
      }
    }
    clone.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 700);
  }

  // Fly `sourceEl` to the self card matching `cardEl`'s colour, then bump it.
  function buyCard(sourceEl, cardEl, onDone) {
    const color = cardColor(cardEl);
    const target = color
      ? document.querySelector('.player-gems--self .pg-card.' + color)
      : null;
    flyCardTo(sourceEl, target, function () {
      if (target) {
        const n = parseInt(target.textContent, 10) || 0;
        target.textContent = String(n + 1);
        target.classList.add('pg-bump');
        setTimeout(function () {
          target.classList.remove('pg-bump');
        }, 320);
      }
      if (onDone) onDone();
    });
  }

  buyBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    const card = activeCard;
    if (!card) return;
    closeMenu();
    buyCard(card, card);
  });

  reserveBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    const card = activeCard;
    if (!card) return;
    if (reservedFull()) {
      closeMenu();
      return;
    }
    const color = cardColor(card);
    const cardClone = card.cloneNode(true);
    cardClone.classList.remove('is-lifted');
    closeMenu();
    if (!reservedEl) return;

    // Place the real chip first (hidden) so the card can land exactly on it.
    const topEl = card.querySelector('.card-top');
    const points = topEl ? topEl.textContent.trim() : '';
    const chip = document.createElement('div');
    chip.className = 'reserved-card';
    const strip = document.createElement('div');
    strip.className = 'reserved-card-top ' + (color || '');
    strip.textContent = points;
    chip.appendChild(strip);
    chip._cardEl = cardClone;
    chip.addEventListener('click', function (ev) {
      ev.stopPropagation();
      openExpanded(chip);
    });
    chip.style.opacity = '0';
    reservedEl.appendChild(chip);

    flyCardTo(
      card,
      chip,
      function () {
        chip.style.transition = 'opacity 0.16s ease';
        chip.style.opacity = '1';
      },
      { fade: false, crossfade: true }
    );
  });

  /* --- Tap a reserved card to expand it (native popover) above the chip --- */
  const reservedPreview = document.getElementById('reserved-preview');

  function openExpanded(chip) {
    if (!chip._cardEl || !reservedPreview) return;
    const sample = document.querySelector('.card-row .card');
    const sr = sample
      ? sample.getBoundingClientRect()
      : { width: 76, height: 102 };
    const tw = sr.width;
    const th = sr.height;
    const cr = chip.getBoundingClientRect();
    const margin = 8;

    const canBuy = canAfford(chip._cardEl);
    const extra = canBuy ? 46 : 0; // room for the Buy button
    const total = th + extra;

    // Keep the preview within the app's own bounds, not the whole window.
    const app = appBounds();

    let left = cr.left + cr.width / 2 - tw / 2;
    left = Math.max(
      app.left + margin,
      Math.min(left, app.right - tw - margin)
    );
    let top = cr.top - total - 10; // just above the reserved card
    if (top < app.top + margin) top = app.top + margin;

    reservedPreview.style.left = left + 'px';
    reservedPreview.style.top = top + 'px';
    reservedPreview.style.width = tw + 'px';
    reservedPreview.style.height = total + 'px';

    const big = chip._cardEl.cloneNode(true);
    big.classList.remove('is-lifted');
    big.classList.add('reserved-expanded');
    big.style.height = th + 'px';
    const parts = [big];

    if (canBuy) {
      const buy = document.createElement('button');
      buy.type = 'button';
      buy.className = 'card-action card-action--buy reserved-buy';
      buy.textContent = 'Buy';
      buy.addEventListener('click', function (ev) {
        ev.stopPropagation();
        reservedPreview.hidePopover();
        buyCard(chip, chip._cardEl, function () {
          chip.remove();
        });
      });
      parts.push(buy);
    }

    reservedPreview.replaceChildren.apply(reservedPreview, parts);
    reservedPreview.showPopover(); // native light-dismiss + Esc
  }

  if (reservedPreview) {
    // Tapping the preview itself closes it; outside-click/Esc handled natively.
    reservedPreview.addEventListener('click', function () {
      reservedPreview.hidePopover();
    });
  }

  backdrop.addEventListener('click', closeMenu);
  window.addEventListener('resize', function () {
    if (activeCard) positionPopup(activeCard.getBoundingClientRect());
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu();
  });

  /* --- Take 3 different tokens --- */
  const tokenBackdrop = document.createElement('div');
  tokenBackdrop.className = 'token-backdrop';

  const tokenConfirm = document.createElement('div');
  tokenConfirm.className = 'token-confirm';
  tokenConfirm.innerHTML =
    '<div class="token-summary" id="token-summary"></div>' +
    '<button class="token-btn token-btn--confirm" type="button">Confirm</button>' +
    '<button class="token-btn token-btn--cancel" type="button" aria-label="Cancel">&times;</button>';

  document.body.appendChild(tokenBackdrop);
  document.body.appendChild(tokenConfirm);

  const MAX_DIFFERENT = 3;
  const selectable = Array.prototype.slice.call(
    document.querySelectorAll('.bank-token:not(.bank-token--gold)')
  );
  const tokenSummary = tokenConfirm.querySelector('#token-summary');

  const COLOR_INFO = {
    'fill--white': { name: 'White', css: 'var(--gem-white)' },
    'fill--blue': { name: 'Blue', css: 'var(--gem-blue)' },
    'fill--green': { name: 'Green', css: 'var(--gem-green)' },
    'fill--red': { name: 'Red', css: 'var(--gem-red)' },
    'fill--black': { name: 'Black', css: 'var(--gem-black)' }
  };

  function infoFor(el) {
    for (const key in COLOR_INFO) {
      if (el.classList.contains(key)) return COLOR_INFO[key];
    }
    return { name: '?', css: '#888' };
  }

  // picks: array of { el, count } — count 1 (one token) or 2 (two of same colour)
  let picks = [];

  function findPick(el) {
    for (let i = 0; i < picks.length; i++) {
      if (picks[i].el === el) return picks[i];
    }
    return null;
  }

  function pairActive() {
    return picks.some(function (p) { return p.count === 2; });
  }

  // Ready on a legal Splendor take: three different, or two of the same colour
  function isReady() {
    return (
      (picks.length === 1 && picks[0].count === 2) ||
      picks.length === MAX_DIFFERENT
    );
  }

  function positionConfirm() {
    // Float the bar centred over the nobles (fall back to the card area).
    const anchor =
      document.querySelector('.nobles') || document.querySelector('.card-row');
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const app = appBounds();
    const bw = tokenConfirm.offsetWidth;
    const bh = tokenConfirm.offsetHeight;
    const margin = 8;
    let left = rect.left + rect.width / 2 - bw / 2;
    left = Math.max(app.left + margin, Math.min(left, app.right - bw - margin));
    let top = rect.top + rect.height / 2 - bh / 2;
    top = Math.max(app.top + margin, Math.min(top, app.bottom - bh - margin));
    tokenConfirm.style.left = left + 'px';
    tokenConfirm.style.top = top + 'px';
  }

  function render() {
    selectable.forEach(function (el) {
      el.classList.remove('is-selected', 'is-pair');
    });
    picks.forEach(function (p) {
      p.el.classList.add('is-selected');
      if (p.count === 2) p.el.classList.add('is-pair');
    });
    const ready = isReady();
    if (ready && tokenSummary) {
      tokenSummary.innerHTML = picks
          .map(function (p) {
            const info = infoFor(p.el);
            const qty = p.count === 2 ? '2 × ' : '';
            return (
              '<span class="sel-chip"><span class="sel-dot" style="background:' +
              info.css +
              '"></span>' +
              qty +
              info.name +
              '</span>'
            );
          })
          .join('');
    }
    tokenBackdrop.classList.toggle('is-open', ready);
    tokenConfirm.classList.toggle('is-open', ready);
    if (ready) positionConfirm();
  }

  const confirmBtn = tokenConfirm.querySelector('.token-btn--confirm');
  const cancelBtn = tokenConfirm.querySelector('.token-btn--cancel');
  let confirmTimer = null;
  let countdownInterval = null;

  function stopCountdown() {
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    confirmBtn.textContent = 'Confirm';
    confirmBtn.disabled = false;
  }

  function clearTokens() {
    stopCountdown();
    picks = [];
    render();
  }

  selectable.forEach(function (token) {
    token.addEventListener('click', function (e) {
      e.stopPropagation();
      const existing = findPick(token);
      if (existing) {
        if (existing.count === 1 && picks.length === 1) {
          // Taking two of one colour is only allowed if 2 would remain in the bank
          const bankCount = parseInt(token.textContent, 10) || 0;
          if (bankCount - 2 < 2) {
            shakeEl(token);
            showToast(
              'You can only select 2 tokens of the same color if 2 will remain'
            );
            return;
          }
          existing.count = 2; // second click on a lone pick => take two of this colour
        } else {
          picks = picks.filter(function (p) { return p.el !== token; });
        }
      } else {
        if (pairActive() || picks.length >= MAX_DIFFERENT) return;
        picks.push({ el: token, count: 1 });
      }
      render();
    });
  });

  cancelBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    clearTokens();
  });

  confirmBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (confirmTimer) return; // already counting down
    let n = 3;
    confirmBtn.disabled = true;
    confirmBtn.textContent = String(n);
    countdownInterval = setInterval(function () {
      n -= 1;
      if (n > 0) confirmBtn.textContent = String(n);
    }, 1000);
    confirmTimer = setTimeout(function () {
      clearTokens();
    }, 3000);
  });

  tokenBackdrop.addEventListener('click', clearTokens);
  window.addEventListener('resize', function () {
    if (isReady()) positionConfirm();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') clearTokens();
  });

  /* --- Shadow over rows scrolled partly out of view --- */
  function setupScrollFades(scrollEl, trackEl) {
    if (!scrollEl || !trackEl) return;
    function update() {
      const maxScroll = trackEl.scrollWidth - trackEl.clientWidth;
      scrollEl.classList.toggle('has-left', trackEl.scrollLeft > 1);
      scrollEl.classList.toggle('has-right', trackEl.scrollLeft < maxScroll - 1);
    }
    trackEl.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  setupScrollFades(
    document.querySelector('.players-scroll'),
    document.querySelector('.players-scroll .players')
  );
  setupScrollFades(
    document.querySelector('.nobles-scroll'),
    document.querySelector('.nobles-scroll .nobles')
  );
})();
