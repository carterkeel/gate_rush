/** Flat 2D skull icon (own design, public domain) in the game's chunky dark-outline style. */
export function skullSvg(boss: boolean): string {
  const fill = boss ? '#ff8a78' : '#f1ead6';
  const shade = boss ? '#d9604f' : '#d5ccb0';
  const horns = boss
    ? '<path d="M13 20 L3 2 L25 11 Z" fill="#ffc21a" stroke="#05070d" stroke-width="3.5" stroke-linejoin="round"/><path d="M51 20 L61 2 L39 11 Z" fill="#ffc21a" stroke="#05070d" stroke-width="3.5" stroke-linejoin="round"/>'
    : '';
  return (
    '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    horns +
    `<path d="M32 7C18 7 8.5 17 8.5 30c0 8 4 13 9 16v8c0 2.2 1.8 4 4 4h21c2.2 0 4-1.8 4-4v-8c5-3 9-8 9-16C55.5 17 46 7 32 7Z" fill="${fill}" stroke="#05070d" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="M47 46v8c0 2.2-1.8 4-4 4h-6V46Z" fill="${shade}" opacity=".55"/>` +
    '<ellipse cx="22" cy="20" rx="8" ry="5" fill="#fff" opacity=".55" transform="rotate(-25 22 20)"/>' +
    '<ellipse cx="22.5" cy="31" rx="6.8" ry="7.6" fill="#1a1030"/><ellipse cx="41.5" cy="31" rx="6.8" ry="7.6" fill="#1a1030"/>' +
    '<ellipse cx="20.5" cy="28.5" rx="1.8" ry="2.2" fill="#fff" opacity=".7"/><ellipse cx="39.5" cy="28.5" rx="1.8" ry="2.2" fill="#fff" opacity=".7"/>' +
    '<path d="M32 38.5l-3.6 6.2h7.2Z" fill="#1a1030"/>' +
    '<path d="M22 49h20" stroke="#05070d" stroke-width="2.2" stroke-linecap="round"/>' +
    '<path d="M27 49v8M32 49v8M37 49v8" stroke="#05070d" stroke-width="2.2" stroke-linecap="round"/>' +
    '</svg>'
  );
}
