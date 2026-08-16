/** VisualizerApp integration-lite tests with a mocked recorder. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VisualizerApp } from './VisualizerApp';
import { useRecorder } from './useRecorder';
import { executeProgram } from '../engine/execute';
import type { CompileError, TraceEvent } from '../engine/types';

vi.mock('./useRecorder', () => ({
  useRecorder: vi.fn(),
}));

const mockedUseRecorder = vi.mocked(useRecorder);

type Callbacks = Parameters<typeof useRecorder>[0];

function mockRecorder(override?: Partial<Record<string, unknown>>) {
  const callbacks: Callbacks = {
    onTrace: () => {},
    onCompileError: () => {},
    onTimeout: () => {},
  };
  const run = vi.fn((code: string) => {
    if (override?.run) {
      (override.run as (code: string, cbs: Callbacks) => void)(code, callbacks);
      return;
    }
    const outcome = executeProgram(code);
    if (outcome.ok) callbacks.onTrace(outcome.events);
    else callbacks.onCompileError(outcome.error);
  });
  const stop = vi.fn();
  mockedUseRecorder.mockImplementation((cbs) => {
    callbacks.onTrace = cbs.onTrace;
    callbacks.onCompileError = cbs.onCompileError;
    callbacks.onTimeout = cbs.onTimeout;
    return { isRunning: () => false, run, stop };
  });
  return { run, stop };
}

describe('VisualizerApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecorder();
    window.localStorage.clear();
  });

  it('renders controls, mobile tabs, panels and the editor once', async () => {
    const user = userEvent.setup();
    render(<VisualizerApp />);
    expect(screen.getByRole('button', { name: /run/i })).toBeEnabled();
    // jsdom viewport is mobile: the editor tab is active first.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);

    await user.click(screen.getByRole('tab', { name: 'Stack & APIs' }));
    expect(screen.getByRole('region', { name: 'Call Stack' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /browser and async apis/i })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Queues' }));
    expect(screen.getByRole('region', { name: 'Microtask Queue' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Task Queue' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Console & Timeline' }));
    expect(screen.getByRole('region', { name: /console output/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /execution timeline/i })).toBeInTheDocument();
  });

  it('switches examples and updates the editor', async () => {
    const user = userEvent.setup();
    render(<VisualizerApp />);
    await user.selectOptions(screen.getByLabelText('Examples'), 'sync-call-stack');
    const editorText = document.querySelector('.cm-content')?.textContent ?? '';
    expect(editorText).toContain('greet');
  });

  it('switches mobile tabs', async () => {
    const user = userEvent.setup();
    render(<VisualizerApp />);
    await user.click(screen.getByRole('tab', { name: 'Queues' }));
    expect(screen.getByRole('tabpanel', { name: 'Queues' })).toBeInTheDocument();
  });

  it(
    'runs code and plays through to show console output in order',
    { timeout: 20_000 },
    async () => {
      const user = userEvent.setup();
      render(<VisualizerApp />);
      await user.selectOptions(screen.getByLabelText('Examples'), 'settimeout');
      await user.selectOptions(screen.getByLabelText('Speed'), '4');
      await user.click(screen.getByRole('tab', { name: 'Console & Timeline' }));
      const region = screen.getByRole('region', { name: /console output/i });
      await user.click(screen.getByRole('button', { name: /run/i }));
      await waitFor(
        () => {
          expect(region).toHaveTextContent('B');
          expect(screen.getByText(/finished/i)).toBeInTheDocument();
        },
        { timeout: 15_000 },
      );
      const lineTexts = [...region.querySelectorAll('.as-console-text')].map(
        (el) => el.textContent,
      );
      expect(lineTexts).toEqual(['A', 'C', 'B']);
    },
  );

  it('shows a clear banner for syntax errors', async () => {
    mockRecorder({
      run: (_code, cbs) => {
        const error: CompileError = {
          phase: 'syntax',
          message: 'Unexpected token (1:7)',
          line: 1,
        };
        cbs.onCompileError(error);
      },
    });
    const user = userEvent.setup();
    render(<VisualizerApp />);
    await user.click(screen.getByRole('button', { name: /run/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/syntax error/i);
    expect(alert).toHaveTextContent(/line 1/i);
  });

  it('stop resets the playback state', async () => {
    const user = userEvent.setup();
    render(<VisualizerApp />);
    await user.click(screen.getByRole('button', { name: /run/i }));
    await user.click(screen.getByRole('button', { name: /stop/i }));
    expect(screen.getByText(/ready/i)).toBeInTheDocument();
  });

  it(
    'renders the trace events list into the timeline',
    { timeout: 20_000 },
    async () => {
      const user = userEvent.setup();
      render(<VisualizerApp />);
      await user.selectOptions(screen.getByLabelText('Examples'), 'settimeout');
      await user.selectOptions(screen.getByLabelText('Speed'), '4');
      await user.click(screen.getByRole('button', { name: /run/i }));
      await user.click(screen.getByRole('tab', { name: 'Console & Timeline' }));
      const region = screen.getByRole('region', { name: /execution timeline/i });
      await waitFor(
        () => {
          expect(region).toHaveTextContent(/global execution starts/i);
          expect(region).toHaveTextContent(/setTimeout registered/i);
          expect(region).toHaveTextContent(/event loop/i);
        },
        { timeout: 15_000 },
      );
    },
  );
});

export type { TraceEvent };
