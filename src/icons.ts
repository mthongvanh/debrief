// Stroke icons for the panel and the walkthrough, drawn on a 24-unit grid in the current text colour.

const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  split: '<rect x="3" y="5" width="7" height="14" rx="1.5"/><rect x="14" y="5" width="7" height="14" rx="1.5"/>',
  flow: '<rect x="3" y="4" width="8" height="6" rx="1.5"/><rect x="13" y="14" width="8" height="6" rx="1.5"/><path d="M7 10v4a3 3 0 0 0 3 3h3"/>',
  commit: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v5.5M12 15.5V21"/>',
  pr: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v7M18 15.5V10a3 3 0 0 0-3-3h-4"/>',
  walk: '<path d="M4 5h11M4 12h16M4 19h9"/>',
  shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  cross: '<path d="M6 6l12 12M18 6L6 18"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  prev: '<path d="M15 18l-6-6 6-6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>',
  diff: '<path d="M12 4v8M8 8h8M8 18h8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  quote: '<path fill="currentColor" stroke="none" d="M4 11.5C4 8 6 5.5 9.5 5v2.6C8 8.1 7.2 9.2 7.1 11H10v7H4zm10 0c0-3.5 2-6 5.5-6.5v2.6c-1.5.5-2.3 1.6-2.4 3.4H20v7h-6z"/>'
} as const

export type IconName = keyof typeof ICONS

/** An icon from the fixed set above; decorative, so screen readers skip it. */
export function icon(name: IconName, size: number): HTMLElement {
  const span = document.createElement('span')
  span.className = 'icon'
  span.setAttribute('aria-hidden', 'true')
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`
  return span
}
