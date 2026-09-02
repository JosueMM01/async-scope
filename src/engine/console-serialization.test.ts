/** Console serialization and timeline message rendering. */
import { describe, expect, it } from 'vitest';
import { consoleText, run } from './test-utils';
import { eventToTimelineEntry } from './trace/messages';
import type { TraceEvent } from './types';

function ev(partial: Partial<TraceEvent> & { type: TraceEvent['type'] }): TraceEvent {
  return { line: 1, ...partial } as TraceEvent;
}

describe('console serialization', () => {
  it('prints strings raw at top level and quoted when nested', () => {
    const events = run('console.log("hello");\nconsole.log(["hello"]);');
    expect(consoleText(events)).toEqual(['hello', '["hello"]']);
  });

  it('prints numbers, booleans, null and undefined', () => {
    const events = run('console.log(1, -2.5, true, false, null, undefined);');
    expect(consoleText(events)).toEqual(['1 -2.5 true false null undefined']);
  });

  it('prints arrays and nested objects', () => {
    const events = run('console.log([1, 2, [3]]);\nconsole.log({ a: 1, b: { c: "x" } });');
    expect(consoleText(events)).toEqual(['[1, 2, [3]]', '{ a: 1, b: { c: "x" } }']);
  });

  it('prints functions with their names', () => {
    const events = run('function named() {}\nconsole.log(named, () => {});');
    expect(consoleText(events)).toEqual(['ƒ named() ƒ (anonymous)()']);
  });

  it('prints errors with name and message', () => {
    const events = run('console.log(new TypeError("bad type"));');
    expect(consoleText(events)).toEqual(['TypeError: bad type']);
  });

  it('handles circular references', () => {
    const events = run('const a = {};\na.self = a;\nconsole.log(a);');
    expect(consoleText(events)).toEqual(['{ self: [Circular] }']);
  });

  it('renders Map, Set, Date and RegExp', () => {
    const events = run(
      'console.log(new Map([["k", 1]]));\nconsole.log(new Set([1, 2]));\nconsole.log(/ab+c/gi);\nconsole.log(new Date(0));',
    );
    const texts = consoleText(events);
    expect(texts[0]).toMatch(/^Map\(1\) \{ "k" => 1 \}$/);
    expect(texts[1]).toMatch(/^Set\(2\) \{ 1, 2 \}$/);
    expect(texts[2]).toBe('/ab+c/gi');
    expect(texts[3]).toBe('1970-01-01T00:00:00.000Z');
  });

  it('truncates very long arrays', () => {
    const events = run('console.log(new Array(100).fill(7));');
    expect(consoleText(events)[0]).toContain('… +50');
  });

  it('renders sandbox promises with their state', () => {
    const events = run(
      'const p = Promise.resolve(5);\nconsole.log(p);\nconsole.log(Promise.reject(new Error("x")));',
    );
    const texts = consoleText(events);
    expect(texts[0]).toBe('Promise { 5 }');
    expect(texts[1]).toBe('Promise { <rejected> Error: x }');
  });

  it('supports warn and error levels', () => {
    const events = run('console.warn("careful");\nconsole.error("broken");');
    const levels = events
      .filter((e) => e.type === 'console')
      .map((e) => (e as { level: string }).level);
    expect(levels).toEqual(['warn', 'error']);
  });

  it('suggests alternatives for unsupported console methods', () => {
    const events = run('console.table([1]);');
    expect(consoleText(events)[0]).toContain('console.table');
  });
});

describe('timeline messages', () => {
  it('describes the global start and end', () => {
    expect(eventToTimelineEntry(ev({ type: 'execution:start' }), 1)?.text).toContain(
      'Global execution starts',
    );
    expect(eventToTimelineEntry(ev({ type: 'execution:end', ok: true }), 2)?.text).toContain(
      'Execution complete',
    );
  });

  it('describes stack pushes, pops, suspensions and resumes', () => {
    expect(
      eventToTimelineEntry(ev({ type: 'stack:push', frameId: 1, name: 'f', reason: 'call' }), 1)
        ?.text,
    ).toContain('Call f()');
    expect(
      eventToTimelineEntry(ev({ type: 'stack:push', frameId: 1, name: 'f', reason: 'resume' }), 1)
        ?.text,
    ).toContain('resumes');
    expect(
      eventToTimelineEntry(ev({ type: 'stack:pop', name: 'f', reason: 'suspend' }), 1)?.text,
    ).toContain('suspends');
    expect(
      eventToTimelineEntry(ev({ type: 'stack:pop', name: 'f', reason: 'return' }), 1)?.text,
    ).toContain('returns');
  });

  it('describes timer lifecycle', () => {
    expect(
      eventToTimelineEntry(
        ev({
          type: 'api:schedule',
          timerId: 1,
          kind: 'timeout',
          delay: 0,
          label: 'cb',
          dueTime: 0,
        }),
        1,
      )?.text,
    ).toContain('setTimeout');
    expect(eventToTimelineEntry(ev({ type: 'api:complete', timerId: 1 }), 1)?.text).toContain(
      'Task Queue',
    );
    expect(
      eventToTimelineEntry(ev({ type: 'task:dequeue', taskId: 1, label: 'cb' }), 1)?.text,
    ).toContain('Event Loop');
  });

  it('describes microtask events', () => {
    expect(
      eventToTimelineEntry(ev({ type: 'microtask:enqueue', id: 1, label: 'then' }), 1)?.text,
    ).toContain('Microtask Queue');
  });

  it('skips loc events', () => {
    expect(eventToTimelineEntry(ev({ type: 'loc', to: 3 }), 1)).toBeNull();
  });
});
