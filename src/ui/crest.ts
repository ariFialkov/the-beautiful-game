import type { Team } from '@shared/teams';

const ICONS: Record<Team['crest']['icon'], string> = {
  lion: '<path d="M50 28c-10 0-18 7-18 17 0 8 5 13 9 17l9 10 9-10c4-4 9-9 9-17 0-10-8-17-18-17zm-7 16a3 3 0 1 1 0 .1zm14 0a3 3 0 1 1 0 .1zM44 54h12l-6 6z"/>',
  star: '<path d="M50 24l7.6 16.4 17.9 2.1-13.2 12.3 3.5 17.7L50 63.8l-15.8 8.7 3.5-17.7L24.5 42.5l17.9-2.1z"/>',
  ball: '<circle cx="50" cy="50" r="18" fill="none" stroke-width="3"/><path d="M50 38l10 7-4 12H44l-4-12z"/>',
  crown: '<path d="M28 62l-4-28 14 12 12-18 12 18 14-12-4 28z"/><rect x="26" y="64" width="48" height="6"/>',
  wave: '<path d="M26 44c8-8 16-8 24 0s16 8 24 0v8c-8 8-16 8-24 0s-16-8-24 0zM26 58c8-8 16-8 24 0s16 8 24 0v8c-8 8-16 8-24 0s-16-8-24 0z"/>',
  tower: '<path d="M38 70V40h-4v-8h8v4h6v-4h4v4h6v-4h8v8h-4v30z"/><rect x="46" y="54" width="8" height="16"/>',
  eagle: '<path d="M50 30c-6 10-18 12-26 10 6 6 12 8 18 8l-6 16h28l-6-16c6 0 12-2 18-8-8 2-20 0-26-10z"/>',
  sun: '<circle cx="50" cy="50" r="12"/><path d="M50 24v10M50 66v10M24 50h10M66 50h10M32 32l7 7M61 61l7 7M68 32l-7 7M39 61l-7 7" stroke-width="4" stroke-linecap="round"/>',
  anchor: '<circle cx="50" cy="28" r="5" fill="none" stroke-width="3"/><path d="M48 33h4v34h-4z"/><path d="M30 54c4 12 12 18 20 18s16-6 20-18l-6-2c-2 8-8 12-14 12s-12-4-14-12z"/><rect x="38" y="40" width="24" height="4"/>',
  bolt: '<path d="M56 22L34 54h12l-4 24 22-32H52z"/>',
};

/** Inline SVG club crest generated from the team record. */
export function crestSvg(team: Team, size = 64): string {
  const [c1, c2, c3] = team.crest.colors;
  const icon = ICONS[team.crest.icon].replace(/<(path|circle|rect)/g, `<$1 fill="${c2}" stroke="${c2}"`).replace(/fill="none"/g, 'fill="none"');
  let shape = '';
  switch (team.crest.shape) {
    case 'shield': shape = `<path d="M50 6L88 18v30c0 24-18 40-38 48C30 88 12 72 12 48V18z" fill="${c1}" stroke="${c3}" stroke-width="4"/>`; break;
    case 'circle': shape = `<circle cx="50" cy="50" r="44" fill="${c1}" stroke="${c3}" stroke-width="4"/><circle cx="50" cy="50" r="36" fill="none" stroke="${c2}" stroke-width="2" opacity="0.6"/>`; break;
    case 'hex': shape = `<path d="M50 6l38 22v44L50 94 12 72V28z" fill="${c1}" stroke="${c3}" stroke-width="4"/>`; break;
    case 'diamond': shape = `<path d="M50 6l42 44-42 44L8 50z" fill="${c1}" stroke="${c3}" stroke-width="4"/>`; break;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" class="crest">${shape}<g transform="translate(0,-2)">${icon}</g><text x="50" y="86" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="13" fill="${c3}" letter-spacing="1">${team.short}</text></svg>`;
}
