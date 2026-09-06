import { describe, expect, it } from 'vitest';
import { executeProgram } from '../engine/execute';
import { boundWorkerResponse } from './protocol';
import { isRunRequest, isWorkerResponse, MAX_SOURCE_LENGTH, MAX_TRACE_EVENTS } from './protocol';

describe('worker protocol validation', () => {
  it('accepts bounded long output and terminal traces produced by the real engine', () => {
    for (const source of [
      'throw new Error("x".repeat(5000));',
      'console.log("a".repeat(500), "b".repeat(500), "c".repeat(500));',
      'for (let i = 0; i < 5000; i++) Promise.reject(i);',
      '',
    ]) {
      const outcome = executeProgram(source);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        const response = boundWorkerResponse({ type: 'trace', id: 1, events: outcome.events });
        expect(isWorkerResponse(response, 1)).toBe(true);
        expect(outcome.events.length).toBeLessThanOrEqual(MAX_TRACE_EVENTS);
        expect(outcome.events.at(-1)?.type).toBe('execution:end');
      }
    }
  });

  it('accepts valid requests and rejects oversized or malformed requests', () => {
    expect(
      isRunRequest({ type: 'run', id: 1, code: 'console.log(1)', language: 'javascript' }),
    ).toBe(true);
    expect(
      isRunRequest({
        type: 'run',
        id: 1,
        code: 'x'.repeat(MAX_SOURCE_LENGTH + 1),
        language: 'javascript',
      }),
    ).toBe(false);
    expect(isRunRequest({ type: 'run', id: 1, code: '', language: 'python' })).toBe(false);
  });

  it('validates trace schemas, ids and event limits', () => {
    expect(
      isWorkerResponse(
        {
          type: 'trace',
          id: 7,
          events: [
            { type: 'execution:start', line: null },
            { type: 'console', line: 1, level: 'log', text: '<img onerror=alert(1)>' },
            { type: 'execution:end', line: null, ok: true },
          ],
        },
        7,
      ),
    ).toBe(true);
    expect(isWorkerResponse({ type: 'trace', id: 8, events: [] }, 7)).toBe(false);
    expect(
      isWorkerResponse({ type: 'trace', id: 7, events: [{ type: 'console', line: 1 }] }, 7),
    ).toBe(false);
    expect(
      isWorkerResponse({ type: 'trace', id: 7, events: Array(MAX_TRACE_EVENTS + 1).fill({}) }, 7),
    ).toBe(false);
  });
});
