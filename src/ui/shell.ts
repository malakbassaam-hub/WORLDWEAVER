import { h, icon } from './dom';

export type ViewMode = 'studio' | 'immersive';

export interface TopbarHandlers {
  undo(): void;
  redo(): void;
  resetCamera(): void;
  toggleQuality(): void;
  toggleMode(): void;
  showHelp(): void;
}

/** Studio frame: full-bleed viewport with floating Luminous Night glass panels. */
export class StudioShell {
  readonly root: HTMLElement;
  readonly viewport: HTMLElement;
  readonly left: HTMLElement;
  readonly right: HTMLElement;
  readonly bottom: HTMLElement;
  readonly topbar: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly tooltip: HTMLElement;
  private readonly toastHost: HTMLElement;
  private readonly loader: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly qualityBtn: HTMLButtonElement;
  private readonly modeBtn: HTMLButtonElement;
  private readonly helpBtn: HTMLButtonElement;
  private readonly immersiveExitBtn: HTMLButtonElement;
  private readonly immersiveResetBtn: HTMLButtonElement;
  private readonly immersiveHelpBtn: HTMLButtonElement;
  private readonly immersiveControls: HTMLElement;
  private readonly helpPopover: HTMLElement;
  private toastTimer = 0;
  private mode: ViewMode = 'studio';
  private panelCollapsed = { left: false, right: false, bottom: false };

  constructor(host: HTMLElement, world: { name: string; seed: number }, handlers: TopbarHandlers) {
    this.viewport = h('div', { class: 'ww-viewport' });
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

    this.modeBtn = h('button', { class: 'ww-btn is-ghost', title: 'Explore World', attrs: { type: 'button', 'aria-label': 'Enter immersive explore mode' }, on: { click: handlers.toggleMode } }, [icon('expand'), h('span', { text: 'Explore World' })]);
    this.helpBtn = h('button', { class: 'ww-icon-btn', title: 'Camera Controls (?)', attrs: { type: 'button', 'aria-label': 'Show camera controls help' }, on: { click: handlers.showHelp } }, [icon('help')]);

    this.topbar = h('header', { class: 'ww-topbar ww-glass' }, [
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
        h('span', { class: 'ww-divider' }),
        this.modeBtn,
        this.helpBtn,
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
    ]);

    this.immersiveExitBtn = h('button', { class: 'ww-btn is-primary', attrs: { type: 'button', 'aria-label': 'Exit immersive mode' }, on: { click: handlers.toggleMode } }, [icon('compress'), h('span', { text: 'Exit Explore' })]);
    this.immersiveResetBtn = h('button', { class: 'ww-btn is-ghost', title: 'Reset camera (Home)', attrs: { type: 'button', 'aria-label': 'Reset camera to default view' }, on: { click: handlers.resetCamera } }, [icon('camera'), h('span', { text: 'Reset View' })]);
    this.immersiveHelpBtn = h('button', { class: 'ww-icon-btn', title: 'Camera Controls (?)', attrs: { type: 'button', 'aria-label': 'Show camera controls help' }, on: { click: handlers.showHelp } }, [icon('help')]);

    this.immersiveControls = h('div', { class: 'ww-immersive-controls' }, [
      this.immersiveExitBtn,
      this.immersiveResetBtn,
      this.immersiveHelpBtn,
    ]);

    this.helpPopover = h('div', { class: 'ww-help-popover', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Camera controls' } }, [
      h('div', { class: 'ww-help-popover-content' }, [
        h('h3', { text: 'Camera Controls' }),
        h('ul', { class: 'ww-help-list' }, [
          h('li', {}, [h('kbd', { text: 'LMB + Drag' }), h('span', { text: 'Orbit around world' })]),
          h('li', {}, [h('kbd', { text: 'RMB + Drag' }), h('span', { text: 'Pan camera' })]),
          h('li', {}, [h('kbd', { text: 'Wheel' }), h('span', { text: 'Zoom in/out' })]),
          h('li', {}, [h('kbd', { text: 'Click' }), h('span', { text: 'Select object' })]),
          h('li', {}, [h('kbd', { text: 'Double-click' }), h('span', { text: 'Focus & orbit object' })]),
          h('li', {}, [h('kbd', { text: 'F' }), h('span', { text: 'Frame selected object' })]),
          h('li', {}, [h('kbd', { text: 'Home' }), h('span', { text: 'Reset camera view' })]),
          h('li', {}, [h('kbd', { text: 'Esc' }), h('span', { text: 'Deselect / Exit immersive' })]),
        ]),
        h('button', { class: 'ww-btn is-primary', attrs: { type: 'button' }, on: { click: () => this.hideHelpPopover() } }, [h('span', { text: 'Got it' })]),
      ]),
      h('div', { class: 'ww-help-popover-backdrop', attrs: { 'aria-hidden': 'true' }, on: { click: () => this.hideHelpPopover() } }),
    ]);

    this.root = h('div', { class: 'ww-studio' }, [
      this.viewport,
      h('div', { class: 'ww-vignette', attrs: { 'aria-hidden': 'true' } }),
      h('div', { class: 'ww-layout' }, [this.topbar, this.left, center, this.right, this.bottom]),
      this.immersiveControls,
      this.helpPopover,
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

  setMode(mode: ViewMode): void {
    this.mode = mode;
    const isImmersive = mode === 'immersive';
    this.root.classList.toggle('is-immersive', isImmersive);
    this.modeBtn.replaceChildren(
      icon(isImmersive ? 'compress' : 'expand'),
      h('span', { text: isImmersive ? 'Exit Explore' : 'Explore World' })
    );
    this.modeBtn.title = isImmersive ? 'Exit immersive explore mode' : 'Enter immersive explore mode';
    this.modeBtn.setAttribute('aria-label', isImmersive ? 'Exit immersive explore mode' : 'Enter immersive explore mode');

    this.left.style.display = isImmersive ? 'none' : '';
    this.right.style.display = isImmersive ? 'none' : '';
    this.bottom.style.display = isImmersive ? 'none' : '';
    this.topbar.style.display = isImmersive ? 'none' : '';
    this.immersiveControls.style.display = isImmersive ? 'flex' : 'none';
    this.helpPopover.classList.remove('is-visible');
  }

  getMode(): ViewMode {
    return this.mode;
  }

  setPanelCollapsed(side: 'left' | 'right' | 'bottom', collapsed: boolean): void {
    this.panelCollapsed[side] = collapsed;
    const panel = this[side];
    if (panel) {
      panel.classList.toggle('is-collapsed', collapsed);
    }
    this.updateLayout();
  }

  togglePanel(side: 'left' | 'right' | 'bottom'): void {
    this.setPanelCollapsed(side, !this.panelCollapsed[side]);
  }

  isPanelCollapsed(side: 'left' | 'right' | 'bottom'): boolean {
    return this.panelCollapsed[side];
  }

  private updateLayout(): void {
    const leftCollapsed = this.panelCollapsed.left;
    const rightCollapsed = this.panelCollapsed.right;
    const bottomCollapsed = this.panelCollapsed.bottom;

    this.root.style.setProperty('--left-width', leftCollapsed ? '48px' : 'minmax(250px, 300px)');
    this.root.style.setProperty('--right-width', rightCollapsed ? '48px' : 'minmax(290px, 344px)');
    this.root.style.setProperty('--bottom-height', bottomCollapsed ? '48px' : 'auto');
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

  showHelpPopover(): void {
    this.helpPopover.classList.add('is-visible');
    const focusable = this.helpPopover.querySelector('button');
    if (focusable) (focusable as HTMLElement).focus();
  }

  hideHelpPopover(): void {
    this.helpPopover.classList.remove('is-visible');
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

  hideFallback(canvas: HTMLCanvasElement): void {
    this.viewport.replaceChildren(canvas);
  }
}