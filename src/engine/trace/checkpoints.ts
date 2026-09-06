import type { ConsoleLine, TimelineEntry, TraceEvent, VisualizationState } from '../types';
import { initialVisualizationState, reduceVisualizationState } from './fold';
import { eventToTimelineEntry } from './messages';

/** Fixed checkpoint count bounds retained queue snapshots even for dense traces. */
export const MAX_CHECKPOINTS = 16;

export function createTraceIndex(events: readonly TraceEvent[]) {
  const interval = Math.max(1, Math.ceil(events.length / MAX_CHECKPOINTS));
  const checkpoints = new Map<number, VisualizationState>();
  const consoleLines: ConsoleLine[] = [];
  const timeline: TimelineEntry[] = [];
  const consoleCounts = [0];
  const timelineCounts = [0];
  let current = initialVisualizationState();
  checkpoints.set(0, current);
  const counters = { console: 0, timeline: 0 };

  events.forEach((event, index) => {
    if (event.type === 'console') {
      consoleLines.push({ id: consoleLines.length + 1, level: event.level, text: event.text });
    } else {
      current = reduceVisualizationState(current, event, counters);
    }
    const entry = eventToTimelineEntry(event, index + 1);
    if (entry) timeline.push(entry);
    consoleCounts.push(consoleLines.length);
    timelineCounts.push(timeline.length);
    if ((index + 1) % interval === 0) checkpoints.set(index + 1, current);
  });

  return {
    length: events.length + 1,
    interval,
    checkpointCount: checkpoints.size,
    /** Exact retained array slots, useful for reproducible memory budgets. */
    retainedSlots:
      events.length +
      consoleLines.length +
      timeline.length +
      consoleCounts.length +
      timelineCounts.length +
      [...checkpoints.values()].reduce(
        (sum, state) =>
          sum +
          state.stack.length +
          state.apis.length +
          state.tasks.length +
          state.microtasks.length,
        0,
      ),
    at(cursor: number): VisualizationState {
      const target = Number.isFinite(cursor)
        ? Math.max(0, Math.min(events.length, Math.trunc(cursor)))
        : 0;
      const start = Math.floor(target / interval) * interval;
      let state = checkpoints.get(start)!;
      for (let i = start; i < target; i++) {
        const event = events[i]!;
        if (event.type !== 'console') state = reduceVisualizationState(state, event, counters);
      }
      return {
        ...state,
        console: consoleLines.slice(0, consoleCounts[target]),
        timeline: timeline.slice(0, timelineCounts[target]),
      };
    },
  };
}
