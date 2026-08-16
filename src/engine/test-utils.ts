/** Shared helpers for engine tests. */
import { expect } from 'vitest';
import { executeProgram } from './execute';
import type { RunOutcome, TraceEvent, VisualizationState } from './types';
import { buildStates } from './trace/fold';

/** Executes a program that must compile, returning its events. */
export function run(source: string): TraceEvent[] {
  const outcome = executeProgram(source);
  if (!outcome.ok) {
    throw new Error(`compile failed: ${outcome.error.phase}: ${outcome.error.message}`);
  }
  return outcome.events;
}

/** Executes a program and asserts it compiles; returns the outcome. */
export function runOutcome(source: string): Extract<RunOutcome, { ok: true }> {
  const outcome = executeProgram(source);
  expect(outcome.ok).toBe(true);
  return outcome as Extract<RunOutcome, { ok: true }>;
}

type ConsoleEvent = Extract<TraceEvent, { type: 'console' }>;

/** Extracts console output in order. */
export function consoleText(events: TraceEvent[]): string[] {
  return events
    .filter((e): e is ConsoleEvent => e.type === 'console')
    .map((e) => e.text);
}

/** Extracts event type sequence. */
export function typeSeq(events: TraceEvent[]): string[] {
  return events.map((e) => e.type);
}

/** Builds the visualization states for an execution. */
export function statesFor(source: string): VisualizationState[] {
  return buildStates(run(source));
}

/** Finds the first event of a type. */
export function firstOf<T extends TraceEvent['type']>(
  events: TraceEvent[],
  type: T,
): Extract<TraceEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<TraceEvent, { type: T }> => e.type === type);
}

/** Collects all events of a type. */
export function allOf<T extends TraceEvent['type']>(
  events: TraceEvent[],
  type: T,
): Array<Extract<TraceEvent, { type: T }>> {
  return events.filter((e): e is Extract<TraceEvent, { type: T }> => e.type === type);
}
