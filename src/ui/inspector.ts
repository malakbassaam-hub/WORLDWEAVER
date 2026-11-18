import { LUMINOUS_PALETTE } from '../core/palette';
import { childrenOf, EMISSIVE_MAX, NAME_MAX_LENGTH } from '../core/reducer';
import type { ColorHex, Entity, Vec3, VisualComponent, World } from '../core/types';
import type { StudioActions } from './actions';
import { clear, h, icon } from './dom';

/** Luminous Night palette offered as one-click looks (shared with the Director). */
export { LUMINOUS_PALETTE };

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Parses a user-typed number. Accepts Arabic-Indic (٠-٩) and Persian (۰-۹)
 * digits, the Arabic decimal separator (٫) and a typographic minus, so input
 * typed with an Arabic keyboard layout works. Returns NaN for invalid input.
 */
export function parseNumberInput(raw: string): number {
  const latin = raw
    .trim()
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u066b,]/g, '.')
    .replace(/[\u2212\u2013]/g, '-');
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(latin) ? Number(latin) : Number.NaN;
}
const deg = (rad: number) => Math.round((rad * 180) / Math.PI);

/** Inspector: shows the real data of the selected entity and edits it via events. */
export class InspectorPanel {
  readonly element: HTMLElement;
  private readonly body: HTMLElement;
  private readonly title: HTMLElement;
  private world: World | null = null;

  constructor(private readonly actions: StudioActions) {
    this.title = h('span', { class: 'ww-panel-meta' });
    this.body = h('div', { class: 'ww-inspector-body' });
    this.element = h('section', { class: 'ww-panel ww-glass ww-inspector', attrs: { 'aria-label': 'Inspector' } }, [
      h('header', { class: 'ww-panel-head' }, [h('h2', { text: 'Inspector' }), this.title]),
      this.body,
    ]);
    actions.selection.subscribe(() => this.render());
  }

  update(world: World): void {
    this.world = world;
    this.render();
  }

  private render(): void {
    const world = this.world;
    if (!world) return;
    const id = this.actions.selection.get();
    const entity = id ? world.entities[id] : undefined;
    clear(this.body);
    if (!entity) {
      this.title.textContent = 'World';
      this.body.append(...this.worldOverview(world));
      return;
    }
    this.title.textContent = entity.kind;
    this.body.append(
      this.header(entity),
      this.identity(world, entity),
      this.transform(entity),
      ...(entity.components.visual ? [this.appearance(entity, entity.components.visual)] : []),
      this.protection(world, entity),
      this.provenance(entity),
    );
  }

  // ------------------------------------------------------------- sections

  private worldOverview(world: World): HTMLElement[] {
    const kinds = new Map<string, number>();
    for (const id of world.order) {
      const kind = world.entities[id]?.kind ?? 'unknown';
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
    return [
      h('div', { class: 'ww-world-card' }, [
        h('p', { class: 'ww-eyebrow', text: 'Active world' }),
        h('h3', { class: 'ww-world-name', text: world.name }),
        h('p', { class: 'ww-muted', text: world.biome }),
      ]),
      section('Summary', [
        field('Seed', mono(String(world.seed))),
        field('Entities', mono(String(world.order.length))),
        field('Sequence', mono(`#${world.seq}`)),
        field('Schema', mono(`v${world.schemaVersion}`)),
      ]),
      section(
        'Composition',
        [...kinds.entries()].map(([kind, count]) => field(kind, mono(String(count)))),
      ),
      h('p', { class: 'ww-hint-card' }, [
        icon('spark'),
        h('span', { text: 'Select an entity in the viewport or the scene list to inspect and edit it.' }),
      ]),
    ];
  }

  private header(entity: Entity): HTMLElement {
    const input = h('input', {
      class: 'ww-name-input',
      attrs: { value: entity.name, maxlength: String(NAME_MAX_LENGTH), 'aria-label': 'Entity name', spellcheck: 'false' },
      on: {
        keydown: (e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            (e.target as HTMLInputElement).value = entity.name;
            (e.target as HTMLInputElement).blur();
          }
        },
        change: (e) => {
          const value = (e.target as HTMLInputElement).value;
          if (!this.actions.edit({ type: 'entity/renamed', id: entity.id, name: value })) {
            (e.target as HTMLInputElement).value = entity.name;
          }
        },
      },
    });
    const dot = h('span', { class: 'ww-swatch-dot is-large' });
    dot.style.setProperty('--dot', entity.components.visual?.emissive ?? '#8a90b8');
    return h('div', { class: 'ww-entity-head' }, [
      dot,
      input,
      h(
        'button',
        {
          class: 'ww-icon-btn',
          title: 'Frame in viewport (F)',
          attrs: { type: 'button', 'aria-label': 'Frame in viewport' },
          on: { click: () => this.actions.focus(entity.id) },
        },
        [icon('focus')],
      ),
    ]);
  }

  private identity(world: World, entity: Entity): HTMLElement {
    const parent = entity.parentId ? world.entities[entity.parentId] : undefined;
    return section('Identity', [
      field('ID', mono(entity.id, 'ww-id')),
      field('Kind', mono(entity.kind)),
      field('Archetype', mono(entity.components.visual?.archetype ?? 'none')),
      field(
        'Parent',
        parent
          ? h('button', { class: 'ww-link', text: parent.name, attrs: { type: 'button' }, on: { click: () => this.actions.select(parent.id) } })
          : mono('world root'),
      ),
      entity.tags.length > 0 ? field('Tags', h('span', { class: 'ww-tags' }, entity.tags.map((t) => h('span', { class: 'ww-tag', text: t })))) : null,
    ]);
  }

  private transform(entity: Entity): HTMLElement {
    const t = entity.components.transform;
    const axisInput = (axis: 0 | 1 | 2) =>
      h('label', { class: 'ww-axis' }, [
        h('span', { class: `ww-axis-label axis-${'xyz'[axis]}`, text: 'XYZ'[axis] ?? '' }),
        // type="text" (not "number"): Chrome renders number inputs with the OS
        // locale's digits (e.g. Arabic-Indic), which made values unreadable.
        h('input', {
          class: 'ww-num',
          attrs: {
            type: 'text',
            inputmode: 'decimal',
            autocomplete: 'off',
            spellcheck: 'false',
            dir: 'ltr',
            value: fmt(t.position[axis]),
            'aria-label': `Position ${'XYZ'[axis]}`,
          },
          on: {
            keydown: (e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            },
            change: (e) => {
              const value = parseNumberInput((e.target as HTMLInputElement).value);
              const next = [...t.position] as [number, number, number];
              next[axis] = value;
              if (!Number.isFinite(value) || !this.move(entity, next)) {
                (e.target as HTMLInputElement).value = fmt(t.position[axis]);
              }
            },
          },
        }),
      ]);

    const yawValue = h('span', { class: 'ww-value', text: `${deg(t.rotation[1])}°` });
    const yaw = h('input', {
      class: 'ww-range',
      attrs: { type: 'range', min: '-180', max: '180', step: '1', value: String(deg(t.rotation[1])), 'aria-label': 'Rotation Y' },
      on: {
        input: (e) => (yawValue.textContent = `${(e.target as HTMLInputElement).value}°`),
        change: (e) => {
          const rad = (Number((e.target as HTMLInputElement).value) * Math.PI) / 180;
          this.actions.edit({ type: 'entity/transformed', id: entity.id, transform: { rotation: [t.rotation[0], rad, t.rotation[2]] } });
        },
      },
    });

    const nudge = (dy: number, label: string) =>
      h('button', {
        class: 'ww-btn is-small',
        text: label,
        attrs: { type: 'button' },
        on: { click: () => this.move(entity, [t.position[0], t.position[1] + dy, t.position[2]]) },
      });

    return section('Transform', [
      h('div', { class: 'ww-field is-stacked' }, [h('span', { class: 'ww-field-label', text: 'Position' }), h('div', { class: 'ww-axes' }, [axisInput(0), axisInput(1), axisInput(2)])]),
      h('div', { class: 'ww-field is-stacked' }, [
        h('span', { class: 'ww-field-label' }, ['Rotation Y ', yawValue]),
        yaw,
      ]),
      h('div', { class: 'ww-btn-row' }, [nudge(1, 'Raise +1'), nudge(-1, 'Lower −1')]),
      h('p', { class: 'ww-note', text: 'Position is relative to the parent entity.' }),
    ]);
  }

  private move(entity: Entity, position: Vec3): boolean {
    return this.actions.edit({ type: 'entity/transformed', id: entity.id, transform: { position } });
  }

  private appearance(entity: Entity, visual: VisualComponent): HTMLElement {
    const id = entity.id;
    const swatches = h(
      'div',
      { class: 'ww-swatches', attrs: { role: 'group', 'aria-label': 'Luminous palette' } },
      LUMINOUS_PALETTE.map((look) => {
        const active = look.color.toLowerCase() === visual.color.toLowerCase() && look.emissive.toLowerCase() === visual.emissive.toLowerCase();
        const button = h('button', {
          class: `ww-swatch${active ? ' is-active' : ''}`,
          title: look.name,
          attrs: { type: 'button', 'aria-label': `Apply ${look.name}`, 'aria-pressed': String(active) },
          on: { click: () => this.actions.edit({ type: 'entity/visualChanged', id, patch: { color: look.color, emissive: look.emissive } }) },
        });
        button.style.setProperty('--sw-a', look.color);
        button.style.setProperty('--sw-b', look.emissive);
        return button;
      }),
    );

    const colorPatch = (key: 'color' | 'emissive', value: ColorHex) => (key === 'color' ? { color: value } : { emissive: value });
    const colorInput = (key: 'color' | 'emissive', label: string) =>
      h('label', { class: 'ww-color' }, [
        h('input', {
          attrs: { type: 'color', value: visual[key], 'aria-label': label },
          on: {
            input: (e) => this.actions.preview(id, { ...visual, ...colorPatch(key, (e.target as HTMLInputElement).value as ColorHex) }),
            change: (e) => {
              const value = (e.target as HTMLInputElement).value as ColorHex;
              if (!this.actions.edit({ type: 'entity/visualChanged', id, patch: colorPatch(key, value) })) this.actions.revertPreview(id);
            },
          },
        }),
        h('span', { text: label }),
      ]);

    const glowValue = h('span', { class: 'ww-value', text: fmt(visual.emissiveIntensity) });
    const glow = h('input', {
      class: 'ww-range is-glow',
      attrs: { type: 'range', min: '0', max: String(Math.min(10, EMISSIVE_MAX)), step: '0.1', value: String(visual.emissiveIntensity), 'aria-label': 'Glow intensity' },
      on: {
        input: (e) => {
          const value = Number((e.target as HTMLInputElement).value);
          glowValue.textContent = fmt(value);
          this.actions.preview(id, { ...visual, emissiveIntensity: value });
        },
        change: (e) => {
          const value = Number((e.target as HTMLInputElement).value);
          if (!this.actions.edit({ type: 'entity/visualChanged', id, patch: { emissiveIntensity: value } })) this.actions.revertPreview(id);
        },
      },
    });

    return section('Appearance', [
      h('div', { class: 'ww-field is-stacked' }, [h('span', { class: 'ww-field-label', text: 'Luminous palette' }), swatches]),
      h('div', { class: 'ww-color-row' }, [colorInput('color', 'Base'), colorInput('emissive', 'Glow')]),
      h('div', { class: 'ww-field is-stacked' }, [h('span', { class: 'ww-field-label' }, ['Glow intensity ', glowValue]), glow]),
      toggle('Visible', visual.visible, (on) => this.actions.edit({ type: 'entity/visualChanged', id, patch: { visible: on } })),
    ]);
  }

  private protection(world: World, entity: Entity): HTMLElement {
    const hasChildren = childrenOf(world, entity.id).length > 0;
    const blocked = entity.pinned ? 'Unpin to allow removal.' : hasChildren ? 'Remove child entities first.' : null;
    const remove = h(
      'button',
      {
        class: 'ww-btn is-danger',
        attrs: { type: 'button', ...(blocked ? { disabled: '', title: blocked } : {}) },
        on: {
          click: () => {
            if (this.actions.edit({ type: 'entity/removed', id: entity.id })) {
              this.actions.select(null);
              this.actions.notify(`Removed "${entity.name}". Undo with Ctrl+Z.`);
            }
          },
        },
      },
      [icon('trash'), h('span', { text: 'Remove entity' })],
    );
    return section('Protection', [
      toggle('Pinned', entity.pinned, (on) => this.actions.edit({ type: 'entity/pinnedChanged', id: entity.id, pinned: on })),
      h('p', { class: 'ww-note' }, [
        'Pinned entities cannot be removed. ',
        h('span', { class: 'ww-chip is-planned', text: 'PLANNED' }),
        ' World Morph will preserve pinned entities.',
      ]),
      remove,
      blocked ? h('p', { class: 'ww-note', text: blocked }) : null,
    ]);
  }

  private provenance(entity: Entity): HTMLElement {
    const p = entity.provenance;
    return section(
      'Provenance',
      [
        field('Created by', h('span', { class: `ww-source is-${p.createdBy}`, text: p.createdBy })),
        field('Created at', mono(`#${p.createdAtSeq}`)),
        field('Last change', h('span', {}, [h('span', { class: `ww-source is-${p.lastModifiedBy}`, text: p.lastModifiedBy }), mono(` #${p.lastModifiedSeq}`)])),
        h('p', { class: 'ww-note' }, [h('span', { class: 'ww-chip is-planned', text: 'PLANNED' }), ' Full Causal Ledger provenance and explanations.']),
      ],
    );
  }
}

// ------------------------------------------------------------- builders

function section(title: string, children: Array<HTMLElement | null>): HTMLElement {
  return h('section', { class: 'ww-section' }, [h('h3', { class: 'ww-section-title', text: title }), ...children]);
}

function field(label: string, value: HTMLElement): HTMLElement {
  return h('div', { class: 'ww-field' }, [h('span', { class: 'ww-field-label', text: label }), value]);
}

function mono(text: string, extra = ''): HTMLElement {
  return h('span', { class: `ww-mono ${extra}`.trim(), text, title: text });
}

/** A switch whose checked state is reverted if the edit is rejected. */
function toggle(label: string, value: boolean, onChange: (value: boolean) => boolean): HTMLElement {
  return h('label', { class: 'ww-toggle' }, [
    h('span', { class: 'ww-field-label', text: label }),
    h('input', {
      attrs: { type: 'checkbox', role: 'switch', ...(value ? { checked: '' } : {}) },
      on: {
        change: (e) => {
          const input = e.target as HTMLInputElement;
          if (!onChange(input.checked)) input.checked = value;
        },
      },
    }),
    h('span', { class: 'ww-switch', attrs: { 'aria-hidden': 'true' } }),
  ]);
}
