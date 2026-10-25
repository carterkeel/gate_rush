import { Game } from './game';

const canvas = document.getElementById('c') as HTMLCanvasElement;
try {
  const game = new Game(canvas);
  (window as unknown as { __game: Game }).__game = game;
} catch (err) {
  console.error(err);
  const fb = document.getElementById('fallback');
  if (fb) fb.style.display = 'flex';
}
