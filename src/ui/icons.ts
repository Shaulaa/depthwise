const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS: Record<string, string> = {
  map: svg('<path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5V4l-6 2.5L9 4Z"/><path d="M9 4v13M15 6.5v13"/>'),
  stamp: svg('<path d="M9 13V9.5a3 3 0 1 1 6 0V13"/><path d="M5 13h14v4H5z"/><path d="M4 20.5h16"/>'),
  sound: svg('<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>'),
  mute: svg('<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
  help: svg('<path d="M9.2 9.2a2.9 2.9 0 1 1 4.3 2.6c-.9.5-1.5 1.1-1.5 2.2"/><circle cx="12" cy="17.6" r=".6" fill="currentColor"/><circle cx="12" cy="12" r="9.2"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  ship: svg('<ellipse cx="12" cy="9" rx="8.5" ry="4"/><path d="M8.5 16h7l-1 3h-5l-1-3ZM9 12.6 9.5 16M15 12.6 14.5 16"/>'),
  weather: svg('<path d="M7 17.5h10a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6-1A4 4 0 0 0 7 17.5Z"/><path d="m9 20.5-.6 1.2M13 20.5l-.6 1.2M17 20.5l-.6 1.2"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
};

/** Fill every `[data-icon]` placeholder under a root with its SVG. */
export function hydrateIcons(root: ParentNode): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-icon]')) {
    const icon = ICONS[node.dataset.icon ?? ''];
    if (icon) node.innerHTML = icon;
  }
}

let stampSerial = 0;

/** Round passport stamp. Inputs are trusted constants from content.ts, never user text. */
export function stampSvg(code: string, name: string, tilt: number): string {
  const id = `stamp-arc-${stampSerial++}`;
  return `<svg class="stamp" viewBox="0 0 120 120" style="--tilt:${tilt}deg" aria-hidden="true" focusable="false">
    <defs><path id="${id}" d="M 16 60 a 44 44 0 1 1 88 0 a 44 44 0 1 1 -88 0"/></defs>
    <g filter="url(#ink)">
      <circle cx="60" cy="60" r="55" fill="none" stroke="currentColor" stroke-width="3"/>
      <circle cx="60" cy="60" r="33.5" fill="none" stroke="currentColor" stroke-width="1.4"/>
      <text class="stamp__ring"><textPath href="#${id}" textLength="268" lengthAdjust="spacing">${name.toUpperCase()} · DEPTHWISE · KEPULAUAN AWAN ·</textPath></text>
      <text class="stamp__code" x="60" y="67" text-anchor="middle">${code}</text>
      <path d="M44 76h32" stroke="currentColor" stroke-width="1.4"/>
      <text class="stamp__note" x="60" y="87" text-anchor="middle">SINGGAH</text>
    </g>
  </svg>`;
}
