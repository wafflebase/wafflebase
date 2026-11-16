import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TabBar } from '@/components/tab-bar';
import type { TabMeta } from '@/types/worksheet';

const THREE_TABS: TabMeta[] = [
  { id: 'tab-1', name: 'Sheet1', type: 'sheet' },
  { id: 'tab-2', name: 'Sheet2', type: 'sheet' },
  { id: 'tab-3', name: 'Orders', type: 'datasource' },
];

function renderTabBar(
  props: Partial<React.ComponentProps<typeof TabBar>> = {},
) {
  const handlers = {
    onSelectTab: vi.fn(),
    onAddTab: vi.fn(),
    onRenameTab: vi.fn(() => true),
    onDeleteTab: vi.fn(),
    onMoveTab: vi.fn(),
    onDuplicateTab: vi.fn(),
  };
  render(
    <TabBar
      tabs={THREE_TABS}
      activeTabId="tab-2"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
}

describe('TabBar', () => {
  it('adds a sheet directly from the + button, like Google', () => {
    const { onAddTab } = renderTabBar();

    fireEvent.click(screen.getByRole('button', { name: 'Add sheet' }));

    expect(onAddTab).toHaveBeenCalledWith('sheet');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it.each([
    [/Connect data source/, 'datasource'],
    [/Connect lakehouse table/, 'lakehouse'],
  ] as const)(
    'keeps the other tab kinds behind the adjacent menu: %s',
    async (label, type) => {
      const { onAddTab } = renderTabBar();

      openMenu(screen.getByRole('button', { name: 'More tab types' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: label }));

      expect(onAddTab).toHaveBeenCalledWith(type);
    },
  );

  it('exposes the tabs as a tablist with the active one selected', () => {
    renderTabBar();

    const tablist = screen.getByRole('tablist', { name: 'Sheets' });
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tablist.contains(tabs[0])).toBe(true);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    // Roving focus: only the active tab is in the Tab order.
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('moves between tabs with the arrow keys', () => {
    const { onSelectTab } = renderTabBar();

    const active = screen.getByRole('tab', { name: /Sheet2/ });
    fireEvent.keyDown(active, { key: 'ArrowRight' });
    expect(onSelectTab).toHaveBeenLastCalledWith('tab-3');

    fireEvent.keyDown(active, { key: 'ArrowLeft' });
    expect(onSelectTab).toHaveBeenLastCalledWith('tab-1');
  });

  it('duplicates a sheet tab from its context menu', async () => {
    const { onDuplicateTab } = renderTabBar();

    fireEvent.contextMenu(screen.getByRole('tab', { name: /Sheet1/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));

    expect(onDuplicateTab).toHaveBeenCalledWith('tab-1');
  });

  it('does not offer Duplicate on a data source tab', async () => {
    renderTabBar();

    fireEvent.contextMenu(screen.getByRole('tab', { name: /Orders/ }));

    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Duplicate' })).toBeNull();
  });

  it('moves a tab left or right from its context menu', async () => {
    const { onMoveTab } = renderTabBar();

    fireEvent.contextMenu(screen.getByRole('tab', { name: /Sheet2/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move right' }));
    expect(onMoveTab).toHaveBeenLastCalledWith(1, 2);

    fireEvent.contextMenu(screen.getByRole('tab', { name: /Sheet2/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move left' }));
    expect(onMoveTab).toHaveBeenLastCalledWith(1, 0);
  });

  it('disables moving past either end', async () => {
    renderTabBar();

    fireEvent.contextMenu(screen.getByRole('tab', { name: /Sheet1/ }));
    expect(
      (await screen.findByRole('menuitem', { name: 'Move left' })).getAttribute(
        'aria-disabled',
      ),
    ).toBe('true');
    expect(
      screen
        .getByRole('menuitem', { name: 'Move right' })
        .getAttribute('aria-disabled'),
    ).toBeNull();
  });
});
