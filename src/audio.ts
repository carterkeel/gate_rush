/**
 * Procedural sound: every effect and the music loop are synthesised with the Web Audio API, so the game ships
 * no audio files. Audio can only start after a user gesture; `unlock()` is called from the first tap or key.
 */
type Mode = 'menu' | 'run' | 'combat';

const KEY = 'gate-rush-audio';
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// Am - F - C - G, two bars each at 16th-note resolution
const PROG = [
  { root: 45, chord: [57, 60, 64] },
  { root: 41, chord: [53, 57, 60] },
  { root: 48, chord: [55, 60, 64] },
  { root: 43, chord: [55, 59, 62] },
];
const ARP = [0, 1, 2, 1, 0, 1, 2, 1, 2, 1, 0, 1, 2, 1, 2, 1];

class Sound {
  sfxOn = true;
  musicOn = true;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private mode: Mode = 'menu';
  private paused = false;
  private timer = 0;
  private nextT = 0;
  private step = 0;
  private transpose = 0;
  private last: Record<string, number> = {};

  constructor() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (typeof v.sfx === 'boolean') this.sfxOn = v.sfx;
      if (typeof v.music === 'boolean') this.musicOn = v.music;
    } catch {
      /* storage unavailable: defaults */
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ sfx: this.sfxOn, music: this.musicOn }));
    } catch {
      /* ignore */
    }
  }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = new AC();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(comp);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.sfxOn ? 1 : 0;
      this.sfxBus.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0;
      this.musicBus.connect(this.master);
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.nextT = ctx.currentTime + 0.1;
      this.timer = window.setInterval(() => this.schedule(), 40);
      this.applyMusicGain();
    } catch {
      this.ctx = null;
    }
  }

  setSfx(on: boolean): void {
    this.sfxOn = on;
    if (this.sfxBus && this.ctx) this.sfxBus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
    this.persist();
  }
  setMusic(on: boolean): void {
    this.musicOn = on;
    this.applyMusicGain();
    this.persist();
  }
  setMode(m: Mode): void {
    this.mode = m;
    this.applyMusicGain();
  }
  setPaused(p: boolean): void {
    this.paused = p;
    this.applyMusicGain();
  }
  /** Each biome plays the loop in a different key. */
  setBiome(i: number): void {
    this.transpose = [0, 3, -2, 5][i % 4];
  }

  private applyMusicGain(): void {
    if (!this.ctx || !this.musicBus) return;
    const base = this.mode === 'menu' ? 0.16 : this.mode === 'combat' ? 0.3 : 0.24;
    const g = !this.musicOn ? 0 : this.paused ? base * 0.25 : base;
    this.musicBus.gain.setTargetAtTime(g, this.ctx.currentTime, 0.15);
  }

  // ------------------------------------------------------------------ primitives
  private ok(name?: string, gap = 0): boolean {
    if (!this.ctx || !this.sfxOn) return false;
    if (name) {
      const t = this.ctx.currentTime;
      if (t - (this.last[name] ?? -9) < gap) return false;
      this.last[name] = t;
    }
    return true;
  }

  private tone(f: number, dur: number, type: OscillatorType, vol: number, to = 0, delay = 0, bus?: GainNode): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, q = 1, delay = 0, type: BiquadFilterType = 'bandpass', bus?: GainNode, at?: number): void {
    const ctx = this.ctx!;
    const t = at ?? ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(bus ?? this.sfxBus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------------ effects
  click(): void {
    if (!this.ok('click', 0.03)) return;
    this.tone(660, 0.07, 'square', 0.1, 990);
  }
  start(): void {
    if (!this.ok()) return;
    [392, 523, 659].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.16, 0, i * 0.08));
  }
  good(ratio: number): void {
    if (!this.ok('gate', 0.05)) return;
    const n = ratio >= 3 ? 5 : ratio >= 1.8 ? 4 : 3;
    const base = ratio >= 3 ? 523 : 440;
    for (let i = 0; i < n; i++) this.tone(base * Math.pow(2, [0, 4, 7, 12, 16][i] / 12), 0.2, 'triangle', 0.18, 0, i * 0.055);
    if (ratio >= 3) this.noise(0.4, 0.12, 6000, 0.7, 0.1, 'highpass');
  }
  bad(): void {
    if (!this.ok('gate', 0.05)) return;
    this.tone(220, 0.32, 'sawtooth', 0.16, 70);
    this.tone(165, 0.32, 'square', 0.08, 55);
  }
  fight(boss: boolean): void {
    if (!this.ok()) return;
    if (boss) {
      this.tone(98, 0.9, 'sawtooth', 0.22, 49);
      this.tone(104, 0.9, 'sawtooth', 0.18, 52);
      this.noise(0.7, 0.2, 200, 0.6);
    } else {
      this.tone(165, 0.4, 'sawtooth', 0.16, 82);
      this.tone(220, 0.25, 'square', 0.08, 110, 0.12);
    }
  }
  shot(): void {
    if (!this.ok('shot', 0.08)) return;
    this.noise(0.05, 0.05, 2600 + Math.random() * 1400, 2);
  }
  kill(n: number): void {
    if (!this.ok('kill', 0.07)) return;
    this.tone(300 + Math.random() * 120, 0.09, 'square', 0.06, 120);
    if (n > 3) this.noise(0.12, 0.08, 900, 1);
  }
  hurt(): void {
    if (!this.ok('hurt', 0.22)) return;
    this.tone(130, 0.14, 'sawtooth', 0.09, 60);
  }
  titan(): void {
    if (!this.ok()) return;
    this.tone(110, 0.55, 'sawtooth', 0.22, 38);
    this.noise(0.45, 0.2, 300, 0.7);
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.12, 0, 0.25 + i * 0.07));
  }
  boss(): void {
    if (!this.ok()) return;
    this.tone(90, 1.1, 'sawtooth', 0.26, 30);
    this.noise(0.9, 0.28, 250, 0.6);
    [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.16, 0, 0.3 + i * 0.09));
  }
  die(): void {
    if (!this.ok()) return;
    [330, 277, 220, 165].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.15, f * 0.9, i * 0.16));
    this.noise(0.8, 0.12, 400, 0.6, 0.1);
  }
  biome(): void {
    if (!this.ok()) return;
    [392, 494, 587].forEach((f, i) => this.tone(f, 0.25, 'sine', 0.12, 0, i * 0.1));
  }
  pause(on: boolean): void {
    if (!this.ok()) return;
    this.tone(on ? 440 : 660, 0.1, 'triangle', 0.12, on ? 330 : 880);
  }

  // ------------------------------------------------------------------ music
  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicOn) {
      if (ctx) this.nextT = Math.max(this.nextT, ctx.currentTime);
      return;
    }
    const bpm = this.mode === 'combat' ? 140 : 120;
    const sixteenth = 60 / bpm / 4;
    while (this.nextT < ctx.currentTime + 0.2) {
      this.playStep(this.step, this.nextT);
      this.nextT += sixteenth;
      this.step = (this.step + 1) % 128;
    }
  }

  private playStep(step: number, t: number): void {
    const bar = Math.floor(step / 16) % 8;
    const p = PROG[Math.floor(bar / 2)];
    const s = step % 16;
    const tr = this.transpose;
    const mb = this.musicBus;
    const dt = Math.max(0, t - this.ctx!.currentTime);
    const note = (f: number, dur: number, type: OscillatorType, vol: number) => this.tone(f, dur, type, vol, 0, dt, mb);

    // bass on the off-beats, kick on the beat
    if (this.mode !== 'menu' && s % 4 === 0) note(55, 0.12, 'sine', 0.9);
    if (this.mode !== 'menu' && s % 4 === 2) note(midi(p.root + tr - 12), 0.14, 'triangle', 0.6);
    // arpeggio
    if (s % 2 === 0 || this.mode === 'combat') note(midi(p.chord[ARP[s]] + tr), 0.12, this.mode === 'combat' ? 'sawtooth' : 'square', 0.14);
    // hats and snare
    if (this.mode !== 'menu' && s % 2 === 0) this.noise(0.03, 0.12, 8000, 1, 0, 'highpass', mb, t);
    if (this.mode === 'combat' && (s === 4 || s === 12)) this.noise(0.12, 0.3, 1800, 0.8, 0, 'bandpass', mb, t);
  }
}

export const sound = new Sound();
