<p align="center"><img src="assets/social-preview.png" alt="Gate Rush" width="720"></p>

# Gate Rush

An infinite gate-math runner / crowd shooter. Slide your army left and right through +, −, ×, ÷ gates,
split lanes, time-pressure gates, and titan and boss fights. TypeScript + three.js, bundled with esbuild.

**Play it:** https://carterkeel.github.io/gate_rush/

## Screenshots

<p align="center">
  <img src="assets/screens/menu.jpg" width="19%" alt="Main menu">
  <img src="assets/screens/neo.jpg" width="19%" alt="Neo biome">
  <img src="assets/screens/forest.jpg" width="19%" alt="Forest biome">
  <img src="assets/screens/lava.jpg" width="19%" alt="Lava biome">
  <img src="assets/screens/boss.jpg" width="19%" alt="Boss approaching">
</p>

## Controls
Drag or swipe, or use A / D or the arrow keys. The 2× button (bottom left) doubles your run speed. Pause with the ❚❚ button, Esc or P (it also pauses when you switch tabs). The first "Play" runs a short tutorial; "How to play" replays it.

## Develop
```
npm install
npm run build       # bundles to dist/index.html and docs/index.html (the GitHub Pages site)
npm run typecheck
npm run sim         # fairness simulation of the gate and fight generators
```

## Coins
Coins are earned by distance, by picking up the spinning coins laid between gate sets, and by playing the best gate. They buy skins, trails and upgrades.

## Upgrades
Bought with coins on the Upgrades screen: **Double Speed** (1000 coins) unlocks the 2× button, and **Head Start** (15 levels, 100 m up to 800 m, each level costs about 30 % more) lets a run begin further along with an army sized for that distance. A head start does not add to score or coins; only what you run and the army you grow beyond the gift count.

## Sound
All sound effects and the music loop are synthesised with the Web Audio API (no audio files). Music and sound-effect volume have separate sliders under Settings (on the main menu and the pause screen); the choice is stored under `gate-rush-audio`.

## Models
Characters (Footman, Orc Warband and the red orc enemies) and weapons are Kenney's CC0 "Mini Dungeon" models, baked into static vertex-coloured geometry (`tools/bake.py`, `tools/build_models.py`, output in `src/modelData.ts`). See `THIRD_PARTY_NOTICES.md`.

## Save data
Coins, skins, trails, high scores and the tutorial flag are stored in the browser's `localStorage`
under the key `gate-rush-save-v1`. They stay on that device and browser; clearing site data resets them.

## Notes
`docs/index.html` is the built game. Rebuild and commit it after source changes.

## License
Public domain (The Unlicense, see `LICENSE`): use it however you like, no credit needed. The bundled three.js keeps its own MIT notice in `THIRD_PARTY_NOTICES.md`.
