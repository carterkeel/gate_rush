import { dev, initDev } from './dev';
import * as THREE from 'three';
import { CFG, speedAt, spawnAheadDist, spacingAt } from './config';
import { World } from './world';
import { biomeIndex } from './biomes';
import { Army } from './army';
import { Fx } from './fx';
import { CombatSim } from './enemies';
import { SetView, TONE_COLOR } from './gateView';
import { UI } from './ui';
import type { RunSummary } from './ui';
import { Track, projectArmy, bestResult, headStartTrack } from './track';
import { TutorialSource } from './tutorial';
import { sound } from './audio';
import { CoinField } from './coins';
import { armyTier, clampArmy, evalEffect, effectText, effectTone, fmt, fmtInt, bestSplit } from './logic';
import type { Effect } from './logic';
import { SKINS, TRAILS, addScore, load, save, startMeters } from './storage';
import type { SaveData } from './storage';
import type { Bonus, CombatZone, GateSet, ItemSource, TrackItem } from './types';

type Mode = 'menu' | 'run' | 'over' | 'paused';

interface SplitCtx {
  set: GateSet;
  L: number;
  R: number;
  resolved: boolean;
  failed: boolean;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const TUTORIAL_SPEED = CFG.baseSpeed;

export class Game {
  private world: World;
  private army: Army;
  private fx: Fx;
  private combat: CombatSim;
  private coins: CoinField;
  /** Test hook: sets where the crossing result was below best play. */
  misses: Array<{ kind: string; s: number; A: number; result: number; best: number; idx: number }> = [];
  private heldRows: { from: number; to: number; x0: number; x1: number }[] = [];
  private setsSinceCoins = 0;
  private coinEvery = 5;
  private lastGateX = 0;
  private coinFrom = 0; // start of the next free stretch where coins may be laid
  private coinStreak = 0;
  private lastPickT = -9;
  private ui: UI;
  private data: SaveData = load();

  private mode: Mode = 'menu';
  private tutorial: TutorialSource | null = null;
  private source: ItemSource = new Track();
  private queue: TrackItem[] = [];
  private views = new Map<number, SetView>();
  private viewOrder: SetView[] = [];
  private placed = new Set<number>();
  private splitCtx: SplitCtx | null = null;

  private time = 0;
  private runTime = 0;
  private playerS = 0;
  private speed: number = CFG.baseSpeed;
  private targetX = 0;
  private keys = { left: false, right: false };
  private dragging = false;
  private lastPtrX = 0;
  private inCombat = false;
  private combatZone: CombatZone | null = null;
  private combatClearT = 0;
  private hurtT = 0;
  private hurtAcc = 0;
  private lossShown = 0;
  private lossT = 0;
  private shotT = 0;

  // run stats
  private peak: number = CFG.startArmy;
  private kills = 0;
  private bonusCoins = 0;
  private instaCount = 0; // saved instakills (use them with the purple button)
  private instakill = false; // armed: the next fight is wiped out
  private peakTier = 0; // highest army tier (power of a thousand) reached this run
  private doubleCount = 0; // saved x2 army power-up (hold one)
  private instaT = -1; // charge-up before the blast during a fight (-1 = none)
  private bestHl: { gain: number; text: string } | null = null;
  private trailT = 0;
  private trailColor = 0xffffff;
  private overT = 0;
  private overAt = 0;
  private summary: RunSummary | null = null;
  private tutorialFinished = false;
  private startDist = 0; // head start: metres skipped at the beginning of this run
  private startArmy: number = CFG.startArmy; // army handed out with the head start

  private camBack = 12;
  private lastBiome = 0;
  private lastT = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.world = new World(canvas);
    this.army = new Army(this.world.scene);
    this.fx = new Fx(this.world.scene, this.world.camera, document.getElementById('popups')!);
    this.combat = new CombatSim(this.world.scene);
    this.coins = new CoinField(this.world.scene);
    this.ui = new UI(
      () => this.data,
      () => save(this.data),
    );
    this.applyCosmetics();
    try {
      if (JSON.parse(localStorage.getItem('gate-rush-prefs') || '{}').fast === true) this.setFast(true);
    } catch {
      /* ignore */
    }
    this.bindUi();
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    document.addEventListener('visibilitychange', () => {
      this.lastT = 0;
      sound.setAway(document.hidden);
      if (document.hidden) this.pause();
    });
    window.addEventListener('blur', () => {
      sound.setAway(true);
      this.pause();
    });
    window.addEventListener('focus', () => sound.setAway(document.hidden));
    window.addEventListener('pagehide', () => sound.setAway(true));
    window.addEventListener('pageshow', () => sound.setAway(document.hidden));
    this.ui.showMenu();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ setup
  private resize(): void {
    this.world.resize(window.innerWidth, window.innerHeight);
  }

  private applyCosmetics(): void {
    const s = SKINS.find((x) => x.id === this.data.skin) ?? SKINS[0];
    this.army.setSkin(s);
    this.fx.trail = TRAILS.find((x) => x.id === this.data.trail) ?? TRAILS[0];
  }

  private bindUi(): void {
    this.ui.onPlay = () => this.startRun(!this.data.tutorialDone);
    this.ui.onSkipTutorial = () => {
      this.data.tutorialDone = true;
      save(this.data);
      this.startRun(false);
    };
    this.ui.onTutorial = () => this.startRun(true);
    this.ui.onAgain = () => this.startRun(false);
    this.ui.onMenu = () => this.toMenu();
    this.ui.onPause = () => this.pause();
    this.ui.onArmy = () => this.showIntel();
    this.ui.onInsta = () => {
      if (this.mode !== 'run' || this.tutorial) return;
      if (this.inCombat) {
        // use it right now, in the middle of the fight
        if (this.instaCount > 0 && this.instaT < 0) {
          this.instaCount--;
          this.instaT = 0.55;
          this.ui.flashBanner('⚡ INSTAKILL', 700);
          sound.power();
        }
        return;
      }
      if (this.instakill) {
        // cancel (gives it back), unless a second one is already in hand
        if (this.instaCount === 0) {
          this.instaCount = 1;
          this.instakill = false;
          sound.power();
        }
      } else if (this.instaCount > 0) {
        this.instaCount--;
        this.instakill = true;
        sound.power();
      }
    };
    initDev(() => this.mode === 'menu');
    this.ui.onDouble = () => {
      if (this.mode !== 'run' || this.tutorial || this.doubleCount === 0) return;
      if (this.splitCtx && !this.splitCtx.resolved) return;
      this.doubleCount = 0;
      this.useDouble();
    };
    this.ui.onFast = () => this.setFast(!this.fast);
    this.ui.onBoostHud = () => {
      this.data.startOn = !this.data.startOn;
      save(this.data);
      this.ui.syncBoost();
      const m = startMeters(this.data.startLevel);
      this.ui.flashBanner(this.data.startOn ? `HEAD START +${m}\u00A0m NEXT RUN` : 'HEAD START OFF', 1300);
    };
    this.ui.onResume = () => this.resume();
    this.ui.onRestart = () => this.startRun(this.tutorial !== null);
    this.ui.onChange = () => this.applyCosmetics();
  }

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastPtrX = e.clientX;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPtrX;
      this.lastPtrX = e.clientX;
      // dragging 70 % of the screen width sweeps the whole lane
      this.targetX += dx * ((CFG.pathWidth * 1.0) / (window.innerWidth * 0.7));
      this.targetX = clamp(this.targetX, -4.4, 4.4);
    });
    const up = () => (this.dragging = false);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    document.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) sound.click();
    });
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
  }

  private key(e: KeyboardEvent, down: boolean): void {
    if (down && !e.repeat && (e.code === 'Escape' || e.code === 'KeyP')) {
      if (this.mode === 'run') this.pause();
      else if (this.mode === 'paused') this.resume();
      return;
    }
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.keys.left = down;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.keys.right = down;
    else return;
    e.preventDefault();
  }

  // ------------------------------------------------------------------ run lifecycle
  private clearWorld(): void {
    this.coins.clear();
    this.heldRows.length = 0;
    this.coinFrom = 0;
    this.setsSinceCoins = 0;
    this.coinEvery = 5;
    this.lastGateX = 0;
    for (const v of this.viewOrder) {
      this.world.scene.remove(v.root);
      v.dispose();
    }
    this.views.clear();
    this.viewOrder = [];
    this.queue = [];
    this.placed.clear();
    this.splitCtx = null;
    this.combat.clear();
    this.combat.kills = 0;
    this.combat.titanKills = 0;
    this.combat.bossKills = 0;
    this.hurtAcc = this.lossShown = 0;
    this.fx.clear();
  }

  private startRun(tutorial: boolean): void {
    this.clearWorld();
    this.world.reset(0);
    this.army.reset();
    this.tutorial = tutorial ? new TutorialSource() : null;
    this.source = this.tutorial ?? new Track();
    this.mode = 'run';
    this.runTime = 0;
    this.playerS = 0;
    this.speed = tutorial ? TUTORIAL_SPEED : CFG.baseSpeed;
    this.targetX = 0;
    this.inCombat = false;
    this.combatZone = null;
    this.peak = CFG.startArmy;
    this.kills = 0;
    this.bonusCoins = 0;
    this.instaCount = 0;
    this.doubleCount = 0;
    this.instakill = false;
    this.instaT = -1;
    this.ui.setPower(null);
    this.bestHl = null;
    this.trailT = 0;
    this.overT = 0;
    this.summary = null;
    this.tutorialFinished = false;
    this.lastBiome = 0;
    this.startDist = 0;
    this.startArmy = CFG.startArmy;
    const devOn = !tutorial && dev.on;
    const boost = devOn && dev.meters > 0 ? dev.meters : !tutorial && this.data.startOn ? startMeters(this.data.startLevel) : 0;
    if (boost > 0) this.applyHeadStart(boost);
    if (devOn) {
      this.bonusCoins = dev.coins;
      if (dev.infinite) this.instaCount = this.doubleCount = 1;
    }
    this.peakTier = armyTier(this.army.count);
    this.ui.resetHud();
    this.ui.hideScreens();
    this.ui.showHud(true);
    this.ui.setArmy(this.army.count);
    this.ui.showFast(!tutorial && this.data.speedUnlocked);
    this.ui.showBoostHud(!tutorial);
    this.ui.showTutorialTag(tutorial);
    this.ui.syncBoost();
    this.ui.setDist(0);
    this.ui.setCoins(0);
    this.ui.flashBanner(tutorial ? 'TUTORIAL' : boost > 0 ? `HEAD START +${boost}\u00A0m` : 'GO!', boost > 0 ? 1600 : 1000);
    sound.setMode('run');
    sound.setBiome(0);
    sound.setPaused(false);
    sound.start();
  }

  /** Optional 2x run speed (remembered). Ignored in the tutorial. */
  private fast = false;
  private setFast(on: boolean): void {
    if (on !== this.fast) sound.boost(on);
    this.fast = on;
    this.ui.setFast(on);
    try {
      localStorage.setItem('gate-rush-prefs', JSON.stringify({ fast: on }));
    } catch {
      /* storage unavailable */
    }
  }

  private pause(): void {
    if (this.mode !== 'run') return;
    this.mode = 'paused';
    this.dragging = false;
    this.keys.left = this.keys.right = false;
    sound.setPaused(true);
    sound.pause(true);
    this.ui.showPause(this.tutorial ? 'TUTORIAL' : `ARMY ${fmt(this.army.count)}  ·  ${fmtInt(Math.floor(this.playerS))} m`);
  }

  /** Army button: pause and show how strong the next fight is against the army you have. */
  private showIntel(): void {
    if (this.mode !== 'run' || this.tutorial) return;
    this.mode = 'paused';
    this.dragging = false;
    this.keys.left = this.keys.right = false;
    sound.setPaused(true);
    sound.pause(true);
    const A = this.army.count;
    const f = (this.inCombat ? this.combatZone : this.queue.find((q) => q.type === 'combat')) as CombatZone | undefined;
    if (!f) {
      this.ui.showIntel({ title: 'NEXT FIGHT', rows: [['YOUR ARMY', fmt(A)]], note: 'No fight in sight yet. Keep picking the best gates.', tone: '' });
      return;
    }
    const need = Math.ceil(f.critical * Math.max(f.refArmy, A));
    const ratio = A / Math.max(1, need);
    const hp = f.enemies.reduce((a, e) => a + e.hp, 0);
    const word = this.instakill ? '⚡ Instakill is armed: this fight is free.' : ratio >= 1.25 ? 'You are ready for this one.' : ratio >= 1 ? 'Close. Grab the best gates to be safe.' : 'Too weak right now. You need more units.';
    this.ui.showIntel({
      title: f.boss ? 'BOSS FIGHT' : 'NEXT FIGHT',
      rows: [
        ['DISTANCE', `${Math.max(0, Math.round(f.s - this.playerS))} m`],
        ['ENEMIES', `${f.enemies.length}`],
        ['ENEMY POWER', fmt(Math.round(hp))],
        ['ARMY NEEDED', fmt(need)],
      ],
      note: word,
      tone: ratio >= 1.25 ? 'ok' : ratio >= 1 ? 'tight' : 'danger',
    });
  }

  private resume(): void {
    if (this.mode !== 'paused') return;
    this.mode = 'run';
    this.lastT = 0;
    this.ui.hideScreens();
    sound.setPaused(false);
    sound.pause(false);
  }

  /** Jump the fresh run ahead to `meters` with the army (and a track) a good run would have there. */
  private applyHeadStart(meters: number): void {
    const hs = headStartTrack(meters);
    this.source = hs.track;
    this.playerS = meters;
    this.startDist = meters;
    this.startArmy = hs.army;
    this.army.setCount(hs.army);
    this.peak = hs.army;
    this.world.reset(meters);
    this.lastBiome = biomeIndex(meters);
    // the run clock drives the speed curve: advance it as if the distance had been driven
    let t = 0;
    for (let d = 0; d < meters; t += 0.1) d += speedAt(t) * 0.1;
    this.runTime = t;
    this.speed = speedAt(t);
  }

  private toMenu(): void {
    this.clearWorld();
    this.army.reset();
    this.mode = 'menu';
    this.playerS = 0;
    this.world.reset(0);
    this.tutorial = null;
    this.ui.showMenu();
    sound.setMode('menu');
    sound.setPaused(false);
  }

  // ------------------------------------------------------------------ main loop
  private frame(t: number): void {
    const dt = this.lastT ? Math.min(0.05, (t - this.lastT) / 1000) : 1 / 60;
    this.lastT = t;
    this.time += dt;
    if (this.mode === 'paused') {
      // frozen: keep presenting the last frame, advance nothing
      this.world.renderer.render(this.world.scene, this.world.camera);
      requestAnimationFrame((tt) => this.frame(tt));
      return;
    }
    if (this.mode === 'run') this.updateRun(dt);
    else if (this.mode === 'over') this.updateOver(dt);
    else if (this.mode === 'menu') {
      // menu backdrop: slow fly-through that rotates the biomes
      this.speed = 22;
      this.playerS += this.speed * dt;
    }

    const running = (this.mode === 'run' && !this.inCombat) || this.mode === 'menu';
    this.world.update(this.playerS, this.time, dt);
    this.army.mesh.position.set(0, 0, -this.playerS);
    this.army.update(dt, this.time, this.speed, running);
    this.fx.update(dt);
    for (const v of this.viewOrder) {
      v.update(dt, 0, this.time);
      // a gate disappears right after it has been crossed so it never hides the crowd
      const gone = this.mode !== 'menu' && this.playerS > v.set.s + (v.set.split ? CFG.splitZoneLength / 2 + 1 : 2.5);
      v.root.visible = v.revealed && !gone;
    }
    this.updateCamera(dt);
    this.world.renderer.render(this.world.scene, this.world.camera);
    requestAnimationFrame((tt) => this.frame(tt));
  }

  private updateCamera(dt: number): void {
    const cam = this.world.camera;
    const backT = 12 + this.army.halfDepth * 0.9;
    this.camBack += (backT - this.camBack) * Math.min(1, dt * 4);
    const h = 12 + this.army.halfDepth * 0.35;
    const cx = this.army.x * 0.4;
    const sh = this.fx.shakeAmt;
    cam.position.set(cx + (Math.random() - 0.5) * sh * 0.7, h + (Math.random() - 0.5) * sh * 0.5, -this.playerS + this.camBack);
    cam.lookAt(cx * 0.8, 0.5, -this.playerS - 6);
  }

  private updateOver(dt: number): void {
    this.overT += dt;
    if ((this.overT > 0.9 || performance.now() - this.overAt > 1100) && this.summary && this.mode === 'over') {
      const s = this.summary;
      this.summary = null;
      if (this.tutorialFinished) this.ui.showTutorialDone();
      else this.ui.showSummary(s);
    }
  }

  // ------------------------------------------------------------------ run update
  private updateRun(dt: number): void {
    this.runTime += dt;
    if (dev.on && dev.infinite && !this.tutorial) {
      if (this.instaCount === 0 && !this.instakill) this.instaCount = 1;
      this.doubleCount = 1;
    }
    this.speed = this.tutorial ? TUTORIAL_SPEED : speedAt(this.runTime) * (this.fast && this.data.speedUnlocked ? 2 : 1);

    if (this.keys.left) this.targetX -= CFG.keyboardLateralSpeed * dt;
    if (this.keys.right) this.targetX += CFG.keyboardLateralSpeed * dt;
    this.targetX = clamp(this.targetX, -4.4, 4.4);
    const dx = this.targetX - this.army.x;
    const step = clamp(dx * 16 * dt, -CFG.lateralMaxSpeed * dt, CFG.lateralMaxSpeed * dt);
    this.army.x += step;
    this.army.vx = step / Math.max(dt, 1e-4);

    if (!this.inCombat) this.playerS += this.speed * dt;

    this.ensureAhead();
    this.revealPending();
    this.processQueue();
    if (!this.tutorial) {
      const radius = Math.min(3.4, 0.8 + 0.1 * Math.sqrt(this.army.count));
      if (this.heldRows.length) {
        const keep: typeof this.heldRows = [];
        for (const r of this.heldRows) {
          if (this.fightBefore(r.from)) keep.push(r);
          else this.coins.spawnRow(Math.max(r.from, this.playerS + 6), r.to, r.x0, r.x1);
        }
        this.heldRows = keep;
      }
      const got = this.coins.update(dt, this.time, this.playerS, this.army.x, radius, (x, sPos) => {
        this.fx.burst(new THREE.Vector3(x, 1.2, -sPos), 0xffd54f, 7, 3.5);
      });
      if (got > 0) {
        this.bonusCoins += got;
        this.coinStreak = this.time - this.lastPickT < 0.7 ? this.coinStreak + got : got;
        this.lastPickT = this.time;
        sound.coin(this.coinStreak);
      }
    }
    this.updateRoute();
    if (this.inCombat) this.stepCombat(dt);
    else if (this.combatClearT > 0) {
      this.combatClearT -= dt;
      this.combat.step(dt, 0, this.army.x, -this.playerS);
      if (this.combatClearT <= 0) this.combat.clear();
    } else this.combat.idle(dt);
    this.cleanupViews();
    this.emitTrail(dt);
    const bi = biomeIndex(this.playerS);
    if (bi !== this.lastBiome) {
      this.lastBiome = bi;
      if (!this.tutorial) {
        sound.biome();
        sound.setBiome(bi);
      }
    }
    this.updateHud();
  }

  /** A new power of a thousand in the army: ring pulse, burst, sting and a banner (millions and up). */
  private checkTier(): void {
    const t = armyTier(this.army.count);
    if (t <= this.peakTier) return;
    this.peakTier = t;
    if (this.tutorial || t < 2) return;
    this.army.pulse();
    this.ui.flashBanner(`${fmt(Math.pow(10, 3 * t))} ARMY!`, 1300);
    this.fx.burst(new THREE.Vector3(this.army.x, 1.5, -this.playerS), 0xffd23f, 140, 10);
    this.fx.shake(0.45);
    sound.power();
  }

  private updateHud(): void {
    this.checkTier();
    this.ui.setInsta(this.instaCount, this.instakill);
    this.ui.setDouble(this.doubleCount);
    this.ui.setArmy(this.army.count);
    this.ui.setDist(this.playerS);
    this.ui.setCoins(this.coinsEarned());
    if (this.tutorial) {
      const head = this.queue[0];
      this.ui.setHint(head && head.hint && head.s - this.playerS < 80 ? head.hint : null);
    }
  }

  /** How many metres the route bar shows: about five gate sections at the current spacing. */
  private routeWindow(): number {
    return spacingAt(this.playerS) * 5.5;
  }

  /** Left-hand route bar: one timeline that slides towards the player as they run (and stops when they stop). */
  private updateRoute(): void {
    if (this.tutorial) {
      this.ui.setRoute(null);
      return;
    }
    const A = this.army.count;
    const fightItem = this.inCombat ? this.combatZone : (this.queue.find((q) => q.type === 'combat') as CombatZone | undefined) ?? null;
    const W = this.routeWindow();
    const ticks: { id: number; frac: number; kind: 'plain' | 'yellow' | 'gold' | 'skull' | 'boss' }[] = [];
    for (const q of this.queue) {
      if (q.type === 'combat') {
        // the skull appears at the top like any gate and travels down; it stops just in front of the player marker
        const f = (q.s - this.playerS) / W;
        if (f <= 1.02) ticks.push({ id: q.id, frac: Math.max(0.1, f), kind: q.boss ? 'boss' : 'skull' });
        continue;
      }
      if (this.splitCtx && this.splitCtx.resolved && q === this.splitCtx.set) continue;
      const frac = (q.s - this.playerS) / W;
      if (frac > 1.02) continue;
      ticks.push({ id: q.id, frac, kind: q.gates.some((g) => g.bonus) ? 'gold' : q.complex ? 'yellow' : 'plain' });
    }
    if (this.inCombat && fightItem && !ticks.some((t) => t.id === fightItem.id)) ticks.push({ id: fightItem.id, frac: 0.1, kind: fightItem.boss ? 'boss' : 'skull' });
    let fight: { boss: boolean; text: string; tone: string } | null = null;
    if (fightItem) {
      if (this.instakill) fight = { boss: fightItem.boss, text: '⚡', tone: 'ok' };
      else {
        // enemies grow with an army that beats the reference, so the requirement does too
        const need = Math.ceil(fightItem.critical * Math.max(fightItem.refArmy, A));
        const missing = Math.max(0, need - A);
        const ratio = A / Math.max(1, need);
        fight = { boss: fightItem.boss, text: missing > 0 ? fmt(missing) : '✓', tone: ratio >= 1.25 ? 'ok' : ratio >= 1 ? 'tight' : 'danger' };
      }
    }
    this.ui.setRoute({ ticks, fight });
  }

  private coinsEarned(): number {
    if (this.tutorial) return 0;
    return Math.floor((this.playerS - this.startDist) / CFG.metersPerCoin) + this.bonusCoins + Math.floor(this.kills / 2);
  }

  private emitTrail(dt: number): void {
    if (this.trailT <= 0) return;
    this.trailT -= dt;
    if (this.fx.trail.id === 'plain') return;
    this.fx.trailPuff(new THREE.Vector3(this.army.x, 0, -this.playerS + this.army.halfDepth), this.trailColor, 5);
  }

  /** Is there a fight (queued or in progress) between the player and track position `s`? */
  private fightBefore(s: number): boolean {
    if (this.inCombat && this.combatZone && this.combatZone.s < s) return true;
    return this.queue.some((q) => q.type === 'combat' && q.s < s);
  }

  // ------------------------------------------------------------------ spawning
  private ensureAhead(): void {
    // far enough ahead that the route bar can always show the next five gate sections
    const ahead = Math.max(spawnAheadDist(this.speed), this.routeWindow() + 14);
    let guard = 0;
    // ...and always until the next fight is known, so the route bar can show what it needs from the start
    const needFight = () => !this.tutorial && !this.inCombat && !this.queue.some((q) => q.type === 'combat');
    while ((this.source.cursor + 20 < this.playerS + ahead || needFight()) && guard++ < 16) {
      const pending = this.queue.filter((q) => !(this.splitCtx && this.splitCtx.resolved && q === this.splitCtx.set));
      const ref = projectArmy(pending, Math.max(1, this.army.count));
      const item = this.source.next(ref);
      if (!item) break;
      this.queue.push(item);
      if (!this.tutorial) {
        // roughly every 5th gate set: a row of coins leading to its best gate
        const half = CFG.splitZoneLength / 2;
        const gates = item.type === 'gates';
        const zoneFrom = item.s - (gates && item.split ? half : 0) - 1.4;
        const zoneTo = item.s + (gates ? (item.split ? half : 0) + 1.4 : CFG.combatStopGap);
        if (gates) {
          this.setsSinceCoins++;
          if (this.setsSinceCoins >= this.coinEvery) {
            const b = bestResult(item, Math.max(1, ref));
            const tx = item.split ? (b.index === 0 ? -3.2 : 3.2) : (item.gates[b.index].x0 + item.gates[b.index].x1) / 2;
            const from = Math.max(this.coinFrom, this.playerS + 6);
            if (zoneFrom - from >= 5) {
              // never show coins before the enemy ahead is dead: hold the row until the fight is over
              if (this.fightBefore(from)) this.heldRows.push({ from, to: zoneFrom, x0: this.lastGateX, x1: tx });
              else this.coins.spawnRow(from, zoneFrom, this.lastGateX, tx);
              this.setsSinceCoins = 0;
              this.coinEvery = 4 + Math.floor(Math.random() * 3);
            }
          }
          const bb = bestResult(item, Math.max(1, ref));
          this.lastGateX = item.split ? (bb.index === 0 ? -3.2 : 3.2) : (item.gates[bb.index].x0 + item.gates[bb.index].x1) / 2;
        }
        this.coinFrom = zoneTo;
      }
      if (item.type === 'gates') {
        const v = new SetView(item);
        this.world.scene.add(v.root);
        this.views.set(item.id, v);
        this.viewOrder.push(v);
      }
    }
  }

  private revealPending(): void {
    for (const v of this.viewOrder) {
      if (!v.revealed && v.set.s - this.playerS <= v.set.revealLead * this.speed) v.reveal();
    }
  }

  private removeView(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    this.world.scene.remove(v.root);
    v.dispose();
    this.views.delete(id);
    this.viewOrder = this.viewOrder.filter((x) => x !== v);
  }

  private cleanupViews(): void {
    while (this.viewOrder.length && this.viewOrder[0].set.s < this.playerS - 14) this.removeView(this.viewOrder[0].set.id);
  }

  // ------------------------------------------------------------------ crossing
  private processQueue(): void {
    const half = CFG.splitZoneLength / 2;
    let guard = 0;
    while (this.queue.length && guard++ < 8) {
      const it = this.queue[0];
      if (it.type === 'combat') {
        if (!this.placed.has(it.id) && it.s - this.playerS < 85) {
          this.combat.place(it);
          this.placed.add(it.id);
        }
        if (!this.inCombat && this.playerS >= it.s - 0.001) this.startCombat(it);
        break;
      }
      if (it.split) {
        if (!this.splitCtx && this.playerS >= it.s - half) this.enterSplit(it);
        const ctx = this.splitCtx;
        if (ctx && ctx.set === it) {
          if (!ctx.resolved && this.playerS >= it.s) this.resolveSplit(ctx);
          if (this.mode !== 'run') return;
          if (this.playerS >= it.s + half) {
            this.exitSplit(ctx);
            this.queue.shift();
            continue;
          }
        }
        break;
      }
      if (this.playerS >= it.s) {
        this.queue.shift();
        this.resolveSet(it);
        if (this.mode !== 'run') return;
        continue;
      }
      break;
    }
  }

  private resolveSet(set: GateSet): void {
    const view = this.views.get(set.id);
    if (!view) return;
    const A = this.army.count;
    const x = this.army.x;
    let idx = -1;
    for (let i = 0; i < set.gates.length; i++) {
      const r = view.range(i);
      if (r && x >= r.x0 && x <= r.x1) {
        idx = i;
        break;
      }
    }
    const result = idx >= 0 ? evalEffect(set.gates[idx].effect, A) : A;
    if (this.tutorial && set.tutorialRequired && !set.tutorialRequired(A, result, idx)) {
      this.tutorialRewind(set.id);
      return;
    }
    if (!this.tutorial) {
      const bst = bestResult(set, Math.max(1, A)).result;
      if (result < bst * 0.999) this.misses.push({ kind: set.kind, s: Math.round(set.s), A, result, best: bst, idx });
    }
    this.army.setCount(result);
    const eff = idx >= 0 ? set.gates[idx].effect : null;
    const gx = idx >= 0 ? (set.gates[idx].x0 + set.gates[idx].x1) / 2 : x;
    const bonus = idx >= 0 ? set.gates[idx].bonus : undefined;
    if (bonus) this.collectBonus(bonus, gx, set.s);
    else this.gateFeedback(eff, A, result, gx, set.s);

    if (!this.tutorial) {
      this.peak = Math.max(this.peak, result);
      if (set.complex) {
        let best = -1;
        let worst = Infinity;
        for (let i = 0; i < set.gates.length; i++) {
          if (!view.range(i)) continue;
          const r = evalEffect(set.gates[i].effect, A);
          best = Math.max(best, r);
          worst = Math.min(worst, r);
        }
        if (best < 0) best = worst = A;
        if (result >= best) {
          this.bonusCoins += 5;
          const swing = (result - worst) / Math.max(1, A);
          if (eff && swing > 0 && (!this.bestHl || swing >= this.bestHl.gain)) {
            this.bestHl = { gain: swing, text: `${effectText(eff)}  ·  ${fmt(A)} → ${fmt(result)}` };
          }
        }
      }
    }
    if (this.army.count <= 0) this.die();
  }

  /** x2 power-up: doubles the crowd on the spot (also works in the middle of a fight). */
  private useDouble(): void {
    const before = this.army.count;
    const after = clampArmy(before * 2);
    this.army.setCount(after);
    this.peak = Math.max(this.peak, after);
    const at = new THREE.Vector3(this.army.x, 3.2, -this.playerS);
    this.fx.popup(at, '×2!', 'green big');
    this.fx.burst(new THREE.Vector3(this.army.x, 1.5, -this.playerS), 0xff4f9a, 120, 9);
    this.ui.flash('#ff4f9a');
    this.fx.shake(0.5);
    sound.power();
  }

  private collectBonus(b: Bonus, gx: number, setS: number): void {
    const at = new THREE.Vector3(gx, 3.2, -setS);
    if (b.kind === 'coins') {
      this.bonusCoins += b.amount;
      this.fx.popup(at, `+${b.amount} GOLD!`, 'yellow big');
      this.fx.burst(new THREE.Vector3(gx, 1.5, -setS), 0xffc21a, 90, 8);
      for (let i = 0; i < 6; i++) setTimeout(() => sound.coin(i), i * 55);
    } else if (b.kind === 'instakill') {
      // you can hold one: picking up another uses the one you were holding on your next fight
      if (this.instaCount === 0) {
        this.instaCount = 1;
        this.fx.popup(at, '⚡ INSTAKILL SAVED', 'green big');
      } else if (!this.instakill) {
        this.instakill = true;
        this.fx.popup(at, '⚡ USING YOUR LAST ONE', 'green big');
      } else this.fx.popup(at, '⚡ ALREADY HOLDING ONE', 'yellow');
      this.fx.burst(new THREE.Vector3(gx, 1.5, -setS), 0xa56bff, 110, 9);
      sound.power();
    } else if (b.kind === 'double') {
      if (this.doubleCount === 0) {
        this.doubleCount = 1;
        this.fx.popup(at, '×2 SAVED', 'green big');
      } else {
        this.fx.popup(at, '×2 USING YOUR LAST ONE', 'green big');
        this.useDouble();
      }
      this.fx.burst(new THREE.Vector3(gx, 1.5, -setS), 0xff4f9a, 110, 9);
      sound.power();
    }
    this.fx.shake(0.4);
    this.trailT = 1.2;
    this.trailColor = b.kind === 'coins' ? 0xffc21a : b.kind === 'instakill' ? 0xa56bff : b.kind === 'double' ? 0xff4f9a : 0x37e6ff;
  }

  // ------------------------------------------------------------------ split & merge (Type C)
  private enterSplit(set: GateSet): void {
    const s = this.army.enterSplit();
    this.splitCtx = { set, L: s.left, R: s.right, resolved: false, failed: false };
  }

  private resolveSplit(ctx: SplitCtx): void {
    ctx.resolved = true;
    const set = ctx.set;
    const A = ctx.L + ctx.R;
    const [gl, gr] = set.gates;
    const l = evalEffect(gl.effect, ctx.L);
    const r = evalEffect(gr.effect, ctx.R);
    const total = clampArmy(l + r);
    if (this.tutorial && set.tutorialRequired && !set.tutorialRequired(A, total, 0)) {
      ctx.failed = true;
      this.army.setSplitCounts(ctx.L, ctx.R);
      this.ui.flashBanner('TRY AGAIN!', 1400);
      return;
    }
    this.army.setSplitCounts(l, r);
    if (ctx.L > 0) this.gateFeedback(gl.effect, ctx.L, l, -2.6, set.s);
    if (ctx.R > 0) this.gateFeedback(gr.effect, ctx.R, r, 2.6, set.s);
    if (!this.tutorial) {
      this.peak = Math.max(this.peak, total);
      const best = bestSplit(gl.effect, gr.effect, A).total;
      if (total >= best * 0.97) {
        this.bonusCoins += 5;
        const worst = Math.min(evalEffect(gl.effect, A), evalEffect(gr.effect, A));
        const swing = (total - worst) / Math.max(1, A);
        if (swing > 0 && (!this.bestHl || swing >= this.bestHl.gain)) {
          this.bestHl = { gain: swing, text: `Split lanes  ·  ${fmt(A)} → ${fmt(total)}` };
        }
      }
    }
    if (this.army.count <= 0) this.die();
  }

  private exitSplit(ctx: SplitCtx): void {
    this.army.exitSplit();
    this.splitCtx = null;
    if (ctx.failed) this.tutorialRewind(ctx.set.id);
  }

  // ------------------------------------------------------------------ tutorial retry
  private tutorialRewind(keepId: number): void {
    if (!this.tutorial) return;
    const stepIdx = this.tutorial.stepIndex(keepId);
    for (const it of this.queue) if (it.id !== keepId && it.type === 'gates') this.removeView(it.id);
    this.queue = this.queue.filter((it) => it.id === keepId);
    this.tutorial.rewind(stepIdx, this.playerS);
    this.ui.flashBanner('TRY AGAIN!', 1400);
  }

  // ------------------------------------------------------------------ feedback
  private gateFeedback(eff: Effect | null, A: number, result: number, gx: number, setS: number): void {
    const delta = result - A;
    let text: string;
    let cls: string;
    if (!eff) {
      text = 'MISSED';
      cls = 'small yellow';
    } else if (eff.t === 'op') {
      const o = eff.op;
      cls = o.kind === 'add' || o.kind === 'mul' ? 'green' : 'red';
      if (o.kind === 'add') text = `+${fmt(delta > 0 ? delta : o.n)}!`;
      else if (o.kind === 'mul') text = `×${fmt(o.n)}!`;
      else if (o.kind === 'sub') text = `−${fmt(Math.min(A, o.n))}`;
      else text = `÷${fmt(o.n)}`;
    } else {
      text = delta >= 0 ? `+${fmt(delta)}!` : `−${fmt(-delta)}`;
      cls = delta >= 0 ? 'yellow' : 'red';
    }
    const ratio = A > 0 ? result / A : 1;
    if (ratio >= 3) cls += ' big';
    this.fx.popup(new THREE.Vector3(gx, 3.2, -setS), text, cls);

    const color = !eff ? 0xffffff : delta < 0 ? TONE_COLOR.red : TONE_COLOR[effectTone(eff)];
    const gain = delta > 0;
    const n = gain ? clamp(12 + Math.log2(Math.max(1, ratio)) * 26, 12, 150) : 16;
    this.fx.burst(new THREE.Vector3(gx * 0.6 + this.army.x * 0.4, 1.2, -setS), color, n, gain ? 7 : 5);
    if (ratio >= 3) this.fx.shake(0.65);
    else if (ratio >= 1.8) this.fx.shake(0.3);
    else if (delta < 0 && result < A * 0.6) this.fx.shake(0.3);
    this.trailT = 1.2;
    this.trailColor = color;
    if (eff) {
      if (delta < 0) sound.bad();
      else sound.good(ratio);
    }
  }

  // ------------------------------------------------------------------ combat
  private startCombat(zone: CombatZone): void {
    this.inCombat = true;
    this.combatZone = zone;
    this.playerS = zone.s;
    if (!this.tutorial && zone.refArmy > 0 && this.army.count > zone.refArmy) this.combat.rescale(this.army.count / zone.refArmy);
    this.combat.begin();
    if (this.instakill) {
      this.instakill = false;
      this.instaT = 0.55;
      this.ui.flashBanner('⚡ INSTAKILL', 700);
    }
    this.hurtAcc = this.lossShown = 0;
    this.hurtT = this.lossT = 0;
    this.ui.flashBanner(zone.boss ? 'BOSS FIGHT!' : zone.fightNo === 0 ? 'ENEMIES!' : 'TITAN AHEAD!', 1100);
    if (zone.boss) this.fx.shake(0.7);
    sound.setMode('combat');
    sound.fight(zone.boss);
    this.shotT = 0;
  }

  private stepCombat(dt: number): void {
    let extra = { killed: 0, titans: 0, boss: 0 };
    const charging = this.instaT >= 0;
    if (charging) {
      this.instaT -= dt;
      if (this.instaT < 0) {
        extra = this.combat.annihilate();
        this.ui.flash('#a56bff');
        this.fx.shake(1.1);
        this.fx.burst(new THREE.Vector3(this.army.x, 2, -this.playerS - 10), 0xa56bff, 220, 12);
        this.fx.burst(new THREE.Vector3(this.army.x, 2, -this.playerS - 10), 0xffffff, 120, 14);
        sound.blast();
      }
    }
    const r = this.combat.step(dt, this.army.count, this.army.x, -this.playerS);
    if (charging) r.armyLoss = 0; // the army is untouchable while the power-up charges
    r.killedNow += extra.killed;
    r.titansKilled += extra.titans;
    r.bossKilled += extra.boss;
    this.kills = this.combat.kills;
    const zone = this.combatZone;
    this.shotT -= dt;
    if (this.shotT <= 0 && this.army.count > 0) {
      sound.shot();
      this.shotT = 0.1;
    }
    if (r.killedNow > 0) sound.kill(r.killedNow);
    if (r.titansKilled > 0) sound.titan();
    if (r.bossKilled > 0) sound.boss();

    // the enemy shoots back: friendly units die during the fight
    if (r.armyLoss > 0) {
      const after = this.army.count - r.armyLoss;
      this.army.setCount(after);
      this.hurtAcc += r.armyLoss;
      this.lossShown += r.armyLoss;
      if (after <= 0) {
        this.army.setCount(0);
        this.combat.active = false;
        this.ui.setCombat(null);
        this.inCombat = false;
        this.queue.shift();
        this.die();
        return;
      }
    }
    this.hurtT -= dt;
    if (this.hurtAcc > 0 && this.hurtT <= 0) {
      this.fx.burst(new THREE.Vector3(this.army.x + (Math.random() - 0.5) * 4, 1, -this.playerS + (Math.random() - 0.5) * 3), 0xff3d4d, Math.min(24, 4 + this.hurtAcc * 2), 5);
      this.fx.shake(zone && zone.boss ? 0.28 : 0.15);
      sound.hurt();
      this.hurtAcc = 0;
      this.hurtT = 0.16;
    }
    this.lossT -= dt;
    if (this.lossShown > 0 && this.lossT <= 0) {
      this.fx.popup(new THREE.Vector3(this.army.x, 3, -this.playerS + 1), `\u2212${fmt(this.lossShown)}`, 'red small');
      this.lossShown = 0;
      this.lossT = 0.7;
    }

    if (r.titansKilled > 0) {
      this.bonusCoins += 10 * r.titansKilled;
      this.fx.popup(new THREE.Vector3(this.army.x, 3.5, -this.playerS - 10), 'TITAN DOWN!', 'yellow');
      this.fx.shake(0.5);
    }
    if (r.bossKilled > 0) {
      this.bonusCoins += 50 * r.bossKilled;
      this.fx.popup(new THREE.Vector3(this.army.x, 3.5, -this.playerS - 12), 'BOSS DOWN!', 'green big');
      this.fx.shake(1.0);
      this.fx.burst(new THREE.Vector3(this.army.x, 2, -this.playerS - 14), 0xffe27a, 150, 10);
    }

    const label = zone && zone.boss ? 'BOSS FIGHT' : 'ENEMIES';
    this.ui.setCombat({
      boss: !!(zone && zone.boss),
      text: `${label}  ${fmt(r.remainingHp)} HP   ${r.timeLeft.toFixed(1)}s`,
      frac: r.remainingHp / Math.max(1, this.combat.totalHp),
    });
    if (r.done) this.endCombat(r.remainingHp);
  }

  private endCombat(remaining: number): void {
    this.combat.active = false;
    this.ui.setCombat(null);
    sound.setMode('run');
    const zone = this.combatZone;
    const A = this.army.count;
    const at = new THREE.Vector3(this.army.x, 3.2, -this.playerS - 6);
    if (remaining > 0) {
      const after = Math.max(0, A - remaining);
      this.army.setCount(after);
      this.fx.popup(at, `−${fmt(Math.min(A, remaining))}`, 'red big');
      this.fx.shake(0.8);
      if (after <= 0) {
        this.inCombat = false;
        this.queue.shift();
        this.die();
        return;
      }
    } else {
      this.fx.popup(at, 'CLEAR!', 'green big');
      this.fx.burst(new THREE.Vector3(this.army.x, 1.5, -this.playerS - 10), 0xffe27a, 80, 8);
    }
    if (zone && !this.tutorial) this.ui.routeBoom(zone.id, zone.boss);
    this.inCombat = false;
    this.combatZone = null;
    this.combatClearT = 0.9;
    this.queue.shift();
    if (this.tutorial && zone && zone.id === this.tutorial.lastId) this.finishTutorial();
  }

  // ------------------------------------------------------------------ end states
  private finishTutorial(): void {
    this.tutorialFinished = true;
    this.data.tutorialDone = true;
    save(this.data);
    this.mode = 'over';
    this.overT = 0;
    this.overAt = performance.now();
    this.summary = { title: '', distance: 0, peak: 0, kills: 0, score: 0, coins: 0, armyBonus: 0, start: 0, highlight: null, newBest: false };
    this.ui.setHint(null);
  }

  private die(): void {
    if (this.mode !== 'run') return;
    if (this.tutorial) {
      // the tutorial cannot be lost: start over from the top
      this.startRun(true);
      this.ui.flashBanner('TRY AGAIN!', 1200);
      return;
    }
    this.mode = 'over';
    sound.setMode('menu');
    sound.die();
    this.overT = 0;
    this.overAt = performance.now();
    this.inCombat = false;
    this.army.setCount(0);
    this.fx.burst(new THREE.Vector3(this.army.x, 1, -this.playerS), 0xff3d4d, 160, 9);
    this.fx.shake(1.0);
    // a head start does not count towards score or coins: only what is run, and the army grown beyond the gift
    const distance = Math.floor(this.playerS - this.startDist);
    const score = distance * CFG.scoreDistMul + Math.max(0, this.peak - this.startArmy) * CFG.scorePeakMul + this.kills * CFG.scoreKillMul;
    const armyBonus = this.tutorial ? 0 : Math.min(1500, Math.floor(this.peak / 1_000_000)); // 1 coin per million in the largest army (capped so the animation stays sane)
    const coins = this.coinsEarned() + armyBonus;
    this.data.coins += coins;
    const newBest = addScore(this.data, { score, distance, peak: this.peak, kills: this.kills, date: Date.now() });
    save(this.data);
    this.summary = {
      title: 'RUN OVER',
      distance,
      peak: this.peak,
      kills: this.kills,
      score,
      coins,
      armyBonus,
      start: this.startDist,
      highlight: this.bestHl ? this.bestHl.text : null,
      newBest,
    };
    this.ui.setCombat(null);
    this.ui.setHint(null);
    this.ui.setArmy(0);
  }

  // hooks used by the automated smoke test
  get debug() {
    const head = this.queue[0];
    return {
      mode: this.mode,
      playerS: this.playerS,
      army: this.army.count,
      queue: this.queue.length,
      views: this.views.size,
      inCombat: this.inCombat,
      zone: this.combatZone ? { no: this.combatZone.fightNo, ref: this.combatZone.refArmy, crit: this.combatZone.critical, boss: this.combatZone.boss, loss: this.combatZone.lossFrac } : null,
      head: head ? { type: head.type, kind: head.type === 'gates' ? head.kind : 'combat', s: head.s } : null,
    };
  }
  /** Test hook: advance the simulation without rendering. */
  fastStep(dt: number): void {
    this.time += dt;
    if (this.mode === 'run') this.updateRun(dt);
    else if (this.mode === 'over') this.updateOver(dt);
    const running = this.mode === 'run' && !this.inCombat;
    this.army.mesh.position.set(0, 0, -this.playerS);
    this.army.update(dt, this.time, this.speed, running);
    this.fx.update(dt);
    for (const v of this.viewOrder) {
      v.update(dt, 0, this.time);
      v.root.visible = v.revealed;
    }
  }
  steerTo(x: number): void {
    this.targetX = clamp(x, -4.4, 4.4);
  }
  /** Test hook: jump the endless run ahead so late-game content can be inspected. */
  warp(meters: number, army: number, fights = 0): void {
    this.clearWorld();
    this.playerS = meters;
    this.world.reset(meters);
    this.lastBiome = biomeIndex(meters);
    (this.source as Track).cursor = meters;
    (this.source as Track).fights = fights;
    this.army.setCount(army);
    this.peak = army;
  }
  /** x position of the best (or worst) gate of the head set (bot helper). */
  bestX(worst = false): number | null {
    const it = this.queue[0];
    if (!it || it.type !== 'gates') return null;
    if (worst && !it.split) {
      let wi = 0;
      it.gates.forEach((g, i) => {
        if (evalEffect(g.effect, this.army.count) < evalEffect(it.gates[wi].effect, this.army.count)) wi = i;
      });
      return (it.gates[wi].x0 + it.gates[wi].x1) / 2;
    }
    const b = bestResult(it, Math.max(1, this.army.count));
    if (it.split) return b.index === 0 ? -3.2 : 3.2;
    const g = it.gates[b.index];
    return (g.x0 + g.x1) / 2;
  }

}
