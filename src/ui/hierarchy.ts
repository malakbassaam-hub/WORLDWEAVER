import { childrenOf } from '../core/reducer';
import type { Entity, EntityId, World } from '../core/types';
import type { StudioActions } from './actions';
import { clear, h, icon } from './dom';

/** Scene hierarchy: a tree of entities by parentId, with search and visibility toggles. */
export class HierarchyPanel {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly count: HTMLElement;
  private readonly collapsed = new Set<string>();
  private filter = '';
  private world: World | null = null;

  constructor(private readonly actions: StudioActions) {
    const search = h('input', {
      class: 'ww-search-input',
      attrs: { type: 'search', placeholder: 'Filter entities', 'aria-label': 'Filter entities', spellcheck: 'false' },
      on: {
        input: (e) => {
          this.filter = (e.target as HTMLInputElement).value.trim().toLowerCase();
          this.render();
        },
      },
    });
    this.count = h('span', { class: 'ww-panel-meta' });
    this.list = h('div', { class: 'ww-tree', attrs: { role: 'tree', 'aria-label': 'Scene hierarchy' } });
    this.element = h('section', { class: 'ww-panel ww-glass ww-hierarchy' }, [
      h('header', { class: 'ww-panel-head' }, [h('h2', { text: 'Scene' }), this.count]),
      h('label', { class: 'ww-search' }, [icon('search'), search]),
      this.list,
    ]);
    actions.selection.subscribe(() => this.render(true));
  }

  update(world: World): void {
    this.world = world;
    this.render();
  }

  private render(scrollToSelection = false): void {
    const world = this.world;
    if (!world) return;
    clear(this.list);
    const selected = this.actions.selection.get();
    const matches = (e: Entity) => !this.filter || e.name.toLowerCase().includes(this.filter) || e.kind.includes(this.filter);
    let shown = 0;

    const visit = (parent: EntityId | null, depth: number) => {
      for (const id of childrenOf(world, parent)) {
        const entity = world.entities[id];
        if (!entity) continue;
        const kids = childrenOf(world, id);
        const subtreeMatches = this.filter ? this.subtreeMatches(world, id, matches) : true;
        if (!subtreeMatches) continue;
        const isCollapsed = !this.filter && this.collapsed.has(id);
        if (matches(entity)) shown += 1;
        this.list.append(this.row(entity, depth, kids.length > 0, isCollapsed, id === selected));
        if (kids.length > 0 && !isCollapsed) visit(id, depth + 1);
      }
    };
    visit(null, 0);
    this.count.textContent = this.filter ? `${shown} / ${world.order.length}` : `${world.order.length} entities`;

    if (shown === 0) this.list.append(h('p', { class: 'ww-empty', text: 'No entities match this filter.' }));
    if (scrollToSelection) this.list.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
  }

  private subtreeMatches(world: World, id: EntityId, matches: (e: Entity) => boolean): boolean {
    const entity = world.entities[id];
    if (entity && matches(entity)) return true;
    return childrenOf(world, id).some((child) => this.subtreeMatches(world, child, matches));
  }

  private row(entity: Entity, depth: number, hasChildren: boolean, collapsed: boolean, selected: boolean): HTMLElement {
    const visual = entity.components.visual;
    const visible = visual?.visible ?? true;
    const toggle = hasChildren
      ? h(
          'button',
          {
            class: `ww-tree-toggle${collapsed ? '' : ' is-open'}`,
            attrs: { 'aria-label': collapsed ? 'Expand' : 'Collapse', type: 'button' },
            on: {
              click: (e) => {
                e.stopPropagation();
                if (collapsed) this.collapsed.delete(entity.id);
                else this.collapsed.add(entity.id);
                this.render();
              },
            },
          },
          [icon('chevron')],
        )
      : h('span', { class: 'ww-tree-toggle is-leaf' });

    const swatch = h('span', { class: 'ww-swatch-dot' });
    swatch.style.setProperty('--dot', visual?.emissive ?? '#8a90b8');

    const eye = h(
      'button',
      {
        class: `ww-row-action${visible ? '' : ' is-off'}`,
        title: visible ? 'Hide' : 'Show',
        attrs: { type: 'button', 'aria-label': `${visible ? 'Hide' : 'Show'} ${entity.name}` },
        on: {
          click: (e) => {
            e.stopPropagation();
            this.actions.edit({ type: 'entity/visualChanged', id: entity.id, patch: { visible: !visible } });
          },
        },
      },
      [icon(visible ? 'eye' : 'eyeOff')],
    );

    const row = h(
      'div',
      {
        class: `ww-tree-row${selected ? ' is-selected' : ''}${visible ? '' : ' is-hidden'}`,
        attrs: { role: 'treeitem', tabindex: '0', 'aria-selected': String(selected) },
        on: {
          click: () => this.actions.select(entity.id),
          dblclick: () => this.actions.focus(entity.id),
          keydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              this.actions.select(entity.id);
            }
          },
        },
      },
      [
        toggle,
        swatch,
        h('span', { class: 'ww-tree-name', text: entity.name }),
        entity.pinned ? h('span', { class: 'ww-pin-badge', title: 'Pinned' }, [icon('pin')]) : null,
        h('span', { class: 'ww-tree-kind', text: entity.kind }),
        eye,
      ],
    );
    row.style.setProperty('--depth', String(depth));
    return row;
  }
}
