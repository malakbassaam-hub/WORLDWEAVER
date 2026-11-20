/**
 * World persistence controls (DOM): Save, Restore, Export, Import, with an
 * unsaved-change indicator and inline confirmation. Text via textContent only.
 * Not yet mounted in the studio and NOT browser-tested yet (see
 * docs/persistence/INTEGRATION.md); its logic lives in persistenceModel.ts and
 * src/persistence/controller.ts, which are unit-tested.
 */
import type { ImportCheck, PersistenceController } from '../persistence/controller';
import { MAX_IMPORT_BYTES } from '../persistence/controller';
import { h } from './dom';
import { importPrompt, persistenceView, precheckFile } from './persistenceModel';

export interface PersistencePanelOptions {
  /** Called after a successful save, restore or import (e.g. a toast). */
  notify?(message: string, tone?: 'info' | 'warn'): void;
}

export class PersistencePanel {
  readonly element: HTMLElement;
  private readonly indicator: HTMLElement;
  private readonly slotLine: HTMLElement;
  private readonly message: HTMLElement;
  private readonly confirmBox: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly restoreBtn: HTMLButtonElement;
  private readonly exportBtn: HTMLButtonElement;
  private readonly importBtn: HTMLButtonElement;
  private readonly fileInput: HTMLInputElement;
  private readonly unsubscribe: () => void;
  private lastUrl: string | null = null;

  constructor(private readonly persistence: PersistenceController, private readonly options: PersistencePanelOptions = {}) {
    const btn = (text: string, on: () => void, primary = false) => h('button', { class: `ww-btn is-small${primary ? ' is-primary' : ''}`, text, attrs: { type: 'button' }, on: { click: on } });
    this.indicator = h('span', { class: 'ww-chip', attrs: { role: 'status' } });
    this.slotLine = h('p', { class: 'ww-note' });
    this.message = h('p', { class: 'ww-note', attrs: { 'aria-live': 'polite' } });
    this.confirmBox = h('div', { class: 'ww-card', attrs: { role: 'alertdialog', 'aria-label': 'Confirm loading a world' } });
    this.confirmBox.hidden = true;
    this.saveBtn = btn('Save', () => this.save(), true);
    this.restoreBtn = btn('Restore', () => this.askRestore());
    this.exportBtn = btn('Export', () => this.export());
    this.importBtn = btn('Import…', () => this.fileInput.click());
    this.fileInput = h('input', { attrs: { type: 'file', accept: '.json,application/json', 'aria-label': 'Import a world file', hidden: '' } });
    this.fileInput.addEventListener('change', () => void this.onFile());
    this.element = h('section', { class: 'ww-panel ww-glass ww-persistence', attrs: { 'aria-label': 'Save and load' } }, [
      h('div', { class: 'ww-panel-head' }, [h('h2', { text: 'World file' }), this.indicator]),
      h('div', { class: 'ww-btn-row' }, [this.saveBtn, this.restoreBtn, this.exportBtn, this.importBtn, this.fileInput]),
      this.slotLine,
      this.confirmBox,
      this.message,
    ]);
    this.unsubscribe = persistence.subscribe(() => this.render());
    this.render();
  }

  dispose(): void {
    this.unsubscribe();
    if (this.lastUrl) URL.revokeObjectURL(this.lastUrl);
    this.element.remove();
  }

  private render(): void {
    const v = persistenceView(this.persistence.status());
    this.indicator.textContent = v.indicator.text;
    this.indicator.className = `ww-chip${v.indicator.dirty ? ' is-recorded' : ''}`;
    this.saveBtn.disabled = !v.save.enabled;
    this.saveBtn.title = v.save.title;
    this.restoreBtn.disabled = !v.restore.enabled;
    this.restoreBtn.title = v.restore.title;
    this.slotLine.textContent = v.slotLine;
    this.message.textContent = v.message?.text ?? '';
  }

  private save(): void {
    const r = this.persistence.save();
    if (r.ok) this.options.notify?.('World saved in this browser.');
    else this.options.notify?.(r.message, 'warn');
  }

  private askRestore(): void {
    const c = this.persistence.confirmation();
    if (!c.required) return void this.persistence.restoreLocal();
    this.confirm(`Restore the local save? ${c.reason}`, 'Restore', () => this.persistence.restoreLocal());
  }

  private export(): void {
    const r = this.persistence.exportFile();
    if (!r.ok) return void this.options.notify?.(r.message, 'warn');
    if (this.lastUrl) URL.revokeObjectURL(this.lastUrl);
    this.lastUrl = URL.createObjectURL(new Blob([r.file.text], { type: r.file.mime }));
    const a = h('a', { attrs: { href: this.lastUrl, download: r.file.filename } });
    document.body.append(a);
    a.click();
    a.remove();
    this.options.notify?.(`Exported ${r.file.filename}.`);
  }

  private async onFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!file) return;
    const pre = precheckFile(file);
    if (pre) return void this.showMessage(pre);
    let text: string;
    try {
      text = await file.slice(0, MAX_IMPORT_BYTES + 1).text();
    } catch {
      return void this.showMessage('The file could not be read.');
    }
    const check: ImportCheck = this.persistence.checkImport(text);
    if (!check.ok) return void this.showMessage(`Import refused: ${check.message}`);
    const c = this.persistence.confirmation();
    this.confirm(importPrompt(check, c.reason), 'Import', () => this.persistence.applyImport(check));
  }

  private confirm(text: string, action: string, run: () => void): void {
    const yes = h('button', { class: 'ww-btn is-small is-primary', text: action, attrs: { type: 'button' }, on: { click: () => { this.confirmBox.hidden = true; run(); } } });
    const no = h('button', { class: 'ww-btn is-small', text: 'Cancel', attrs: { type: 'button' }, on: { click: () => { this.confirmBox.hidden = true; } } });
    this.confirmBox.replaceChildren(h('p', { text }), h('div', { class: 'ww-btn-row' }, [yes, no]));
    this.confirmBox.hidden = false;
    no.focus();
  }

  private showMessage(text: string): void {
    this.message.textContent = text;
    this.options.notify?.(text, 'warn');
  }
}
