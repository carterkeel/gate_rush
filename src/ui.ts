import { sound } from './audio';
import { fmt } from './logic';
import { SKINS, TRAILS } from './storage';
import type { SaveData } from './storage';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export interface RunSummary {
  title: string;
  distance: number;
  peak: number;
  kills: number;
  score: number;
  coins: number;
  highlight: string | null;
  newBest: boolean;
}

export class UI {
  onPlay = () => {};
  onTutorial = () => {};
  onAgain = () => {};
  onMenu = () => {};
  onPause = () => {};
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
    $('bScores').onclick = () => this.showScores();
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
    $('bResume').onclick = () => this.onResume();
    $('bRestart').onclick = () => this.onRestart();
    $('bQuit').onclick = () => this.onMenu();
  }

  private screens(on: string | null): void {
    for (const id of ['menu', 'skins', 'scores', 'summary', 'pause', 'tutDone', 'settings']) $(id).classList.toggle('on', id === on);
  }

  showPause(info: string): void {
    $('pauseInfo').textContent = info;
    this.screens('pause');
  }

  showHud(on: boolean): void {
    $('hud').classList.toggle('on', on);
    if (!on) {
      this.setCombat(null);
      this.setHint(null);
      this.banner.classList.remove('on');
    }
  }

  showMenu(): void {
    this.showHud(false);
    $('menuCoins').textContent = `Coins: ${this.save().coins}`;
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
  setCombat(state: { text: string; frac: number; boss?: boolean } | null): void {
    this.combat.classList.toggle('on', !!state);
    if (state) {
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
    const rows: Array<[string, string, boolean?]> = [
      ['DISTANCE', `${Math.floor(s.distance)} m`],
      ['PEAK ARMY', fmt(s.peak)],
      ['ENEMIES KILLED', String(s.kills)],
      ['SCORE', fmt(s.score), true],
      ['COINS EARNED', `+${s.coins}`],
    ];
    $('sumGrid').innerHTML = rows.map(([k, v, big]) => `<div>${k}</div><div class="${big ? 'big' : ''}">${v}</div>`).join('');
    const hl = $('sumHl');
    hl.style.display = s.highlight ? 'block' : 'none';
    if (s.highlight) hl.textContent = '★ Best complex choice: ' + s.highlight;
    this.screens('summary');
  }

  showTutorialDone(): void {
    this.showHud(false);
    this.screens('tutDone');
  }

  // ------------------------------------------------------------- skins
  showSkins(): void {
    const d = this.save();
    $('skinCoins').textContent = `Coins: ${d.coins}  •  cosmetics only, never pay-to-win`;
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
          const label = eq === it.id ? 'EQUIPPED' : has ? 'EQUIP' : `BUY • ${it.cost}`;
          const dis = eq === it.id || (!has && d.coins < it.cost) ? 'disabled' : '';
          return `<div class="card ${eq === it.id ? 'eq' : ''}"><div class="sw" style="background:${sw}"></div>${it.name}<small>${has ? 'Owned' : it.cost + ' coins'}</small><button data-k="${kind}" data-id="${it.id}" ${dis}>${label}</button></div>`;
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
