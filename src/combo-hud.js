export const COMBO_COIN = '/assets/applovin/combo/coin.wav';
const METER_ART = [
  '/assets/applovin/combo/frame.png',
  '/assets/applovin/combo/track.png',
  '/assets/applovin/combo/fill.png'
];

export function normalizeCombo(input) {
  const seconds = (value, min, fallback) => {
    if (value == null || value === '' || !Number.isFinite(Number(value))) return fallback;
    return Math.min(120, Math.max(min, Math.round(Number(value) * 10) / 10));
  };
  return {
    mode: ['gold', 'timed'].includes(input?.mode) ? input.mode : 'off',
    goldSeconds: seconds(input?.goldSeconds, 0, 0),
    timedSeconds: seconds(input?.timedSeconds, 0.1, 6)
  };
}

export function getComboAssets(input) {
  switch (input?.mode) {
    case 'gold': return [COMBO_COIN];
    case 'timed': return [COMBO_COIN, ...METER_ART];
    default: return [];
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function positionCombo(root, view, game, vehicleId, timed) {
  const { clientWidth: width, clientHeight: height } = root.parentElement;
  let x = width / 2;
  let top = height * 0.60;
  if (timed) {
    const [first, second] = view.spotRoots.filter(spot => spot.visible).slice(0, 2)
      .map(spot => view.projectWorldToCanvas(spot.getWorldPosition(spot.position.clone())));
    const spacing = first && second ? Math.max(12, Math.abs(second.x - first.x)) : width / 7;
    root.style.setProperty('--combo-bay', spacing + 'px');
    if (first) {
      x = first.x + 0.33 * spacing;
      top = first.y + 1.04 * spacing;
    }
  } else {
    const occupied = [];
    let target;
    for (const vehicle of game.vehicles) {
      if (vehicle.id !== vehicleId && vehicle.state !== 'parked') continue;
      const object = view.vehicleViews.get(vehicle.id);
      const bounds = object?.visible && view.getObjectCanvasBounds(object);
      if (!bounds) continue;
      if (vehicle.id === vehicleId) target = bounds;
      else occupied.push(bounds);
    }
    const half = root.offsetWidth / 2;
    const h = root.offsetHeight;
    top = Math.min(height * 0.76, target?.minY ?? height, ...occupied.map(b => b.minY)) - h - 6;
    if (target) {
      x = clamp((target.minX + target.maxX) / 2, half + 5, width - half - 5);
      const candidates = [(target.minY + target.maxY - h) / 2, target.minY - h - 4, target.maxY + 4];
      for (const y of candidates) {
        if (y < 5 || y + h > height - 5) continue;
        if (occupied.some(b => x + half + 3 > b.minX && x - half - 3 < b.maxX
          && y + h + 3 > b.minY && y - 3 < b.maxY)) continue;
        top = y;
        break;
      }
    }
  }
  const half = root.offsetWidth / 2;
  root.style.left = clamp(x, half, width - half) + 'px';
  root.style.top = clamp(top, 5, height - root.offsetHeight - 5) + 'px';
}

export function createComboHud(root, { playCoin, getView, getGame }) {
  const label = root.querySelector('.combo-label');
  const fill = root.querySelector('.combo-fill');
  let settings = normalizeCombo();
  let hits = 0;
  let previousTime = 0;
  let lastVehicle;
  let expiry;
  let hideTimer;
  let lastCollision = 0;

  function clearStreak() {
    clearTimeout(expiry);
    clearTimeout(hideTimer);
    hits = 0;
    root.hidden = true;
  }
  function reset() {
    clearStreak();
    lastCollision = 0;
  }
  function configure(input) {
    const next = normalizeCombo(input);
    if (Object.keys(next).every(key => next[key] === settings[key])) return;
    clearStreak();
    settings = next;
    root.dataset.mode = settings.mode;
    if (settings.mode === 'timed') {
      root.querySelectorAll('img').forEach((img, i) => { img.src = METER_ART[i]; });
    }
  }
  function position() {
    if (!root.hidden) positionCombo(root, getView(), getGame(), lastVehicle, settings.mode === 'timed');
  }
  function dispatch(result, vehicleId) {
    if (settings.mode === 'off' || !result?.ok || !Number.isInteger(result.spotIndex)) return;
    const timed = settings.mode === 'timed';
    const interval = 1000 * (timed ? settings.timedSeconds : settings.goldSeconds);
    const now = performance.now();
    if (hits && interval && now - previousTime >= interval) clearStreak();
    previousTime = now;
    clearTimeout(expiry);
    if (interval) expiry = setTimeout(clearStreak, interval);
    if (++hits === 1) return;

    lastVehicle = vehicleId;
    root.hidden = false;
    label.textContent = 'COMBO ×' + (hits - 1);
    root.classList.remove('combo-pulse');
    if (timed) {
      fill.style.transition = 'none';
      fill.style.width = '100%';
    }
    position();
    void root.offsetWidth;
    root.classList.add('combo-pulse');
    if (timed) {
      fill.style.transition = 'width ' + interval + 'ms linear';
      fill.style.width = '0%';
    } else {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { root.hidden = true; }, 980);
    }
    playCoin();
  }
  function contact(event) {
    if (event.type !== 'vehicle-collision-contact' || event.collisionEventId <= lastCollision) return;
    lastCollision = event.collisionEventId;
    clearStreak();
  }
  return { configure, dispatch, contact, reset, position, clearStreak };
}
