import * as THREE from 'three';
import { CFG, speedAt, spawnAheadDist } from './config';
import { World } from './world';
import { BIOMES, biomeIndex } from './biomes';
import { Army } from './army';
import { Fx } from './fx';
import { CombatSim } from './enemies';
import { SetView, TONE_COLOR } from './gateView';
import { UI } from './ui';
import type { RunSummary } from './ui';
import { Track, projectArmy, bestResult } from './track';
import { TutorialSource } from './tutorial';
import { sound } from './audio';
import { evalEffect, effectText, effectTone, fmt, bestSplit } from './logic';
import type { Effect } from './logic';
import { SKINS, TRAILS, addScore, load, save } from './storage';
import type { SaveData } from './storage';
import type { CombatZone, GateSet, ItemSource, TrackItem } from './types';

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
  private bestHl: { gain: number; text: string } | null = null;
  private trailT = 0;
  private trailColor = 0xffffff;
  private overT = 0;
  private overAt = 0;
  private summary: RunSummary | null = null;
  private tutorialFinished = false;

  private camBack = 12;
  private lastBiome = 0;
  private lastT = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.world = new World(canvas);
    this.army = new Army(this.world.scene);
    this.fx = new Fx(this.world.scene, this.world.camera, document.getElementById('popups')!);
    this.combat = new CombatSim(this.world.scene);
    this.ui = new UI(
      () => this.data,
      () => save(this.data),
    );
    this.applyCosmetics();
    this.bindUi();
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    document.addEventListener('visibilitychange', () => {
      this.lastT = 0;
      if (document.hidden) this.pause();
    });
    window.addEventListener('blur', () => this.pause());
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
    this.ui.onTutorial = () => this.startRun(true);
    this.ui.onAgain = () => this.startRun(false);
    this.ui.onMenu = () => this.toMenu();
    this.ui.onPause = () => this.pause();
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
    this.bestHl = null;
    this.trailT = 0;
    this.overT = 0;
    this.summary = null;
    this.tutorialFinished = false;
    this.lastBiome = 0;
    this.ui.resetHud();
    this.ui.hideScreens();
    this.ui.showHud(true);
    this.ui.setArmy(this.army.count);
    this.ui.setDist(0);
    this.ui.setCoins(0);
    this.ui.flashBanner(tutorial ? 'TUTORIAL' : 'GO!', 1000);
    sound.setMode('run');
    sound.setBiome(0);
    sound.setPaused(false);
    sound.start();
  }

  private pause(): void {
    if (this.mode !== 'run') return;
    this.mode = 'paused';
    this.dragging = false;
    this.keys.left = this.keys.right = false;
    sound.setPaused(true);
    sound.pause(true);
    this.ui.showPause(this.tutorial ? 'Tutorial' : `${Math.floor(this.playerS)} m  ·  army ${this.army.count}`);
  }

  private resume(): void {
    if (this.mode !== 'paused') return;
    this.mode = 'run';
    this.lastT = 0;
    this.ui.hideScreens();
    sound.setPaused(false);
    sound.pause(false);
  }

  private toMenu(): void {
    this.clearWorld();
    this.army.reset();
    this.mode = 'menu';
    this.playerS = 0;
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

    const running = this.mode === 'run' && !this.inCombat;
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
    this.speed = this.tutorial ? TUTORIAL_SPEED : speedAt(this.runTime);

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
        this.ui.flashBanner(BIOMES[bi].name, 1800);
        sound.biome();
        sound.setBiome(bi);
      }
    }
    this.updateHud();
  }

  private updateHud(): void {
    this.ui.setArmy(this.army.count);
    this.ui.setDist(this.playerS);
    this.ui.setCoins(this.coinsEarned());
    if (this.tutorial) {
      const head = this.queue[0];
      this.ui.setHint(head && head.hint && head.s - this.playerS < 80 ? head.hint : null);
    }
  }

  private coinsEarned(): number {
    if (this.tutorial) return 0;
    return Math.floor(this.playerS / CFG.metersPerCoin) + this.bonusCoins + Math.floor(this.kills / 2);
  }

  private emitTrail(dt: number): void {
    if (this.trailT <= 0) return;
    this.trailT -= dt;
    if (this.fx.trail.id === 'plain') return;
    this.fx.trailPuff(new THREE.Vector3(this.army.x, 0, -this.playerS + this.army.halfDepth), this.trailColor, 5);
  }

  // ------------------------------------------------------------------ spawning
  private ensureAhead(): void {
    const ahead = spawnAheadDist(this.speed);
    let guard = 0;
    while (this.source.cursor + 20 < this.playerS + ahead && guard++ < 12) {
      const pending = this.queue.filter((q) => !(this.splitCtx && this.splitCtx.resolved && q === this.splitCtx.set));
      const ref = projectArmy(pending, Math.max(1, this.army.count));
      const item = this.source.next(ref);
      if (!item) break;
      this.queue.push(item);
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
    this.army.setCount(result);
    const eff = idx >= 0 ? set.gates[idx].effect : null;
    const gx = idx >= 0 ? (set.gates[idx].x0 + set.gates[idx].x1) / 2 : x;
    this.gateFeedback(eff, A, result, gx, set.s);

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
            this.bestHl = { gain: swing, text: `${effectText(eff)} turned ${fmt(A)} into ${fmt(result)}` };
          }
        }
      }
    }
    if (this.army.count <= 0) this.die();
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
    const total = Math.min(CFG.armyCap, l + r);
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
          this.bestHl = { gain: swing, text: `Split lanes (${fmt(ctx.L)} left / ${fmt(ctx.R)} right) turned ${fmt(A)} into ${fmt(total)}` };
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
    this.hurtAcc = this.lossShown = 0;
    this.hurtT = this.lossT = 0;
    this.ui.flashBanner(zone.boss ? 'BOSS FIGHT!' : zone.fightNo === 0 ? 'ENEMIES!' : 'TITAN AHEAD!', 1100);
    if (zone.boss) this.fx.shake(0.7);
    sound.setMode('combat');
    sound.fight(zone.boss);
    this.shotT = 0;
  }

  private stepCombat(dt: number): void {
    const r = this.combat.step(dt, this.army.count, this.army.x, -this.playerS);
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
    this.summary = { title: '', distance: 0, peak: 0, kills: 0, score: 0, coins: 0, highlight: null, newBest: false };
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
    const distance = Math.floor(this.playerS);
    const score = distance * CFG.scoreDistMul + this.peak * CFG.scorePeakMul + this.kills * CFG.scoreKillMul;
    const coins = this.coinsEarned();
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
