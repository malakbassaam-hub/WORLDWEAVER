import { h, icon } from './dom';

export type ViewMode = 'studio' | 'immersive';
export type ToolId = 'hierarchy' | 'director' | 'inspector' | 'futures' | 'timeline' | 'ledger' | 'persistence' | null;
export type ToolPanelId = 'hierarchy' | 'director' | 'inspector' | 'futures' | 'timeline' | 'ledger' | 'persistence';

export interface TopbarHandlers {
  undo(): void;
  redo(): void;
  resetCamera(): void;
  toggleQuality(): void;
  toggleMode(): void;
  showHelp(): void;
  toggleTools(): void;
}

export interface ToolPanel {
  id: ToolPanelId;
  label: string;
  iconName: keyof typeof import('./dom').ICONS;
  element: HTMLElement;
}

/** Studio frame: viewport-first with vertical tool dock and slide-out panel area. */
export class StudioShell {
  readonly root: HTMLElement;
  readonly viewport: HTMLElement;
  readonly toolDock: HTMLElement;
  readonly panelArea: HTMLElement;
  readonly panelContent: HTMLElement;
  readonly bottomDrawer: HTMLElement;
  readonly bottomDrawerContent: HTMLElement;
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
  private readonly toolsToggleBtn: HTMLButtonElement;
  private readonly immersiveExitBtn: HTMLButtonElement;
  private readonly immersiveResetBtn: HTMLButtonElement;
  private readonly immersiveHelpBtn: HTMLButtonElement;
  private readonly immersiveControls: HTMLElement;
  private readonly helpPopover: HTMLElement;
  private toastTimer = 0;
  private mode: ViewMode = 'studio';
  private activeTool: ToolId = null;
  private toolsVisible = true;
  private drawerOpen = false;

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
    this.toolsToggleBtn = h('button', { class: 'ww-icon-btn', title: 'Hide Tools (T)', attrs: { type: 'button', 'aria-label': 'Toggle tool dock visibility', 'aria-pressed': 'false' }, on: { click: handlers.toggleTools } }, [icon('panelLeft')]);

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
        this.toolsToggleBtn,
        this.modeBtn,
        this.helpBtn,
      ]),
    ]);

    // Tool Dock - vertical strip with icon buttons
    this.toolDock = h('nav', { class: 'ww-tool-dock', attrs: { role: 'navigation', 'aria-label': 'Tool palette' } });

    // Panel Area - slides out from dock
    this.panelContent = h('div', { class: 'ww-panel-content' });
    this.panelArea = h('aside', { class: 'ww-panel-area', attrs: { 'aria-hidden': 'true' } }, [
      this.panelContent,
    ]);

    // Bottom Drawer - for timeline and ledger
    this.bottomDrawerContent = h('div', { class: 'ww-drawer-content' });
    this.bottomDrawer = h('footer', { class: 'ww-bottom-drawer', attrs: { 'aria-hidden': 'true' } }, [
      h('button', { class: 'ww-drawer-handle', attrs: { type: 'button', 'aria-label': 'Toggle bottom drawer', title: 'Timeline & Ledger (B)' }, on: { click: () => this.toggleDrawer() } }, [
        icon('chevronUp', 'ww-drawer-icon'),
      ]),
      this.bottomDrawerContent,
    ]);

    // Immersive controls
    this.immersiveExitBtn = h('button', { class: 'ww-btn is-primary', attrs: { type: 'button', 'aria-label': 'Exit immersive mode' }, on: { click: handlers.toggleMode } }, [icon('compress'), h('span', { text: 'Exit Explore' })]);
    this.immersiveResetBtn = h('button', { class: 'ww-btn is-ghost', title: 'Reset camera (Home)', attrs: { type: 'button', 'aria-label': 'Reset camera to default view' }, on: { click: handlers.resetCamera } }, [icon('camera'), h('span', { text: 'Reset View' })]);
    this.immersiveHelpBtn = h('button', { class: 'ww-icon-btn', title: 'Camera Controls (?)', attrs: { type: 'button', 'aria-label': 'Show camera controls help' }, on: { click: handlers.showHelp } }, [icon('help')]);

    this.immersiveControls = h('div', { class: 'ww-immersive-controls' }, [
      this.immersiveExitBtn,
      this.immersiveResetBtn,
      this.immersiveHelpBtn,
    ]);

    // Help popover
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
      this.topbar,
      this.toolDock,
      this.panelArea,
      this.bottomDrawer,
      this.immersiveControls,
      this.helpPopover,
      this.tooltip,
      this.toastHost,
      this.loader,
    ]);
    host.replaceChildren(this.root);
  }

  /** Register a tool panel with the dock. */
  registerTool(tool: ToolPanel): void {
    const btn = h('button', {
      class: 'ww-tool-btn',
      title: tool.label,
      attrs: {
        type: 'button',
        role: 'tab',
        'aria-selected': 'false',
        'aria-controls': `panel-${tool.id}`,
        'data-tool': tool.id,
      },
      on: {
        click: () => this.setActiveTool(tool.id),
      },
    }, [
      icon(tool.iconName),
      h('span', { class: 'ww-tool-tooltip', text: tool.label }),
    ]);
    this.toolDock.append(btn);
    this.panelContent.append(tool.element);
    tool.element.setAttribute('role', 'tabpanel');
    tool.element.setAttribute('id', `panel-${tool.id}`);
    tool.element.setAttribute('aria-hidden', 'true');
    tool.element.hidden = true;
  }

  /** Set the active tool (opens panel area). */
  setActiveTool(toolId: ToolId): void {
    if (this.activeTool === toolId) {
      this.setActiveTool(null);
      return;
    }
    this.activeTool = toolId;
    this.updateToolDock();
    this.updatePanelArea();
    this.updateAria();
  }

  /** Get the currently active tool. */
  getActiveTool(): ToolId {
    return this.activeTool;
  }

  /** Toggle tool dock visibility. */
  setToolsVisible(visible: boolean): void {
    this.toolsVisible = visible;
    this.root.classList.toggle('tools-hidden', !visible);
    this.toolsToggleBtn.setAttribute('aria-pressed', String(visible));
    this.toolsToggleBtn.title = visible ? 'Hide Tools (T)' : 'Show Tools (T)';
    this.toolsToggleBtn.replaceChildren(icon(visible ? 'panelLeft' : 'panelRight'));
  }

  /** Toggle bottom drawer. */
  toggleDrawer(): void {
    this.drawerOpen = !this.drawerOpen;
    this.bottomDrawer.classList.toggle('is-open', this.drawerOpen);
    const handleIcon = this.bottomDrawer.querySelector('.ww-drawer-icon');
    if (handleIcon) {
      handleIcon.outerHTML = icon(this.drawerOpen ? 'chevronDown' : 'chevronUp', 'ww-drawer-icon').outerHTML;
    }
  }

  /** Set bottom drawer open state. */
  setDrawerOpen(open: boolean): void {
    if (this.drawerOpen !== open) this.toggleDrawer();
  }

  /** Get bottom drawer open state. */
  isDrawerOpen(): boolean {
    return this.drawerOpen;
  }

  /** Append content to bottom drawer. */
  appendToDrawer(element: HTMLElement): void {
    this.bottomDrawerContent.append(element);
  }

  private updateToolDock(): void {
    for (const btn of this.toolDock.querySelectorAll<HTMLButtonElement>('.ww-tool-btn')) {
      const toolId = btn.dataset.tool as ToolId;
      const isActive = toolId === this.activeTool;
      btn.setAttribute('aria-selected', String(isActive));
      btn.classList.toggle('is-active', isActive);
    }
  }

  private updatePanelArea(): void {
    const hasActiveTool = this.activeTool !== null;
    this.panelArea.classList.toggle('is-open', hasActiveTool);
    this.panelArea.setAttribute('aria-hidden', String(!hasActiveTool));
    for (const panel of this.panelContent.querySelectorAll<HTMLElement>('[role="tabpanel"]')) {
      const isActive = panel.id === `panel-${this.activeTool}`;
      panel.hidden = !isActive;
      panel.setAttribute('aria-hidden', String(!isActive));
    }
  }

  private updateAria(): void {
    this.root.classList.toggle('has-active-tool', this.activeTool !== null);
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

    this.topbar.style.display = isImmersive ? 'none' : '';
    this.toolDock.style.display = isImmersive ? 'none' : '';
    this.panelArea.style.display = isImmersive ? 'none' : '';
    this.bottomDrawer.style.display = isImmersive ? 'none' : '';
    this.immersiveControls.style.display = isImmersive ? 'flex' : 'none';
    this.helpPopover.classList.remove('is-visible');

    if (isImmersive) {
      this.activeTool = null;
      this.updateToolDock();
      this.updatePanelArea();
      this.updateAria();
    }
  }

  getMode(): ViewMode {
    return this.mode;
  }

  getToolsVisible(): boolean {
    return this.toolsVisible;
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