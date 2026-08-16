/** Panel rendering tests. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CallStackPanel,
  ConsolePanel,
  EventLoopBadge,
  MicrotaskQueuePanel,
  TaskQueuePanel,
  TimelinePanel,
  WebApisPanel,
} from './panels';

describe('CallStackPanel', () => {
  it('renders frames in order and marks the top one as running', () => {
    render(
      <CallStackPanel
        frames={[
          { id: 1, name: '(global)' },
          { id: 2, name: 'outer' },
          { id: 3, name: 'inner' },
        ]}
      />,
    );
    const region = screen.getByRole('region', { name: 'Call Stack' });
    expect(region).toHaveTextContent('(global)');
    expect(region).toHaveTextContent('outer');
    expect(region).toHaveTextContent('inner');
    expect(region).toHaveTextContent('running');
    expect(screen.getByText('3')).toBeInTheDocument(); // count badge
  });

  it('shows an empty hint when the stack is empty', () => {
    render(<CallStackPanel frames={[]} />);
    expect(screen.getByText(/stack is empty/i)).toBeInTheDocument();
  });
});

describe('WebApisPanel', () => {
  it('lists pending timers with remaining time', () => {
    render(
      <WebApisPanel
        timers={[
          {
            timerId: 1,
            kind: 'timeout',
            delay: 100,
            remaining: 40,
            label: 'callback',
            dueTime: 100,
          },
          {
            timerId: 2,
            kind: 'interval',
            delay: 10,
            remaining: 0,
            label: 'tick',
            dueTime: 30,
          },
        ]}
      />,
    );
    const region = screen.getByRole('region', { name: /browser and async apis/i });
    expect(region).toHaveTextContent('setTimeout');
    expect(region).toHaveTextContent('setInterval');
    expect(region).toHaveTextContent('40ms');
  });
});

describe('queue panels', () => {
  it('renders microtask items and marks the next one', () => {
    render(<MicrotaskQueuePanel items={[{ id: 1, label: 'then' }, { id: 2, label: 'then' }]} />);
    const region = screen.getByRole('region', { name: 'Microtask Queue' });
    expect(region).toHaveTextContent('then');
    expect(region).toHaveTextContent('next');
  });

  it('renders task items separately from microtasks', () => {
    render(
      <TaskQueuePanel items={[{ id: 1, label: 'callback', timerId: 1, dueTime: 0 }]} />,
    );
    expect(screen.getByRole('region', { name: 'Task Queue' })).toHaveTextContent('callback');
    expect(screen.queryByRole('region', { name: 'Microtask Queue' })).not.toBeInTheDocument();
  });
});

describe('EventLoopBadge', () => {
  it('reflects the loop action and stack state', () => {
    render(<EventLoopBadge loop="drain-microtasks" stackEmpty />);
    expect(screen.getByRole('status', { name: /draining microtasks/i })).toBeInTheDocument();
    expect(screen.getByText(/stack empty/i)).toBeInTheDocument();
  });

  it('shows waiting state when idle', () => {
    render(<EventLoopBadge loop="idle" stackEmpty={false} />);
    expect(screen.getByRole('status', { name: /event loop: idle/i })).toBeInTheDocument();
  });
});

describe('ConsolePanel', () => {
  it('renders lines with severity icons', () => {
    render(
      <ConsolePanel
        lines={[
          { id: 1, level: 'log', text: 'hello' },
          { id: 2, level: 'error', text: 'boom' },
        ]}
      />,
    );
    const region = screen.getByRole('region', { name: /console output/i });
    expect(region).toHaveTextContent('hello');
    expect(region).toHaveTextContent('boom');
  });
});

describe('TimelinePanel', () => {
  it('renders entries and seeks on click', async () => {
    const onSeek = vi.fn();
    render(
      <TimelinePanel
        entries={[
          { id: 1, kind: 'start', text: 'Global execution starts', line: null },
          { id: 2, kind: 'console', text: 'console.log: A', line: 1 },
        ]}
        currentIndex={1}
        onSeekToEntry={onSeek}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /global execution starts/i }));
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it('marks the active entry with aria-current', () => {
    render(
      <TimelinePanel
        entries={[
          { id: 1, kind: 'start', text: 'Global execution starts', line: null },
          { id: 2, kind: 'console', text: 'console.log: A', line: 1 },
        ]}
        currentIndex={0}
        onSeekToEntry={() => {}}
      />,
    );
    expect(
      screen.getByRole('button', { name: /global execution starts/i }),
    ).toHaveAttribute('aria-current', 'step');
  });
});
