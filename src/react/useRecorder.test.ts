import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TraceEvent } from '../engine/types';
import { RUN_TIMEOUT_MS } from '../worker/protocol';
import { useRecorder, type RecorderCallbacks } from './useRecorder';

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();

  constructor() {
    FakeWorker.instances.push(this);
  }
}

function callbacks(): RecorderCallbacks {
  return {
    onTrace: vi.fn(),
    onCompileError: vi.fn(),
    onTimeout: vi.fn(),
  };
}

describe('useRecorder', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends language-aware runs and delivers matching traces', () => {
    const handlers = callbacks();
    const { result } = renderHook(() => useRecorder(handlers));

    act(() => result.current.run('const value: number = 1;', 'typescript'));
    const worker = FakeWorker.instances[0]!;
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: 'run',
      id: 1,
      code: 'const value: number = 1;',
      language: 'typescript',
    });
    expect(result.current.isRunning()).toBe(true);

    const events: TraceEvent[] = [
      { type: 'execution:start', line: null },
      { type: 'execution:end', ok: true, line: null },
    ];
    act(() => worker.onmessage?.({ data: { type: 'trace', id: 1, events } } as MessageEvent));

    expect(handlers.onTrace).toHaveBeenCalledWith(events);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(result.current.isRunning()).toBe(false);
  });

  it('rejects malformed worker responses and terminates the sandbox', () => {
    const handlers = callbacks();
    const { result } = renderHook(() => useRecorder(handlers));
    act(() => result.current.run('console.log(1)', 'javascript'));
    const worker = FakeWorker.instances[0]!;

    act(() =>
      worker.onmessage?.({
        data: { type: 'trace', id: 1, events: [{ type: 'unknown' }] },
      } as MessageEvent),
    );

    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(handlers.onTrace).not.toHaveBeenCalled();
    expect(handlers.onCompileError).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'internal' }),
    );
  });

  it('drops stale responses and terminates the previous worker', () => {
    const handlers = callbacks();
    const { result } = renderHook(() => useRecorder(handlers));

    act(() => result.current.run('console.log(1)', 'javascript'));
    const first = FakeWorker.instances[0]!;
    act(() => result.current.run('console.log(2)', 'javascript'));
    expect(first.terminate).toHaveBeenCalledOnce();

    act(() => first.onmessage?.({ data: { type: 'trace', id: 1, events: [] } } as MessageEvent));
    expect(handlers.onTrace).not.toHaveBeenCalled();

    act(() => first.onerror?.());
    expect(handlers.onTimeout).not.toHaveBeenCalled();
    expect(result.current.isRunning()).toBe(true);
  });

  it('cleans up an accepted run before invoking reentrant callbacks', () => {
    const handlers = callbacks();
    const { result } = renderHook(() => useRecorder(handlers));
    vi.mocked(handlers.onTrace).mockImplementation(() => {
      result.current.run('console.log("replacement")', 'javascript');
    });

    act(() => result.current.run('console.log("first")', 'javascript'));
    const first = FakeWorker.instances[0]!;
    act(() => first.onmessage?.({ data: { type: 'trace', id: 1, events: [] } } as MessageEvent));

    expect(first.terminate).toHaveBeenCalledOnce();
    expect(FakeWorker.instances).toHaveLength(2);
    expect(result.current.isRunning()).toBe(true);
  });

  it('terminates a hung worker when the watchdog expires', () => {
    vi.useFakeTimers();
    const handlers = callbacks();
    const { result } = renderHook(() => useRecorder(handlers));

    act(() => result.current.run('while (true) {}', 'javascript'));
    const worker = FakeWorker.instances[0]!;
    act(() => vi.advanceTimersByTime(RUN_TIMEOUT_MS));

    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(handlers.onTimeout).toHaveBeenCalledOnce();
    expect(result.current.isRunning()).toBe(false);
  });

  it('reports worker failures and stop terminates an active run', () => {
    const handlers = callbacks();
    const { result } = renderHook(() => useRecorder(handlers));

    act(() => result.current.run('console.log(1)', 'javascript'));
    const failed = FakeWorker.instances[0]!;
    act(() => failed.onerror?.());
    expect(handlers.onTimeout).toHaveBeenCalledOnce();

    act(() => result.current.run('console.log(2)', 'javascript'));
    const active = FakeWorker.instances[1]!;
    act(() => result.current.stop());
    expect(active.terminate).toHaveBeenCalledOnce();
  });
});
