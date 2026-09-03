import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ResizeHandle } from './ResizeHandle';

function renderHandle(orientation: 'horizontal' | 'vertical' = 'vertical') {
  const callbacks = {
    onPointerDelta: vi.fn(),
    onDecrease: vi.fn(),
    onIncrease: vi.fn(),
    onMinimum: vi.fn(),
    onMaximum: vi.fn(),
  };
  render(
    <ResizeHandle
      orientation={orientation}
      label="Resize editor"
      valueNow={40}
      valueMin={28}
      valueMax={58}
      {...callbacks}
    />,
  );
  return callbacks;
}

describe('ResizeHandle', () => {
  it('exposes its range and supports keyboard resizing', async () => {
    const user = userEvent.setup();
    const callbacks = renderHandle();
    const separator = screen.getByRole('separator', { name: 'Resize editor' });

    expect(separator).toHaveAttribute('aria-valuemin', '28');
    expect(separator).toHaveAttribute('aria-valuemax', '58');
    expect(separator).toHaveAttribute('aria-valuenow', '40');

    separator.focus();
    await user.keyboard('{ArrowLeft}{ArrowRight}{Home}{End}');
    expect(callbacks.onDecrease).toHaveBeenCalledOnce();
    expect(callbacks.onIncrease).toHaveBeenCalledOnce();
    expect(callbacks.onMinimum).toHaveBeenCalledOnce();
    expect(callbacks.onMaximum).toHaveBeenCalledOnce();
  });

  it('reports pointer movement deltas and cleans up its resize state', () => {
    const callbacks = renderHandle('horizontal');
    const separator = screen.getByRole('separator', { name: 'Resize editor' });

    fireEvent.pointerDown(separator, { button: 0, clientY: 200 });
    fireEvent.pointerMove(window, { clientY: 180 });
    expect(callbacks.onPointerDelta).toHaveBeenCalledWith(-20);
    expect(document.body).toHaveClass('as-is-resizing');

    fireEvent.pointerUp(window);
    expect(document.body).not.toHaveClass('as-is-resizing');
  });
});
