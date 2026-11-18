/** Tiny DOM helpers. Text is always set via textContent (never innerHTML) for user data. */

type Child = Node | string | null | undefined | false;

export interface ElementProps {
  class?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string>;
  dataset?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void }>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.title) el.title = props.title;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  if (props.dataset) Object.assign(el.dataset, props.dataset);
  if (props.on) {
    for (const [type, handler] of Object.entries(props.on)) {
      if (handler) el.addEventListener(type, handler as EventListener);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/** Static, trusted SVG icon markup (never user data). */
export function icon(name: keyof typeof ICONS, cls = 'ww-icon'): SVGSVGElement {
  const wrapper = document.createElement('span');
  wrapper.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
  return wrapper.firstElementChild as SVGSVGElement;
}

const stroke = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
export const ICONS = {
  logo: `<path d="M12 2 21 12 12 22 3 12Z" ${stroke}/><path d="M12 6.5 16.5 12 12 17.5 7.5 12Z" fill="currentColor" opacity=".55"/>`,
  undo: `<path d="M9 14 4 9l5-5" ${stroke}/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" ${stroke}/>`,
  redo: `<path d="m15 14 5-5-5-5" ${stroke}/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" ${stroke}/>`,
  camera: `<path d="M3 12a9 9 0 1 0 3-6.7" ${stroke}/><path d="M3 4v4h4" ${stroke}/>`,
  focus: `<circle cx="12" cy="12" r="3" ${stroke}/><path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" ${stroke}/>`,
  eye: `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" ${stroke}/><circle cx="12" cy="12" r="3" ${stroke}/>`,
  eyeOff: `<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.1 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6" ${stroke}/>`,
  pin: `<path d="M9 3h6l-1 6 4 4H6l4-4-1-6ZM12 13v8" ${stroke}/>`,
  chevron: `<path d="m9 6 6 6-6 6" ${stroke}/>`,
  trash: `<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" ${stroke}/>`,
  spark: `<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" ${stroke}/>`,
  search: `<circle cx="11" cy="11" r="6" ${stroke}/><path d="m20 20-4.3-4.3" ${stroke}/>`,
  gauge: `<path d="M4 16a8 8 0 1 1 16 0" ${stroke}/><path d="m12 16 4-5" ${stroke}/>`,
} as const;

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}
