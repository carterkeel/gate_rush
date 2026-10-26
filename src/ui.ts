import { sound } from './audio';
import { SKULL_BONE, SKULL_BOSS } from './skullData';
import { fmt } from './logic';
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

const coinHtml = (n: number | string) => `<span class="coin"></span>${n}`;

export class UI {
  onPlay = () => {};
  onTutorial = () => {};
  onArmy = () => {};
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
  private lastDist = -1;
  private lastCoins = -1;

  constructor(private save: () => SaveData, private persist: () => void) {
    $('bPlay').onclick = () => this.onPlay();
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
      $('bTutorial').style.display = f === 'menu' ? '' : 'none';
      this.screens('settings');
    };
    $('bSettings').onclick = () => open('menu');
    $('bPauseSettings').onclick = () => open('pause');
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
    $('bPause').onclick = () => this.onPause();
    $('bFast').onclick = () => this.onFast();
    $('bBoostHud').onclick = () => this.onBoostHud();
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
  private screens(on: string | null): void {
    for (const id of ['menu', 'skins', 'scores', 'summary', 'pause', 'tutDone', 'settings', 'upgrades', 'intel']) {
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
  // ------------------------------------------------------------- route bar (upcoming gates + next fight)
  private routeSig = '';
  setRoute(r: { sets: string[][]; fight: { boss: boolean; text: string; tone: string } | null } | null): void {
    const el = $('route');
    if (!r) {
      el.classList.remove('on');
      this.routeSig = '';
      return;
    }
    el.classList.add('on');
    const f = el.querySelector<HTMLElement>('.rFight')!;
    const img = el.querySelector<HTMLImageElement>('.rSkull')!;
    const need = el.querySelector<HTMLElement>('.rNeed')!;
    const want = r.fight && r.fight.boss ? SKULL_BOSS : SKULL_BONE;
    if (img.getAttribute('src') !== want) img.src = want;
    f.className = 'rFight' + (r.fight ? ` ${r.fight.tone}${r.fight.boss ? ' boss' : ''}` : ' dim');
    const txt = r.fight ? r.fight.text : '·';
    if (need.textContent !== txt) need.textContent = txt;
    const sig = r.sets.map((s) => s.join(',')).join('|');
    if (sig !== this.routeSig) {
      this.routeSig = sig;
      // far gates on top, the nearest one at the bottom
      const html = r.sets
        .slice()
        .reverse()
        .map((segs, i, a) => `<div class="rSet${i === a.length - 1 ? ' near' : ''}">${segs.map((t) => `<i class="${t}"></i>`).join('')}</div>`)
        .join('');
      el.querySelector('.rGates')!.innerHTML = html;
    }
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
      `<div class="bTitle">BONUS COINS FOR ARMY SIZE</div>` +
      `<div class="bBody"><div class="bNum">0</div><div class="bRight"><div class="cStack"></div><div class="bCoin"><span class="coin"></span><b>0</b></div></div></div>`;
    box.classList.add('on');
    box.onclick = () => (this.bonusSkip = true);
    const num = box.querySelector<HTMLElement>('.bNum')!;
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

    // coin discs: the stack gets taller with every coin (squeezed to fit once it is big)
    let shown = 0;
    const addDisc = (n: number) => {
      const i = shown++;
      const step = Math.max(1.6, Math.min(5, 96 / Math.max(1, coins)));
      const d = document.createElement('i');
      d.style.bottom = `${i * step}px`;
      d.style.setProperty('--dx', `${((i * 7) % 5) - 2}px`);
      stack.appendChild(d);
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
      await wait(650);
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
    $('pauseInfo').textContent = info;
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
  }

  /** Keep every head-start toggle (menu, pause, summary, in-run button) in step with the save. */
  syncBoost(): void {
    const d = this.save();
    const m = startMeters(d.startLevel);
    const html = d.startOn
      ? `<span class="bt">➤ HEAD START</span><span class="bm">+${m} m</span>`
      : `<span class="bt">➤ HEAD START</span><span class="bm off">OFF</span>`;
    document.querySelectorAll<HTMLElement>('.boostToggle').forEach((b) => {
      b.style.display = d.startLevel > 0 ? '' : 'none';
      b.innerHTML = html;
      b.classList.toggle('on', d.startOn);
    });
    const h = $('bBoostHud');
    h.innerHTML = `<span class="bi">➤</span><span class="bn">${m}m</span>`;
    h.classList.toggle('on', d.startOn);
    h.setAttribute('aria-pressed', String(d.startOn));
    h.title = d.startOn ? `Head start ON (+${m} m) for the next run` : 'Head start OFF for the next run';
  }

  showBoostHud(on: boolean): void {
    $('bBoostHud').style.display = on && this.save().startLevel > 0 ? '' : 'none';
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
    if (!on) this.setRoute(null);
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
    $('menuCoins').innerHTML = `Coins: ${coinHtml(this.save().coins)}`;
    $('bPlay').textContent = this.save().tutorialDone ? 'PLAY' : 'PLAY TUTORIAL';
    const top = this.save().scores.slice(0, 3);
    $('topScores').innerHTML =
      `<div class="th"><span>TOP SCORES</span><span>›</span></div>` +
      (top.length
        ? top.map((t, i) => `<div class="r"><i>${i + 1}</i><b>${fmt(t.score)}</b><span>${Math.floor(t.distance)} m</span></div>`).join('')
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
      this.distV.textContent = String(v);
    }
  }
  setCoins(c: number): void {
    const v = Math.floor(c);
    if (v !== this.lastCoins) {
      this.lastCoins = v;
      this.coinsV.textContent = String(v);
    }
  }
  resetHud(): void {
    this.lastArmy = -1;
    this.lastDist = -1;
    this.lastCoins = -1;
  }
  flashBanner(text: string, ms = 1400): void {
    this.banner.textContent = text;
    this.banner.classList.remove('on');
    void this.banner.offsetWidth;
    this.banner.classList.add('on');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('on'), ms);
  }
  setHint(text: string | null): void {
    if (text) this.hint.textContent = text;
    this.hint.classList.toggle('on', !!text);
  }
  setCombat(state: { text: string; frac: number; boss?: boolean; tone?: 'ok' | 'tight' | 'danger' } | null): void {
    this.combat.classList.toggle('on', !!state);
    if (state) {
      for (const t of ['ok', 'tight', 'danger']) this.combat.classList.toggle(t, state.tone === t);
      this.combat.classList.toggle('boss', !!state.boss);
      $('combatT').textContent = state.text;
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
      ['DISTANCE', `${Math.floor(s.distance)} m`, 'cyan'],
      ['PEAK ARMY', fmt(s.peak), 'green'],
      ['ENEMIES KILLED', String(s.kills), 'red'],
      ...(s.start > 0 ? ([['HEAD START', `+${s.start} m`, 'orange']] as Array<[string, string, string]>) : []),
      ['SCORE', fmt(s.score), 'gold big'],
      ['COINS EARNED', `+${s.coins - s.armyBonus}`, 'gold'],
      ...(s.armyBonus > 0 ? ([['ARMY BONUS', `+${s.armyBonus}`, 'purple']] as Array<[string, string, string]>) : []),
    ];
    $('sumGrid').innerHTML = rows
      .map(([k, v, tone], i) => `<div class="k" style="--d:${i * 0.09}s">${k}</div><div class="v ${tone}" style="--d:${i * 0.09 + 0.05}s">${v}</div>`)
      .join('');
    const hl = $('sumHl');
    hl.style.display = s.highlight ? 'block' : 'none';
    if (s.highlight) hl.textContent = '★ Best complex choice: ' + s.highlight;
    this.syncBoost();
    this.screens('summary');
    this.playArmyBonus(s.peak, s.armyBonus);
  }

  showTutorialDone(): void {
    this.showHud(false);
    this.screens('tutDone');
  }

  // ------------------------------------------------------------- upgrades
  showUpgrades(): void {
    const d = this.save();
    const lvl = d.startLevel;
    const next = lvl + 1;
    const maxed = lvl >= START_MAX_LEVEL;
    $('upCoins').innerHTML = `Coins: ${coinHtml(d.coins)}`;
    const pips = Array.from({ length: START_MAX_LEVEL }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
    const canStart = !maxed && d.coins >= startCost(next);
    const canSpeed = !d.speedUnlocked && d.coins >= SPEED_COST;
    $('upGrid').innerHTML = `
      <div class="card up ${d.speedUnlocked ? 'eq' : ''}">
        <div class="upIcon">2×</div>
        <b>DOUBLE SPEED</b>
        <small>${d.speedUnlocked ? 'Unlocked: use the 2× button in a run' : 'Unlock a 2× run-speed button. Faster, harder, same rules.'}</small>
        <button data-up="speed" ${d.speedUnlocked || !canSpeed ? 'disabled' : ''}>${d.speedUnlocked ? 'UNLOCKED' : `UNLOCK ${coinHtml(SPEED_COST)}`}</button>
      </div>
      <div class="card up ${lvl > 0 ? 'eq' : ''}">
        <div class="upIcon">➤</div>
        <b>HEAD START</b>
        <small>${lvl > 0 ? `Begin each run at ${startMeters(lvl)} m with an army to match.` : 'Skip the early game: start further along, with an army to match.'}</small>
        <div class="pips">${pips}</div>
        <small>Level ${lvl}/${START_MAX_LEVEL}${maxed ? '' : `  •  next: ${startMeters(next)} m`}</small>
        <button data-up="start" ${!canStart ? 'disabled' : ''}>${maxed ? 'MAXED' : `UPGRADE ${coinHtml(startCost(next))}`}</button>
        ${lvl > 0 ? '<button class="ghost boostToggle"></button>' : ''}
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
        this.showUpgrades();
      };
    });
    this.syncBoost();
    this.screens('upgrades');
  }

  // ------------------------------------------------------------- skins
  showSkins(): void {
    const d = this.save();
    $('skinCoins').innerHTML = `Coins: ${coinHtml(d.coins)}  •  cosmetics only`;
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
          return `<div class="card ${eq === it.id ? 'eq' : ''}"><div class="sw" style="background:${sw}"></div>${it.name}<small>${has ? 'Owned' : `${coinHtml(it.cost)} coins`}</small><button data-k="${kind}" data-id="${it.id}" ${dis}>${label}</button></div>`;
        })
        .join('');
    };
    $('skinGrid').innerHTML = mk('skin');
    $('trailGrid').innerHTML = mk('trail');
    this.screens('skins');
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
        this.showSkins();
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
              `<tr><td>${i + 1}</td><td>${fmt(s.score)}</td><td>${Math.floor(s.distance)} m</td><td>${fmt(s.peak)}</td><td>${s.kills}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="5" style="text-align:center;padding:20px">No runs yet. Go set one!</td></tr>';
    $('scoreTable').innerHTML = `<table><tr><th>#</th><th>SCORE</th><th>DIST</th><th>PEAK</th><th>KILLS</th></tr>${rows}</table>`;
    this.screens('scores');
  }
}
