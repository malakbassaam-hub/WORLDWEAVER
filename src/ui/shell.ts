import { h, icon } from './dom';

export interface TopbarHandlers {
  undo(): void;
  redo(): void;
  resetCamera(): void;
  toggleQuality(): void;
}

/** Studio frame: full-bleed viewport with floating Luminous Night glass panels. */
export class StudioShell {
  readonly root: HTMLElement;
  readonly viewport: HTMLElement;
  readonly left: HTMLElement;
  readonly right: HTMLElement;
  readonly bottom: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly tooltip: HTMLElement;
  private readonly toastHost: HTMLElement;
  private readonly loader: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly qualityBtn: HTMLButtonElement;
  private toastTimer = 0;

  constructor(host: HTMLElement, world: { name: string; seed: number }, handlers: TopbarHandlers) {
    this.viewport = h('div', { class: 'ww-viewport' }, [
      h('p', { class: 'ww-viewport-hint', text: 'LMB: Orbit · RMB: Pan · Wheel: Zoom · Click: Select · Double-click: Focus · Home: Reset' }),
    ]);
    this.stats = h('div', { class: 'ww-stats', attrs: { 'aria-live': 'off' } });
    this.tooltip = h('div', { class: 'ww-tooltip', attrs: { role: 'tooltip' } });
    this.toastHost = h('div', { class: 'ww-toast-host', attrs: { 'aria-live': 'polite' } });
    this.loader = h('div', { class: 'ww-loader' }, [
      h('div', { class: 'ww-loader-mark' }, [icon('logo', 'ww-icon is-xl')]),
      h('p', { text: 'Weaving world…' }),
    ]);

    this.undoBtn = h('button', { class: 'ww-icon-btn', title: 'Undo (Ctrl+Z)', attrs: { type: 'button', 'aria-label': 'Undo' }, on: { click: handlers.undo } }, [icon('undo')]);
    this.redoBtn = h('button', { class: 'ww-icon-btn', title: 'Redo (Ctrl+Shift+Z)', attrs: { type: 'button', 'aria-label': 'Redo' }, on: { click: handlers.redo } }, [icon('redo')]);
    this.qualityBtn = h('button', { class: 'ww-btn is-ghost', attrs: { type: 'button' }, on: { click: handlers.toggleQuality } });

    const topbar = h('header', { class: 'ww-topbar ww-glass' }, [
      h('div', { class: 'ww-brand' }, [
        icon('logo', 'ww-icon is-brand'),
        h('span', { class: 'ww-brand-name', text: 'WORLDWEAVER' }),
        h('span', { class: 'ww-brand-sub', text: 'Studio' }),
      ]),
      h('div', { class: 'ww-topbar-world' }, [
        h('span', { class: 'ww-world-title', text: world.name }),
        h('span', { class: 'ww-chip', text: `seed ${world.seed}` }),
        h('span', { class: 'ww-chip is-phase', text: 'Phase 2 · AI World Director' }),
      ]),
      h('div', { class: 'ww-topbar-actions' }, [
        this.undoBtn,
        this.redoBtn,
        h('span', { class: 'ww-divider' }),
        h('button', { class: 'ww-btn is-ghost', title: 'Reset camera (Home)', attrs: { type: 'button' }, on: { click: handlers.resetCamera } }, [icon('camera'), h('span', { text: 'Reset view' })]),
        this.qualityBtn,
      ]),
    ]);

    this.left = h('aside', { class: 'ww-col ww-left' });
    this.right = h('aside', { class: 'ww-col ww-right' });
    this.bottom = h('div', { class: 'ww-bottom' });
    const center = h('div', { class: 'ww-center' }, [
      h('div', { class: 'ww-title-card' }, [
        h('p', { class: 'ww-eyebrow', text: 'Now weaving' }),
        h('p', { class: 'ww-title-card-name', text: world.name }),
      ]),
      this.stats,
      h('p', { class: 'ww-controls-hint', text: 'Drag to orbit · Right-drag to pan · Scroll to zoom · Click to select · F to frame' }),
    ]);

    this.root = h('div', { class: 'ww-studio' }, [
      this.viewport,
      h('div', { class: 'ww-vignette', attrs: { 'aria-hidden': 'true' } }),
      h('div', { class: 'ww-layout' }, [topbar, this.left, center, this.right, this.bottom]),
      this.tooltip,
      this.toastHost,
      this.loader,
    ]);
    host.replaceChildren(this.root);
  }

  setHistory(canUndo: boolean, canRedo: boolean): void {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
  }

  setQualityLabel(mode: 'cinematic' | 'performance' | 'unavailable'): void {
    this.qualityBtn.replaceChildren(icon('gauge'), h('span', { text: mode === 'cinematic' ? 'Cinematic' : mode === 'performance' ? 'Performance' : 'Renderer off' }));
    this.qualityBtn.title = mode === 'cinematic' ? 'Bloom, shadows and high resolution. Click for Performance.' : 'Lower GPU load. Click for Cinematic.';
    this.qualityBtn.disabled = mode === 'unavailable';
  }

  setStats(text: string): void {
    this.stats.textContent = text;
  }

  showTooltip(text: string | null, x: number, y: number): void {
    if (!text) {
      this.tooltip.classList.remove('is-visible');
      return;
    }
    this.tooltip.textContent = text;
    this.tooltip.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 16)}px)`;
    this.tooltip.classList.add('is-visible');
  }

  toast(message: string, tone: 'info' | 'warn' = 'info'): void {
    window.clearTimeout(this.toastTimer);
    this.toastHost.replaceChildren(h('div', { class: `ww-toast ww-glass is-${tone}`, text: message }));
    this.toastTimer = window.setTimeout(() => this.toastHost.replaceChildren(), 3800);
  }

  ready(): void {
    this.loader.classList.add('is-done');
    window.setTimeout(() => this.loader.remove(), 900);
  }

  showFallback(title: string, message: string): void {
    this.viewport.replaceChildren(
      h('div', { class: 'ww-fallback ww-glass', attrs: { role: 'alert' } }, [
        h('h2', { text: title }),
        h('p', { text: message }),
        h('p', { class: 'ww-note', text: 'Enable hardware acceleration in your browser settings, update graphics drivers, or try a recent Chrome, Edge or Firefox. The scene list and inspector still work.' }),
      ]),
    );
    this.ready();
  }

  /** Restores the canvas to the viewport and removes the context-loss fallback. */
  hideFallback(canvas: HTMLCanvasElement): void {
    this.viewport.replaceChildren(canvas);
  }

}
