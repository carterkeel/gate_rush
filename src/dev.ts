// Hidden dev menu (web only): unlock it with the Konami code, then switch dev mode on in Settings.
const KEY = 'gate-rush-dev';
const SEQ = ['U', 'U', 'D', 'D', 'L', 'R', 'L', 'R', 'B', 'A', 'S'];
const WINDOW_MS = 8000;

export interface DevState {
  unlocked: boolean;
  on: boolean;
  meters: number; // starting distance
  coins: number; // coins already in the run counter at the start
  infinite: boolean; // always holding an instakill and a x2
}

export const dev: DevState = { unlocked: false, on: false, meters: 0, coins: 0, infinite: false };

/** The Android app has no keyboard and no dev menu. */
const isWeb = (): boolean => !document.documentElement.classList.contains('apk');

function load(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(dev, JSON.parse(raw));
  } catch {
    /* ignore */
  }
  if (!isWeb()) dev.on = dev.unlocked = false;
}
function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(dev));
  } catch {
    /* ignore */
  }
}

const code = (e: KeyboardEvent): string | null => {
  switch (e.code) {
    case 'ArrowUp': return 'U';
    case 'ArrowDown': return 'D';
    case 'ArrowLeft': return 'L';
    case 'ArrowRight': return 'R';
    case 'KeyB': return 'B';
    case 'KeyA': return 'A';
    case 'KeyS': case 'Enter': return 'S';
    default: return null;
  }
};

/** Wire up the Konami listener and the Settings panel. `onUnlock` runs once when the code is entered. */
export function initDev(onUnlock: () => void): void {
  load();
  if (!isWeb()) return;
  const box = document.getElementById('devBox')!;
  const toggle = document.getElementById('devToggle') as HTMLButtonElement;
  const infinite = document.getElementById('devInf') as HTMLButtonElement;
  const meters = document.getElementById('devMeters') as HTMLInputElement;
  const coins = document.getElementById('devCoins') as HTMLInputElement;
  const opts = document.getElementById('devOpts')!;
  const sync = () => {
    box.style.display = dev.unlocked ? '' : 'none';
    toggle.textContent = dev.on ? 'DEV MODE: ON' : 'DEV MODE: OFF';
    toggle.classList.toggle('on', dev.on);
    infinite.textContent = dev.infinite ? '∞ POWER-UPS: ON' : '∞ POWER-UPS: OFF';
    infinite.classList.toggle('on', dev.infinite);
    opts.classList.toggle('dim', !dev.on);
    meters.value = String(dev.meters);
    coins.value = String(dev.coins);
  };
  const num = (el: HTMLInputElement, max: number) => Math.max(0, Math.min(max, Math.floor(Number(el.value) || 0)));
  toggle.onclick = () => {
    dev.on = !dev.on;
    save();
    sync();
  };
  infinite.onclick = () => {
    dev.infinite = !dev.infinite;
    save();
    sync();
  };
  meters.onchange = () => {
    dev.meters = num(meters, 20000);
    save();
    sync();
  };
  coins.onchange = () => {
    dev.coins = num(coins, 1_000_000);
    save();
    sync();
  };
  sync();

  const seen: { k: string; t: number }[] = [];
  window.addEventListener('keydown', (e) => {
    if (e.repeat || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    const k = code(e);
    if (!k) return;
    seen.push({ k, t: performance.now() });
    if (seen.length > SEQ.length) seen.shift();
    if (seen.length === SEQ.length && seen.every((s, i) => s.k === SEQ[i]) && seen[seen.length - 1].t - seen[0].t <= WINDOW_MS) {
      seen.length = 0;
      if (!dev.unlocked) {
        dev.unlocked = true;
        save();
        sync();
        onUnlock();
      }
    }
  });
}
