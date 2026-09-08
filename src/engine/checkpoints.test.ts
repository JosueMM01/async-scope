import { describe, expect, it } from 'vitest';
import { EXAMPLES } from './examples';
import { executeProgram } from './execute';
import { buildStates } from './trace/fold';
import { createTraceIndex, MAX_CHECKPOINTS } from './trace/checkpoints';
import type { TraceEvent } from './types';

describe('checkpoint trace index', () => {
  for (const example of EXAMPLES) {
    it(`reconstructs every snapshot forward and backward: ${example.name}`, () => {
      const outcome = executeProgram(example.code, { language: example.language });
      if (!outcome.ok) throw new Error(outcome.error.message);
      const expected = buildStates(outcome.events);
      const index = createTraceIndex(outcome.events);
      expect(index.checkpointCount).toBeLessThanOrEqual(MAX_CHECKPOINTS + 1);
      for (let cursor = 0; cursor < expected.length; cursor++) {
        expect(index.at(cursor)).toEqual(expected[cursor]);
        expect(index.at(expected.length - cursor - 1)).toEqual(expected.at(-cursor - 1));
      }
    });
  }

  it('bounds retained history slots linearly and preserves old materialized snapshots', () => {
    const trace: TraceEvent[] = Array.from({ length: 2000 }, (_, i) => ({
      type: 'console',
      line: 1,
      level: 'log',
      text: String(i),
    }));
    const before = performance.now();
    const legacy = buildStates(trace);
    const legacyMs = performance.now() - before;
    const start = performance.now();
    const index = createTraceIndex(trace);
    const indexedMs = performance.now() - start;
    const seekStart = performance.now();
    for (let i = 0; i < 500; i++) index.at((i * 137) % 2001);
    const seekBatchMs = performance.now() - seekStart;
    // Broad regression budgets, not a device-independent performance guarantee.
    expect(indexedMs).toBeLessThan(500);
    expect(seekBatchMs).toBeLessThan(1000);
    const legacySlots = legacy.reduce(
      (sum, state) => sum + state.console.length + state.timeline.length,
      0,
    );
    expect(index.retainedSlots).toBeLessThan(trace.length * 6);
    expect(index.retainedSlots).toBeLessThan(legacySlots / 100);
    const snapshot = index.at(1000);
    expect(index.at(2000)).toEqual(legacy[2000]);
    expect(index.at(0)).toEqual(legacy[0]);
    expect(snapshot).toEqual(legacy[1000]);
    console.info(
      JSON.stringify({
        events: trace.length,
        legacySlots,
        indexedSlots: index.retainedSlots,
        legacyMs,
        indexedMs,
        seekBatchMs,
      }),
    );
  });

  it('handles empty traces and invalid cursors', () => {
    const index = createTraceIndex([]);
    expect(index.at(-1)).toEqual(index.at(0));
    expect(index.at(Infinity)).toEqual(index.at(0));
    expect(index.at(100)).toEqual(index.at(0));
  });

  it('reconstructs dense queues and terminal failures across checkpoint boundaries', () => {
    for (const source of [
      'for(let i=0;i<150;i++) { setTimeout(() => console.log(i), i); queueMicrotask(() => console.log(i)); }',
      'function recurse() { recurse(); } recurse();',
      'while(true) { console.log("bounded"); }',
    ]) {
      const outcome = executeProgram(source);
      if (!outcome.ok) throw new Error(outcome.error.message);
      const expected = buildStates(outcome.events);
      const index = createTraceIndex(outcome.events);
      const retained = index.at(Math.floor(outcome.events.length / 2));
      for (let cursor = outcome.events.length; cursor >= 0; cursor -= 17) {
        expect(index.at(cursor)).toEqual(expected[cursor]);
      }
      expect(retained).toEqual(expected[Math.floor(outcome.events.length / 2)]);
      expect(index.checkpointCount).toBeLessThanOrEqual(MAX_CHECKPOINTS + 1);
      expect(index.retainedSlots).toBeLessThan(outcome.events.length * 25);
    }
  });
});
