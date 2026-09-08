/** Playback state machine tests (pure reducer). */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePlayback, type PlaybackAction } from './usePlayback';
import { buildStates } from '../engine/trace/fold';
import { executeProgram } from '../engine/execute';

function record(source: string) {
  const outcome = executeProgram(source);
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.events;
}

function dispatchAll(actions: PlaybackAction[]) {
  const { result } = renderHook(() => usePlayback());
  act(() => {
    for (const action of actions) result.current.dispatch(action);
  });
  return result.current;
}

describe('playback reducer', () => {
  const events = record('console.log("A");\nsetTimeout(() => console.log("B"), 0);');

  it('starts idle with an empty state', () => {
    const playback = dispatchAll([]);
    expect(playback.status).toBe('idle');
    expect(playback.trace).toBeNull();
    expect(playback.lastStep).toBe(0);
    expect(playback.current.stack).toEqual([]);
  });

  it('records, completes and auto-plays from the first step', () => {
    const playback = dispatchAll([{ type: 'run-start' }, { type: 'run-complete', events }]);
    expect(playback.status).toBe('playing');
    expect(playback.cursor).toBe(0);
    expect(playback.lastStep).toBe(events.length);
    expect(playback.canPause).toBe(true);
  });

  it('pauses and resumes', () => {
    const playback = dispatchAll([{ type: 'run-complete', events }, { type: 'pause' }]);
    expect(playback.status).toBe('paused');
    const resumed = dispatchAll([
      { type: 'run-complete', events },
      { type: 'pause' },
      { type: 'play' },
    ]);
    expect(resumed.status).toBe('playing');
  });

  it('ticks forward and marks done at the end', () => {
    const last = events.length;
    const playback = dispatchAll([
      { type: 'run-complete', events },
      ...Array.from({ length: last }, () => ({ type: 'tick' }) as PlaybackAction),
    ]);
    expect(playback.cursor).toBe(last);
    expect(playback.status).toBe('done');
  });

  it('steps forward and backward within bounds', () => {
    const playback = dispatchAll([
      { type: 'run-complete', events },
      { type: 'step', delta: 1 },
      { type: 'step', delta: 1 },
      { type: 'step', delta: -1 },
    ]);
    expect(playback.cursor).toBe(1);
    expect(playback.status).toBe('paused');
    const floored = dispatchAll([
      { type: 'run-complete', events },
      { type: 'step', delta: -1 },
    ]);
    expect(floored.cursor).toBe(0);
  });

  it('restart returns to the first step', () => {
    const playback = dispatchAll([
      { type: 'run-complete', events },
      { type: 'seek', cursor: 5 },
      { type: 'restart' },
    ]);
    expect(playback.cursor).toBe(0);
    expect(playback.status).toBe('ready');
  });

  it('stop clears the trace but keeps the speed', () => {
    const playback = dispatchAll([
      { type: 'speed', value: 4 },
      { type: 'run-complete', events },
      { type: 'stop' },
    ]);
    expect(playback.status).toBe('idle');
    expect(playback.trace).toBeNull();
    expect(playback.speed).toBe(4);
  });

  it('seeks clamp to the trace bounds', () => {
    const playback = dispatchAll([
      { type: 'run-complete', events },
      { type: 'seek', cursor: 99999 },
    ]);
    expect(playback.cursor).toBe(events.length);
    expect(playback.status).toBe('done');
  });

  it('computes step interval from speed', () => {
    const playback = dispatchAll([{ type: 'speed', value: 4 }]);
    expect(playback.stepIntervalMs).toBe(80);
  });

  it('run-failed shows the compile error state', () => {
    const playback = dispatchAll([
      { type: 'run-start' },
      { type: 'run-failed', error: { phase: 'syntax', message: 'Unexpected token', line: 3 } },
    ]);
    expect(playback.status).toBe('error');
    expect(playback.compileError?.line).toBe(3);
  });

  it('produces states consistent with buildStates', () => {
    const playback = dispatchAll([
      { type: 'run-complete', events },
      { type: 'seek', cursor: events.length },
    ]);
    expect(playback.current).toEqual(buildStates(events).at(-1));
  });
});
