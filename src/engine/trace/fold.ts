/**
 * Folds a recorded event trace into an array of immutable visualization
 * snapshots — one per step, plus the initial state.
 *
 * Stepping the UI is therefore trivial (and deterministic): "previous step"
 * is just index - 1, with no runtime reversal needed.
 */
import type {
  ApiTimer,
  ConsoleLine,
  TaskItem,
  TimelineEntry,
  TraceEvent,
  VisualizationState,
} from '../types';
import { eventToTimelineEntry } from './messages';

export function initialVisualizationState(): VisualizationState {
  return {
    status: 'running',
    stack: [],
    microtasks: [],
    tasks: [],
    apis: [],
    console: [],
    timeline: [],
    currentLine: null,
    virtualTime: 0,
    loop: 'idle',
    error: null,
  };
}

/** Applies a single event to a state, returning the next immutable state. */
export function reduceVisualizationState(
  state: VisualizationState,
  event: TraceEvent,
  counters: { console: number; timeline: number },
): VisualizationState {
  switch (event.type) {
    case 'execution:start':
      return { ...state, status: 'running' };
    case 'execution:end':
      return {
        ...state,
        status: event.ok ? 'complete' : 'error',
        loop: 'idle',
      };
    case 'stack:push':
      return {
        ...state,
        stack: [...state.stack, { id: event.frameId, name: event.name }],
      };
    case 'stack:pop':
      return { ...state, stack: state.stack.slice(0, -1) };
    case 'loc':
      return { ...state, currentLine: event.to };
    case 'console': {
      const line: ConsoleLine = { id: ++counters.console, level: event.level, text: event.text };
      return { ...state, console: [...state.console, line] };
    }
    case 'api:schedule': {
      const timer: ApiTimer = {
        timerId: event.timerId,
        kind: event.kind,
        delay: event.delay,
        remaining: Math.max(0, event.dueTime - state.virtualTime),
        label: event.label,
        dueTime: event.dueTime,
      };
      return { ...state, apis: [...state.apis, timer] };
    }
    case 'api:clear':
      return { ...state, apis: state.apis.filter((t) => t.timerId !== event.timerId) };
    case 'api:complete':
      return { ...state, apis: state.apis.filter((t) => t.timerId !== event.timerId) };
    case 'task:enqueue': {
      const task: TaskItem = {
        id: event.taskId,
        timerId: event.timerId,
        label: event.label,
        dueTime: event.dueTime,
      };
      return { ...state, tasks: [...state.tasks, task] };
    }
    case 'task:dequeue':
      return { ...state, tasks: state.tasks.filter((t) => t.id !== event.taskId) };
    case 'microtask:enqueue':
      return {
        ...state,
        microtasks: [...state.microtasks, { id: event.id, label: event.label }],
      };
    case 'microtask:dequeue':
      return {
        ...state,
        microtasks: state.microtasks.filter((m) => m.id !== event.id),
      };
    case 'loop:turn':
      return { ...state, loop: event.action };
    case 'time:advance':
      return {
        ...state,
        virtualTime: event.to,
        apis: state.apis.map((t) => ({ ...t, remaining: Math.max(0, t.dueTime - event.to) })),
      };
    case 'error':
      return {
        ...state,
        error: { message: event.message, kind: event.kind, line: event.line },
      };
  }
}

/**
 * Builds every visualization state for a trace. `states[i]` is the state
 * after applying `events[0..i-1]`; `states.length === events.length + 1`.
 */
export function buildStates(events: TraceEvent[]): VisualizationState[] {
  const counters = { console: 0, timeline: 0 };
  const states: VisualizationState[] = [initialVisualizationState()];
  let current = states[0]!;

  for (const event of events) {
    current = reduceVisualizationState(current, event, counters);
    const timelineEntry = eventToTimelineEntry(event, ++counters.timeline);
    if (timelineEntry) {
      current = { ...current, timeline: [...current.timeline, timelineEntry] };
    }
    states.push(current);
  }
  return states;
}
