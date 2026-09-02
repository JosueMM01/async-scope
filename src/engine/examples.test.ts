/** Every built-in example must compile and run cleanly through the same engine. */
import { describe, expect, it } from 'vitest';
import { executeProgram } from './execute';
import { EXAMPLES, getExample } from './examples';
import { buildStates } from './trace/fold';
import { consoleText } from './test-utils';

describe('examples', () => {
  it('has unique ids', () => {
    const ids = EXAMPLES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('falls back to the default example for unknown ids', () => {
    expect(getExample('does-not-exist').id).toBe(EXAMPLES[0]!.id);
  });

  for (const example of EXAMPLES) {
    it(`runs "${example.name}" without internal errors`, () => {
      const outcome = executeProgram(example.code, { language: example.language });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const internal = outcome.events.filter(
        (e) => e.type === 'error' && (e as { message: string }).message.includes('Internal'),
      );
      expect(internal).toEqual([]);
      // The fold must also succeed for every example.
      const states = buildStates(outcome.events);
      expect(states.length).toBeGreaterThan(1);
    });
  }

  it('welcome example prints the documented order', () => {
    const outcome = executeProgram(getExample('welcome').code);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(consoleText(outcome.events)).toEqual([
        'Start',
        'Before await',
        'End',
        'Promise',
        'After await',
        'Timeout',
      ]);
    }
  });

  it('mixed event loop example prints its documented order', () => {
    const outcome = executeProgram(getExample('mixed-event-loop').code);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(consoleText(outcome.events)).toEqual([
        '1: sync start',
        '2: async starts synchronously',
        '2b: sync end',
        '3: microtask',
        '3c: after await',
        '3b: chained microtask',
        '4: task',
      ]);
    }
  });
});
