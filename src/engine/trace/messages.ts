/**
 * Human-readable timeline descriptions for trace events.
 *
 * `loc` events are intentionally omitted: the editor already highlights the
 * current line, and adding one timeline entry per statement would bury the
 * interesting events.
 */
import type { TimelineEntry, TimelineKind, TraceEvent } from '../types';

function truncate(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function eventToTimelineEntry(
  event: TraceEvent,
  id: number,
): TimelineEntry | null {
  const line = event.line;
  switch (event.type) {
    case 'execution:start':
      return entry(id, 'start', 'Global execution starts', line);
    case 'execution:end':
      return entry(
        id,
        'end',
        event.ok ? 'Execution complete — call stack is empty' : 'Execution finished with errors',
        line,
      );
    case 'stack:push':
      return entry(
        id,
        'stack',
        event.reason === 'resume'
          ? `${event.name} resumes after await`
          : `Call ${event.name}() — pushed onto the call stack`,
        line,
      );
    case 'stack:pop':
      switch (event.reason) {
        case 'return':
          return entry(id, 'stack', `${event.name}() returns — popped from the call stack`, line);
        case 'suspend':
          return entry(
            id,
            'stack',
            `${event.name} suspends at await — leaves the call stack`,
            line,
          );
        case 'error':
          return entry(id, 'stack', `${event.name} popped while the error unwinds`, line);
      }
      return null;
    case 'console':
      return entry(
        id,
        'console',
        `${event.level === 'log' ? 'console.log' : `console.${event.level}`}: ${truncate(event.text)}`,
        line,
      );
    case 'api:schedule':
      return entry(
        id,
        'api',
        event.kind === 'timeout'
          ? `Web API: setTimeout registered (${event.label}, ${event.delay}ms) → timer #${event.timerId}`
          : `Web API: setInterval registered (${event.label}, every ${event.delay}ms) → timer #${event.timerId}`,
        line,
      );
    case 'api:clear':
      return entry(id, 'api', `Web API: timer #${event.timerId} cleared`, line);
    case 'api:complete':
      return entry(
        id,
        'api',
        `Web API: timer #${event.timerId} finished waiting — callback goes to the Task Queue`,
        line,
      );
    case 'task:enqueue':
      return entry(id, 'task', `Task Queue: “${event.label}” enqueued`, line);
    case 'task:dequeue':
      return entry(id, 'task', `Event Loop: task “${event.label}” moves to the Call Stack`, line);
    case 'microtask:enqueue':
      return entry(id, 'microtask', `Microtask Queue: “${event.label}” enqueued`, line);
    case 'microtask:dequeue':
      return entry(id, 'microtask', `Microtask Queue: “${event.label}” runs`, line);
    case 'loop:turn':
      switch (event.action) {
        case 'drain-microtasks':
          return entry(
            id,
            'loop',
            'Event Loop: call stack empty — draining ALL microtasks first',
            line,
          );
        case 'run-task':
          return entry(id, 'loop', 'Event Loop: picking the next task from the Task Queue', line);
        case 'advance-time':
          return entry(id, 'loop', 'Event Loop: waiting — nothing to run yet', line);
        case 'idle':
          return entry(id, 'loop', 'Event Loop: idle', line);
      }
      return null;
    case 'time:advance':
      return entry(id, 'time', `Virtual clock advances to ${event.to}ms`, line);
    case 'error':
      return entry(id, 'error', truncate(event.message, 120), line);
    case 'loc':
      return null;
  }
}

function entry(id: number, kind: TimelineKind, text: string, line: number | null): TimelineEntry {
  return { id, kind, text, line };
}
