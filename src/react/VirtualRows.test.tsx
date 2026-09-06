import { useRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VirtualRows } from './VirtualRows';
import { ConsolePanel, TimelinePanel } from './panels';

afterEach(() => vi.restoreAllMocks());

function layout() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 600, 300),
  );
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600);
  HTMLElement.prototype.scrollTo = vi.fn();
}

function Harness({
  enabled = true,
  followIndex = null,
}: {
  enabled?: boolean;
  followIndex?: number | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={scrollRef}>
      <VirtualRows
        count={120}
        scrollRef={scrollRef}
        followIndex={followIndex}
        enabled={enabled}
        label="Rows"
        renderRow={(index) => <li key={index}>Row {index}</li>}
      />
    </div>
  );
}

it('renders a bounded measured window and exposes full rows when disabled', async () => {
  layout();
  const { rerender } = render(<Harness />);
  await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
  expect(screen.getAllByRole('listitem').length).toBeLessThan(50);
  expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('aria-setsize', '120');
  rerender(<Harness followIndex={119} />);
  await waitFor(() => expect(HTMLElement.prototype.scrollTo).toHaveBeenCalled());
  rerender(<Harness enabled={false} />);
  expect(screen.getAllByRole('listitem')).toHaveLength(120);
}, 10_000);

it('lets console and timeline users opt out and return to windowed rows', async () => {
  layout();
  const user = userEvent.setup();
  render(
    <>
      <ConsolePanel
        lines={Array.from({ length: 110 }, (_, id) => ({ id, level: 'log', text: `line ${id}` }))}
      />
      <TimelinePanel
        entries={Array.from({ length: 110 }, (_, id) => ({
          id,
          kind: 'console',
          text: `entry ${id}`,
          line: 1,
        }))}
        currentIndex={109}
        onSeekToEntry={vi.fn()}
      />
    </>,
  );
  for (const button of screen.getAllByRole('button', { name: 'Show all rows' }))
    await user.click(button);
  expect(screen.getAllByRole('listitem')).toHaveLength(220);
  for (const button of screen.getAllByRole('button', { name: 'Window rows' }))
    await user.click(button);
  expect(screen.getAllByRole('listitem').length).toBeLessThan(100);
}, 10_000);
