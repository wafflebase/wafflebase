import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TabBar } from '@/components/tab-bar';

describe('TabBar', () => {
  it('routes New Lakehouse through the lakehouse tab flow', async () => {
    const onAddTab = vi.fn();
    render(
      <TabBar
        tabs={[{ id: 'tab-1', name: 'Sheet1', type: 'sheet' }]}
        activeTabId="tab-1"
        onSelectTab={() => undefined}
        onAddTab={onAddTab}
        onRenameTab={() => true}
        onDeleteTab={() => undefined}
      />,
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Add tab' }), {
      button: 0,
      pointerType: 'mouse',
    });
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /New Lakehouse/ }),
    );

    expect(onAddTab).toHaveBeenCalledWith('lakehouse');
  });
});
