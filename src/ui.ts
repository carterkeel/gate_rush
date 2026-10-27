import { sound } from './audio';
import { PLAYER_ICON } from './skullData';
import { skullSvg } from './skullSvg';
import { fmt, fmtInt } from './logic';
import { SKINS, TRAILS, SPEED_COST, START_MAX_LEVEL, startCost, startMeters } from './storage';
import type { SaveData } from './storage';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export interface RunSummary {
  title: string;
  distance: number;
  peak: number;
  kills: number;
  score: number;
  coins: number; // total, including the army bonus
  armyBonus: number; // 1 coin per million in the largest army
  start: number; // head start metres used this run (0 = none)
  highlight: string | null;
  newBest: boolean;
}

const coinHtml = (n: number | string) => `<span class="coin"></span>${typeof n === 'number' ? fmtInt(n) : n}`;

export class UI {
  onPlay = () => {};
  onSkipTutorial = () => {};
  onTutorial = () => {};
  onArmy = () => {};
  onInsta = () => {};
  onDouble = () => {};
  onAgain = () => {};
  onMenu = () => {};
  onPause = () => {};
  onFast = () => {};
  onBoostHud = () => {};
  onUpgrade = () => {}; // upgrades changed (speed unlock)
  onResume = () => {};
  onRestart = () => {};
  onChange = () => {}; // cosmetics changed

  private armyEl = $('army');
  private armyV = $('armyV');
  private distV = $('distV');
  private coinsV = $('coinsV');
  private banner = $('banner');
  private hint = $('hint');
  private combat = $('combat');
  private lastArmy = -1;
  private bannerTimer = 0;
  private bannerFade = 0;
  private lastDist = -1;
  private lastCoins = -1;

  constructor(private save: () => SaveData, private persist: () => void) {
    $('bPlay').onclick = () => this.onPlay();
    $('tutTag').onclick = () => this.onSkipTutorial();
    $('bTutorial').onclick = () => this.onTutorial();
    $('bSkins').onclick = () => this.showSkins();
    $('topScores').onclick = () => this.showScores();
    $('topScores').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') this.showScores(); };
    $('bSkinsBack').onclick = () => this.showMenu();
    $('bScoresBack').onclick = () => this.showMenu();
    $('bAgain').onclick = () => this.onAgain();
    $('bMenu').onclick = () => this.onMenu();
    $('bTutPlay').onclick = () => this.onAgain();
    $('bTutMenu').onclick = () => this.onMenu();
    // settings: volume sliders, reachable from the menu and the pause screen (Back returns to where you came from)
    let from: 'menu' | 'pause' = 'menu';
    const open = (f: 'menu' | 'pause') => {
      from = f;
      $('bTutorial').style.display = f === 'menu' && this.save().tutorialDone ? '' : 'none';
      $('bTutorial').textContent = 'REPLAY TUTORIAL';
      this.screens('settings');
    };
    $('bSettings').onclick = () => open('menu');
    $('bPauseSettings').onclick = () => open('pause');
    $('bReport').onclick = () => {
      $('rStatus').textContent = '';
      $('rStatus').className = 'rStatus';
      this.screens('report');
    };
    $('bReportBack').onclick = () => this.screens('settings');
    this.bindReport();
    $('bSettingsBack').onclick = () => (from === 'pause' ? this.screens('pause') : this.showMenu());
    const bind = (id: string, outId: string, get: () => number, set: (v: number) => void, preview: boolean) => {
      const el = $(id) as HTMLInputElement;
      const out = $(outId);
      const paint = () => {
        out.textContent = `${el.value}%`;
        el.style.setProperty('--v', `${el.value}%`);
      };
      el.value = String(Math.round(get() * 100));
      paint();
      el.oninput = () => {
        sound.unlock();
        set(Number(el.value) / 100);
        paint();
      };
      if (preview) el.onchange = () => sound.good(1.2);
    };
    bind('musicVol', 'musicOut', () => sound.musicVol, (v) => sound.setMusicVolume(v), false);
    bind('sfxVol', 'sfxOut', () => sound.sfxVol, (v) => sound.setSfxVolume(v), true);
    window.addEventListener('resize', () => this.fitScreens());
    $('bPause').onclick = () => this.onPause();
    $('bFast').onclick = () => this.onFast();
    $('bBoostHud').onclick = () => this.onBoostHud();
    $('bInstaHud').onclick = () => this.onInsta();
    $('bDoubleHud').onclick = () => this.onDouble();
    $('army').onclick = () => this.onArmy();
    $('bIntelResume').onclick = () => this.onResume();
    $('bUpgrades').onclick = () => this.showUpgrades();
    $('bUpBack').onclick = () => this.showMenu();
    document.querySelectorAll<HTMLButtonElement>('.boostToggle').forEach((b) => {
      b.onclick = () => {
        const d = this.save();
        d.startOn = !d.startOn;
        this.persist();
        this.syncBoost();
      };
    });
    $('bResume').onclick = () => this.onResume();
    $('bRestart').onclick = () => this.onRestart();
    $('bQuit').onclick = () => this.onMenu();
  }

  private screenTimers = new Map<string, number>();
  /** Screens that scroll get a sticky BACK with a fade; short ones keep it in the normal flow (no dark bar). */
  private fitScreens(): void {
    document.querySelectorAll<HTMLElement>('.screen.on').forEach((el) => {
      el.classList.remove('ovf');
      if (el.scrollHeight > el.clientHeight + 1) el.classList.add('ovf');
    });
  }
  /** Bug report form (Web3Forms). Plain POST of the form fields plus a few lines of device info. */
  private bindReport(): void {
    const msg = $('rMsg') as HTMLTextAreaElement;
    const email = $('rEmail') as HTMLInputElement;
    const send = $('bReportSend') as HTMLButtonElement;
    const status = $('rStatus');
    let lastSent = 0;
    const say = (t: string, cls: string) => {
      status.textContent = t;
      status.className = `rStatus ${cls}`;
    };
    send.onclick = async () => {
      msg.classList.remove('bad');
      email.classList.remove('bad');
      const text = msg.value.trim();
      if (text.length < 10) {
        msg.classList.add('bad');
        say('Please describe the bug in a few words.', 'err');
        return;
      }
      if (email.value.trim() && !email.validity.valid) {
        email.classList.add('bad');
        say('That email address does not look right.', 'err');
        return;
      }
      if (Date.now() - lastSent < 20000) {
        say('Please wait a few seconds before sending another.', 'err');
        return;
      }
      const best = this.save().scores[0];
      const info = [
        `Platform: ${document.documentElement.classList.contains('apk') ? 'Android app' : 'Web'}`,
        `Screen: ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio || 1}x`,
        `Best run: ${best ? `${fmt(best.score)} (${fmtInt(Math.floor(best.distance))} m)` : 'none yet'}`,
        `Device: ${navigator.userAgent}`,
      ].join('\n');
      const data = new FormData($('reportForm') as HTMLFormElement);
      data.set('message', `${text}\n\n---\n${info}`);
      send.disabled = true;
      send.textContent = 'SENDING…';
      say('Sending your report…', 'wait');
      try {
        const res = await fetch('https://api.web3forms.com/submit', { method: 'POST', headers: { Accept: 'application/json' }, body: data });
        const j = await res.json().catch(() => ({ success: false }));
        if (!res.ok || !j.success) throw new Error('send failed');
        lastSent = Date.now();
        msg.value = '';
        say('Thanks! Your report was sent.', 'ok');
      } catch {
        say('Could not send. Check your connection and try again.', 'err');
      }
      send.disabled = false;
      send.textContent = 'SEND REPORT';
    };
  }

  private screens(on: string | null): void {
    requestAnimationFrame(() => this.fitScreens());
    for (const id of ['menu', 'skins', 'scores', 'summary', 'pause', 'tutDone', 'settings', 'report', 'upgrades', 'intel']) {
      const el = $(id);
      const t = this.screenTimers.get(id);
      if (t) {
        clearTimeout(t);
        this.screenTimers.delete(id);
      }
      if (id === on) {
        // (re)start the entrance animation
        el.classList.remove('on', 'out');
        void el.offsetWidth;
        el.classList.add('on');
        el.scrollTop = 0;
      } else if (el.classList.contains('on') && !el.classList.contains('out')) {
        // animate out, then hide
        el.classList.add('out');
        this.screenTimers.set(
          id,
          window.setTimeout(() => {
            el.classList.remove('on', 'out');
            this.screenTimers.delete(id);
          }, 260),
        );
      }
    }
    this.screenUp = on !== null;
    this.syncLines();
  }

  // ------------------------------------------------------------- power-up pill + screen flash
  // ------------------------------------------------------------- route bar (a line sliding towards the player)
  private hudOn = false;
  private routeTicks = new Map<number, HTMLElement>();
  private routeH = 0;
  setRoute(r: { ticks: { id: number; frac: number; kind: 'plain' | 'yellow' | 'gold' | 'skull' | 'boss' }[]; fight: { boss: boolean; text: string; tone: string } | null } | null): void {
    const el = $('route');
    if (!r) {
      el.classList.remove('on');
      return;
    }
    if (!el.classList.contains('on')) {
      el.classList.add('on');
      el.querySelector<HTMLImageElement>('.rPlayer')!.src = PLAYER_ICON;
      this.routeH = 0;
    }
    el.classList.toggle('boss', !!(r.fight && r.fight.boss));
    for (const t of ['ok', 'tight', 'danger']) el.classList.toggle(t, !!r.fight && r.fight.tone === t);
    const need = el.querySelector<HTMLElement>('.rNeed')!;
    const txt = r.fight ? r.fight.text : '·';
    if (need.textContent !== txt) need.textContent = txt;

    const track = el.querySelector<HTMLElement>('.rTicks')!;
    if (!this.routeH) this.routeH = track.clientHeight || 200;
    const seen = new Set<number>();
    for (const t of r.ticks) {
      seen.add(t.id);
      let d = this.routeTicks.get(t.id);
      if (!d) {
        d = document.createElement('div');
        d.className = `rTick ${t.kind}`;
        d.innerHTML = t.kind === 'skull' || t.kind === 'boss' ? `<span class="sk">${skullSvg(t.kind === 'boss')}</span>` : '<i></i>';
        track.appendChild(d);
        this.routeTicks.set(t.id, d);
      }
      // frac 0 = at the player (bottom), 1 = far end (top); fade in/out at the ends so ticks never pop
      const y = (1 - t.frac) * this.routeH;
      d.style.transform = `translateY(${y.toFixed(1)}px)`;
      d.style.opacity = String(Math.max(0, Math.min(1, Math.min(t.frac * 8 + 0.2, (1 - t.frac) * 6))));
    }
    for (const [id, d] of this.routeTicks) {
      if (!seen.has(id) && !d.dataset.dying) {
        d.remove();
        this.routeTicks.delete(id);
      }
    }
  }

  /** The skull on the route bar cracks apart: pieces fly, a ring and flash burst, sparks and smoke follow. */
  routeBoom(id: number, boss: boolean): void {
    const d = this.routeTicks.get(id);
    if (!d) return;
    d.dataset.dying = '1';
    d.classList.add('boom');
    const svg = skullSvg(boss);
    const cut = [
      ['polygon(0 0,50% 0,50% 72%,0 72%)', -26, -24, -75],
      ['polygon(50% 0,100% 0,100% 72%,50% 72%)', 27, -28, 85],
      ['polygon(0 72%,100% 72%,100% 100%,0 100%)', 3, 32, 28],
    ] as const;
    const k = boss ? 1.3 : 1;
    let html = '<div class="rFlash"></div><div class="rRing"></div>';
    for (const [clip, dx, dy, rot] of cut) {
      html += `<span class="rPiece" style="clip-path:${clip};--dx:${dx * k}px;--dy:${dy * k}px;--r:${rot}deg">${svg}</span>`;
    }
    for (let i = 0; i < 4; i++) html += `<b class="rSmoke" style="--dx:${((Math.random() - 0.5) * 40).toFixed(0)}px;--dy:${(-6 - Math.random() * 22).toFixed(0)}px;animation-delay:${(i * 0.04).toFixed(2)}s"></b>`;
    const cols = boss ? ['#ffc21a', '#ff7a6a', '#fff3b0', '#c9a7ff'] : ['#fff3b0', '#ffb74d', '#ffe27a', '#ff8a96'];
    for (let i = 0; i < (boss ? 22 : 14); i++) {
      const a = (i / (boss ? 22 : 14)) * Math.PI * 2 + Math.random() * 0.4;
      const r = (22 + Math.random() * 30) * k;
      html += `<b class="rP" style="--dx:${(Math.cos(a) * r).toFixed(1)}px;--dy:${(Math.sin(a) * r).toFixed(1)}px;--r:${Math.round(Math.random() * 360)}deg;background:${cols[i % cols.length]}"></b>`;
    }
    d.innerHTML = `<div class="rBoom ${boss ? 'bossB' : ''}">${html}</div>`;
    window.setTimeout(() => {
      d.remove();
      this.routeTicks.delete(id);
    }, 900);
  }

  setInsta(count: number, armed: boolean): void {
    const b = $('bInstaHud');
    const want = `<span class="bi">⚡</span><span class="bs">KILL</span>`;
    const key = `${count}${armed ? 'a' : ''}`;
    if (b.dataset.k !== key) {
      b.dataset.k = key;
      b.innerHTML = want;
      if (count > 0 && !armed) {
        b.classList.remove('got');
        void b.offsetWidth;
        b.classList.add('got');
      }
    }
    b.style.display = (count > 0 || armed) && this.hudOn ? '' : 'none';
    this.packHud();
    b.classList.toggle('on', armed);
    b.setAttribute('aria-pressed', String(armed));
    b.title = armed ? 'Instakill armed for the next fight (tap to cancel)' : 'Tap to use your instakill';
  }

  setDouble(count: number): void {
    const b = $('bDoubleHud');
    if (b.dataset.k !== String(count)) {
      b.dataset.k = String(count);
      b.innerHTML = '<span class="bi">×2</span><span class="bs">ARMY</span>';
      if (count > 0) {
        b.classList.remove('got');
        void b.offsetWidth;
        b.classList.add('got');
      }
    }
    b.style.display = count > 0 && this.hudOn ? '' : 'none';
    this.packHud();
  }

  setPower(text: string | null, tone = ''): void {
    const el = $('power');
    if (text === null) {
      el.classList.remove('on');
      return;
    }
    if (el.textContent !== text) el.textContent = text;
    el.className = `on ${tone}`;
  }

  flash(color: string): void {
    const f = $('flash');
    f.style.background = color;
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  // ------------------------------------------------------------- largest-army bonus: count-down + growing coin stack
  private bonusRun = 0;
  private bonusSkip = false;

  /** The coin total pops and bursts into particles once it has finished counting. */
  private coinBurst(el: HTMLElement): void {
    el.classList.remove('tick');
    el.classList.add('boom');
    const cols = ['#ffe27a', '#ffc21a', '#fff3b0', '#ff9f1a', '#ffffff'];
    for (let i = 0; i < 30; i++) {
      const b = document.createElement('b');
      b.className = 'nP';
      const a = (i / 30) * Math.PI * 2 + Math.random() * 0.3;
      const r = 40 + Math.random() * 70;
      b.style.setProperty('--dx', `${(Math.cos(a) * r).toFixed(1)}px`);
      b.style.setProperty('--dy', `${(Math.sin(a) * r * 0.8).toFixed(1)}px`);
      b.style.setProperty('--r', `${Math.round(Math.random() * 540 - 270)}deg`);
      b.style.background = cols[i % cols.length];
      b.style.width = b.style.height = `${4 + Math.round(Math.random() * 5)}px`;
      el.appendChild(b);
      window.setTimeout(() => b.remove(), 1000);
    }
  }

  private revealStats(): void {
    $('sumGrid').classList.add('go');
  }

  private playArmyBonus(peak: number, coins: number): void {
    const run = ++this.bonusRun;
    this.bonusSkip = false;
    $('sumGrid').classList.remove('go');
    const box = $('bonus');
    const MILLION = 1_000_000;
    box.innerHTML =
      `<div class="bCoin"><b>0</b></div><div class="cStack"></div>` +
      `<div class="bTitle">LARGE ARMY BONUS</div>`;
    box.classList.toggle('on', coins > 0);
    box.classList.remove('win');
    box.onclick = () => (this.bonusSkip = true);
    const num = document.createElement('div'); // the army size is no longer shown; the count-down just drives the coins
    const stack = box.querySelector<HTMLElement>('.cStack')!;
    const coinB = box.querySelector<HTMLElement>('.bCoin b')!;
    const coinEl = box.querySelector<HTMLElement>('.bCoin')!;
    const alive = () => run === this.bonusRun;
    const wait = (ms: number) =>
      new Promise<void>((r) => {
        const t0 = performance.now();
        const poll = () => (this.bonusSkip || performance.now() - t0 >= ms ? r() : setTimeout(poll, 16));
        poll();
      });
    const tween = (from: number, to: number, ms: number, ease: (t: number) => number, onK?: (k: number) => void) =>
      new Promise<void>((resolve) => {
        const t0 = performance.now();
        const tick = (now: number) => {
          if (!alive()) return resolve();
          const k = this.bonusSkip ? 1 : Math.min(1, (now - t0) / ms);
          num.textContent = fmt(Math.round(from + (to - from) * ease(k)));
          onK?.(k);
          if (k < 1) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });

    // coin discs: stacks grow one coin at a time; when a stack would outgrow the box the coins shrink and
    // new stacks start next to it
    const AVAIL_W = Math.max(120, (stack.clientWidth || 300) - 8);
    const AVAIL_H = 82;
    let sc = 1;
    let per = 1;
    for (const k of [1, 0.8, 0.65, 0.5, 0.4, 0.32, 0.26, 0.2]) {
      sc = k;
      per = Math.max(1, Math.floor(AVAIL_H / (5 * k)));
      if (Math.ceil(coins / per) * (62 * k + 4) <= AVAIL_W) break;
    }
    const stackEls: HTMLElement[] = [];
    let shown = 0;
    const addDisc = (n: number) => {
      const i = shown++;
      const si = Math.floor(i / per);
      let col = stackEls[si];
      if (!col) {
        col = document.createElement('div');
        col.className = 'cs';
        col.style.width = `${62 * sc}px`;
        stack.appendChild(col);
        stackEls[si] = col;
      }
      const d = document.createElement('i');
      d.style.bottom = `${(i % per) * 5 * sc}px`;
      d.style.width = `${62 * sc}px`;
      d.style.height = `${15 * sc}px`;
      d.style.setProperty('--dx', `${((i * 7) % 3) - 1}px`);
      col.appendChild(d);
      sound.clink(n);
      coinB.textContent = String(shown);
      coinEl.classList.remove('tick');
      void coinEl.offsetWidth;
      coinEl.classList.add('tick');
    };

    void (async () => {
      await wait(380); // let the screen finish sliding in
      if (!alive()) return;
      // 1. the army number rolls up
      await tween(0, peak, 650, (t) => 1 - Math.pow(1 - t, 3));
      if (!alive()) return;
      if (coins <= 0) {
        this.revealStats();
        return;
      }
      await wait(220);
      if (!alive()) return;
      // 2. super-fast count-down: a coin lands on the stack at every million
      const end = peak - coins * MILLION;
      const dur = Math.max(1100, Math.min(2300, 900 + coins * 70));
      sound.sweep(dur / 1000);
      await tween(peak, end, dur, (t) => t * t * (3 - 2 * t), (k) => {
        const due = Math.min(coins, Math.floor(k * coins + 1e-6));
        while (shown < due) addDisc(shown);
      });
      if (!alive()) return;
      while (shown < coins) addDisc(shown);
      num.textContent = fmt(end);
      box.classList.add('win');
      sound.jackpot();
      this.coinBurst(coinEl);
      await wait(900);
      if (!alive()) return;
      this.revealStats();
    })();
  }

  // ------------------------------------------------------------- 2x speed lines (canvas streaks, only while actually running)
  private fastOn = false;
  private screenUp = true;
  private lineRaf = 0;
  private streaks: { a: number; r: number; v: number; len: number; w: number }[] = [];

  private syncLines(): void {
    const cv = $('speedlines') as HTMLCanvasElement;
    const active = this.fastOn && !this.screenUp && $('hud').classList.contains('on');
    cv.classList.toggle('on', active);
    if (active && !this.lineRaf) {
      let last = performance.now();
      const frame = (t: number) => {
        const dt = Math.min(0.05, (t - last) / 1000);
        last = t;
        this.drawLines(cv, dt);
        this.lineRaf = requestAnimationFrame(frame);
      };
      this.lineRaf = requestAnimationFrame(frame);
    } else if (!active && this.lineRaf) {
      cancelAnimationFrame(this.lineRaf);
      this.lineRaf = 0;
      cv.getContext('2d')?.clearRect(0, 0, cv.width, cv.height);
    }
  }

  private drawLines(cv: HTMLCanvasElement, dt: number): void {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h * 0.5, maxR = Math.hypot(w, h) / 2;
    while (this.streaks.length < 38) {
      this.streaks.push({ a: Math.random() * 6.283, r: Math.random() * maxR * 0.5, v: 0.6 + Math.random() * 0.8, len: 0.08 + Math.random() * 0.18, w: 1 + Math.random() * 1.6 });
    }
    g.lineCap = 'round';
    for (const s of this.streaks) {
      s.r += s.v * maxR * 1.7 * dt * (0.35 + s.r / maxR);
      if (s.r > maxR) { s.a = Math.random() * 6.283; s.r = maxR * (0.18 + Math.random() * 0.25); s.v = 0.6 + Math.random() * 0.8; }
      const k = s.r / maxR; // grows brighter and longer toward the edges
      const r0 = s.r, r1 = s.r + maxR * s.len * (0.4 + k);
      const c = Math.cos(s.a), n = Math.sin(s.a);
      g.strokeStyle = `rgba(255,255,255,${Math.min(0.55, k * 0.7)})`;
      g.lineWidth = s.w * (0.6 + k);
      g.beginPath();
      g.moveTo(cx + c * r0, cy + n * r0);
      g.lineTo(cx + c * r1, cy + n * r1);
      g.stroke();
    }
  }

  showPause(info: string): void {
    this.screens('pause');
  }

  showIntel(i: { title: string; rows: [string, string][]; note: string; tone: string }): void {
    $('intelTitle').textContent = i.title;
    $('intelGrid').innerHTML = i.rows.map(([k, v]) => `<div>${k}</div><div>${v}</div>`).join('');
    $('intelHl').textContent = i.note;
    $('intelHl').className = 'hl ' + i.tone;
    this.screens('intel');
  }

  showFast(on: boolean): void {
    $('bFast').style.display = on ? '' : 'none';
    this.packHud();
  }

  /** Stack the left-hand HUD buttons from the bottom with no gaps, whichever ones are showing. */
  packHud(): void {
    let k = 0;
    for (const id of ['bFast', 'bBoostHud', 'bInstaHud', 'bDoubleHud']) {
      const el = $(id);
      if (el.style.display === 'none') continue;
      el.style.bottom = `calc(max(20px, env(safe-area-inset-bottom)) + ${k * 60}px)`;
      k++;
    }
  }

  /** Keep every head-start toggle (menu, pause, summary, in-run button) in step with the save. */
  syncBoost(): void {
    const d = this.save();
    const m = startMeters(d.startLevel);
    const html = d.startOn
      ? `<span class="bt">➤ HEAD START</span><span class="bm">+${m} m</span>`
      : `<span class="bt">➤ HEAD START</span><span class="bm off">OFF</span>`;
    document.querySelectorAll<HTMLElement>('.boostToggle').forEach((b) => {
      if (b.closest('#upGrid')) {
        // keep the slot so buying the first level doesn't shift the card
        b.style.display = '';
        b.style.visibility = d.startLevel > 0 ? 'visible' : 'hidden';
      } else b.style.display = d.startLevel > 0 ? '' : 'none';
      b.innerHTML = html;
      b.classList.toggle('on', d.startOn);
    });
    const h = $('bBoostHud');
    h.innerHTML = `<span class="bi">➤</span><span class="bn">${m} m</span>`;
    h.classList.toggle('on', d.startOn);
    h.setAttribute('aria-pressed', String(d.startOn));
    h.title = d.startOn ? `Head start ON (+${m} m) for the next run` : 'Head start OFF for the next run';
  }

  showBoostHud(on: boolean): void {
    $('bBoostHud').style.display = on && this.save().startLevel > 0 ? '' : 'none';
    this.packHud();
  }

  setFast(on: boolean): void {
    const b = $('bFast');
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
    this.fastOn = on;
    this.syncLines();
    $('bFast').classList.toggle('on', on);
    $('bFast').setAttribute('aria-pressed', String(on));
  }

  showTutorialTag(on: boolean): void {
    $('tutTag').classList.toggle('on', on);
  }

  showHud(on: boolean): void {
    if (!on) this.showTutorialTag(false);
    $('hud').classList.toggle('on', on);
    this.hudOn = on;
    if (!on) {
      this.setRoute(null);
      $('bInstaHud').style.display = 'none';
      $('bDoubleHud').style.display = 'none';
      this.packHud();
    }
    this.syncLines();
    if (!on) {
      this.setCombat(null);
      this.setHint(null);
      this.banner.classList.remove('on');
    }
  }

  showMenu(): void {
    this.syncBoost();
    this.showHud(false);
    $('menuCoins').innerHTML = `<i class="coin"></i><b>${fmtInt(this.save().coins)}</b>`;
    $('bPlay').textContent = this.save().tutorialDone ? 'PLAY' : 'START TUTORIAL';
    const top = this.save().scores.slice(0, 3);
    $('topScores').innerHTML =
      `<div class="th"><span>TOP SCORES</span><span>›</span></div>` +
      (top.length
        ? top.map((t, i) => `<div class="r"><i>${i + 1}</i><b>${fmt(t.score)}</b><span>${fmtInt(Math.floor(t.distance))} m</span></div>`).join('')
        : '<div class="none">No runs yet</div>');
    this.screens('menu');
  }
  hideScreens(): void {
    this.screens(null);
  }

  // ------------------------------------------------------------- HUD
  setArmy(n: number): void {
    if (n === this.lastArmy) return;
    const up = n > this.lastArmy;
    this.armyV.textContent = fmt(n);
    if (this.lastArmy >= 0) {
      this.armyEl.classList.remove('up', 'down');
      void this.armyEl.offsetWidth;
      this.armyEl.classList.add(up ? 'up' : 'down');
    }
    this.lastArmy = n;
  }
  setDist(m: number): void {
    const v = Math.floor(m);
    if (v !== this.lastDist) {
      this.lastDist = v;
      this.distV.textContent = fmtInt(v);
    }
  }
  setCoins(c: number): void {
    const v = Math.floor(c);
    if (v !== this.lastCoins) {
      this.lastCoins = v;
      this.coinsV.textContent = fmtInt(v);
    }
  }
  resetHud(): void {
    this.lastArmy = -1;
    this.lastDist = -1;
    this.lastCoins = -1;
  }
  flashBanner(text: string, ms = 1400): void {
    this.banner.textContent = text;
    this.banner.className = /TRY AGAIN|BOSS|TITAN|ENEM/.test(text) ? 'red' : /GO!|ARMY|TUTORIAL/.test(text) ? 'green' : 'yellow';
    this.banner.style.fontSize = '';
    this.banner.style.animation = 'none'; // measure at full size, not mid pop-in
    void this.banner.offsetWidth;
    this.banner.classList.add('on');
    // never let a call-out run off a narrow screen: shrink it until its widest line fits, with room for the pop overshoot
    const avail = (window.innerWidth - 24) / 1.34;
    const widest = () => {
      const r = document.createRange();
      r.selectNodeContents(this.banner);
      return r.getBoundingClientRect().width;
    };
    for (let i = 0; i < 6 && widest() > avail; i++) {
      const fs = parseFloat(getComputedStyle(this.banner).fontSize) || 40;
      this.banner.style.fontSize = `${Math.max(12, (fs * avail) / widest() * 0.97).toFixed(1)}px`;
    }
    void this.banner.offsetWidth;
    this.banner.style.animation = '';
    window.clearTimeout(this.bannerTimer);
    window.clearTimeout(this.bannerFade);
    // fade out before removing, so a call-out never just vanishes
    this.bannerFade = window.setTimeout(() => this.banner.classList.add('out'), Math.max(200, ms - 280));
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('on', 'out'), ms);
  }
  setHint(text: string | null): void {
    if (text) this.hint.textContent = text;
    this.hint.classList.toggle('on', !!text);
  }
  private barPos: { x: number; y: number } | null = null;
  setCombat(state: { text: string; frac: number; boss?: boolean; tone?: 'ok' | 'tight' | 'danger'; at?: { x: number; y: number } | null } | null): void {
    this.combat.classList.toggle('on', !!state);
    if (!state) this.combat.classList.remove('placed');
    if (state) {
      for (const t of ['ok', 'tight', 'danger']) this.combat.classList.toggle(t, state.tone === t);
      this.combat.classList.toggle('boss', !!state.boss);
      $('combatT').textContent = state.text;
      if (state.at) {
        const w = this.combat.offsetWidth || 160;
        const x = Math.max(w / 2 + 8, Math.min(window.innerWidth - w / 2 - 8, state.at.x));
        const y = Math.max(114, state.at.y - 6);
        // heavy smoothing: the bar glides to its spot and ignores camera shake
        if (!this.barPos || !this.combat.classList.contains('placed')) this.barPos = { x, y };
        else this.barPos = { x: this.barPos.x + (x - this.barPos.x) * 0.08, y: this.barPos.y + (y - this.barPos.y) * 0.08 };
        this.combat.classList.add('placed');
        this.combat.style.left = `${this.barPos.x.toFixed(1)}px`;
        this.combat.style.top = `${this.barPos.y.toFixed(1)}px`;
      }
      ($('combatBar') as HTMLElement).style.width = `${Math.max(0, Math.min(1, state.frac)) * 100}%`;
    }
  }

  // ------------------------------------------------------------- summary
  showSummary(s: RunSummary): void {
    this.showHud(false);
    $('sumTitle').textContent = s.title;
    $('bAgain').textContent = 'PLAY AGAIN';
    $('sumNew').style.display = s.newBest ? 'block' : 'none';
    const rows: Array<[string, string, string]> = [
      ['DISTANCE', `${fmtInt(Math.floor(s.distance))} m`, 'cyan'],
      ['PEAK ARMY', fmt(s.peak), 'green'],
      ['ENEMIES KILLED', fmtInt(s.kills), 'red'],
      ['SCORE', fmt(s.score), 'gold big'],
      ['GOLD', `+${fmtInt(s.coins)}`, 'gold'],
    ];
    $('sumGrid').innerHTML = rows
      .map(([k, v, tone], i) => `<div class="k" style="--d:${i * 0.09}s">${k}</div><div class="v ${tone}" style="--d:${i * 0.09 + 0.05}s">${v}</div>`)
      .join('');
    const hl = $('sumHl');
    // the 'best move' line is switched off for now (the run still tracks it in s.highlight)
    hl.style.display = 'none';
    this.syncBoost();
    this.screens('summary');
    this.playArmyBonus(s.peak, s.armyBonus);
  }

  showTutorialDone(): void {
    this.showHud(false);
    this.screens('tutDone');
  }

  // ------------------------------------------------------------- upgrades
  showUpgrades(fresh = true): void {
    const d = this.save();
    const lvl = d.startLevel;
    const next = lvl + 1;
    const maxed = lvl >= START_MAX_LEVEL;
    $('upCoins').innerHTML = `<i class="coin"></i><b>${fmtInt(d.coins)}</b>`;
    const pips = Array.from({ length: START_MAX_LEVEL }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
    const canStart = !maxed && d.coins >= startCost(next);
    const canSpeed = !d.speedUnlocked && d.coins >= SPEED_COST;
    $('upGrid').innerHTML = `
      <div class="card up ${d.speedUnlocked ? 'eq' : ''}">
        <div class="upIcon">2×</div>
        <b>DOUBLE SPEED</b>
        <small>${d.speedUnlocked ? 'Use the 2× button during a run.' : 'Unlock a 2× run-speed button. Faster, harder, same rules.'}</small>
        ${d.speedUnlocked ? '<div class="status">✓ UNLOCKED</div>' : `<button data-up="speed" ${!canSpeed ? 'disabled' : ''}>UNLOCK ${coinHtml(SPEED_COST)}</button>`}
      </div>
      <div class="card up ${lvl > 0 ? 'eq' : ''}">
        <div class="upIcon">➤</div>
        <b>HEAD START</b>
        <small>Skip the early game: start further along, with an army to match.</small>
        <div class="pips">${pips}</div>
        <small>${maxed ? 'Max level' : `Next level: ${startMeters(next)} m`}</small>
        ${maxed ? '<div class="status">✓ MAXED</div>' : `<button data-up="start" ${!canStart ? 'disabled' : ''}>UPGRADE ${coinHtml(startCost(next))}</button>`}
        <button class="ghost boostToggle" ${lvl > 0 ? '' : 'style="visibility:hidden" tabindex="-1" aria-hidden="true"'}></button>
      </div>`;
    document.querySelectorAll<HTMLButtonElement>('#upGrid .boostToggle').forEach((b) => {
      b.onclick = () => {
        d.startOn = !d.startOn;
        this.persist();
        this.syncBoost();
      };
    });
    document.querySelectorAll<HTMLButtonElement>('#upGrid button[data-up]').forEach((b) => {
      b.onclick = () => {
        sound.unlock();
        if (b.dataset.up === 'speed' && !d.speedUnlocked && d.coins >= SPEED_COST) {
          d.coins -= SPEED_COST;
          d.speedUnlocked = true;
        } else if (b.dataset.up === 'start' && d.startLevel < START_MAX_LEVEL && d.coins >= startCost(d.startLevel + 1)) {
          d.coins -= startCost(d.startLevel + 1);
          d.startLevel++;
          d.startOn = true; // a fresh upgrade is switched on, so the player sees what it does
        } else return;
        sound.good(2.5);
        this.persist();
        this.onUpgrade();
        this.showUpgrades(false); // redraw in place: no screen transition, so you can keep buying
      };
    });
    this.syncBoost();
    if (fresh) this.screens('upgrades');
    else this.fitScreens();
  }

  // ------------------------------------------------------------- skins
  showSkins(fresh = true): void {
    const d = this.save();
    $('skinCoins').innerHTML = `<i class="coin"></i><b>${fmtInt(d.coins)}</b>`;
    const mk = (kind: 'skin' | 'trail') => {
      const list = kind === 'skin' ? SKINS : TRAILS;
      const owned = kind === 'skin' ? d.ownedSkins : d.ownedTrails;
      const eq = kind === 'skin' ? d.skin : d.trail;
      return list
        .map((it) => {
          const has = owned.includes(it.id);
          const sw =
            kind === 'skin'
              ? `linear-gradient(90deg, ${hex((it as (typeof SKINS)[number]).body)} 70%, ${hex((it as (typeof SKINS)[number]).accent)} 70%)`
              : (it as (typeof TRAILS)[number]).rainbow
                ? 'linear-gradient(90deg,#ff5252,#ffd740,#69f0ae,#40c4ff,#b388ff)'
                : (it as (typeof TRAILS)[number]).colors.length
                  ? `linear-gradient(90deg, ${(it as (typeof TRAILS)[number]).colors.map(hex).join(',')})`
                  : 'linear-gradient(90deg,#1fe06c,#ffc21a,#ff3d4d)';
          const label = eq === it.id ? 'EQUIPPED' : has ? 'EQUIP' : `BUY ${coinHtml(it.cost)}`;
          const dis = eq === it.id || (!has && d.coins < it.cost) ? 'disabled' : '';
          return `<div class="card ${eq === it.id ? 'eq' : ''} ${!has ? 'locked' : ''}"><div class="sw" style="background:${sw}"></div>${it.name}${eq === it.id ? '<div class="status">✓ EQUIPPED</div>' : `<button data-k="${kind}" data-id="${it.id}" ${dis}>${label}</button>`}</div>`;
        })
        .join('');
    };
    $('skinGrid').innerHTML = mk('skin');
    $('trailGrid').innerHTML = mk('trail');
    if (fresh) this.screens('skins');
    else this.fitScreens();
    document.querySelectorAll<HTMLButtonElement>('#skins button[data-id]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.id!;
        const kind = b.dataset.k as 'skin' | 'trail';
        const list = kind === 'skin' ? SKINS : TRAILS;
        const it = list.find((x) => x.id === id)!;
        const owned = kind === 'skin' ? d.ownedSkins : d.ownedTrails;
        if (!owned.includes(id)) {
          if (d.coins < it.cost) return;
          d.coins -= it.cost;
          owned.push(id);
        }
        if (kind === 'skin') d.skin = id;
        else d.trail = id;
        this.persist();
        this.onChange();
        this.showSkins(false);
      };
    });
  }

  // ------------------------------------------------------------- high scores
  showScores(): void {
    const d = this.save();
    const rows = d.scores.length
      ? d.scores
          .map(
            (s, i) =>
              `<tr><td>${i + 1}</td><td>${fmt(s.score)}</td><td>${fmtInt(Math.floor(s.distance))} m</td><td>${fmt(s.peak)}</td><td>${fmtInt(s.kills)}</td></tr>`,
          )
          .join('')
      : '';
    $('scoreTable').innerHTML = d.scores.length
      ? `<table><tr><th>#</th><th>SCORE</th><th>DIST</th><th>PEAK</th><th>KILLS</th></tr>${rows}</table>`
      : '<div class="learn emptyScores">No runs yet. Play a run to set a score!</div>';
    this.screens('scores');
  }
}
