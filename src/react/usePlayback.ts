/**
 * Playback state machine for the visualizer.
 *
 * The trace is already recorded when playback starts, so Run/Pause/Resume/
 * Next/Previous/Restart/Seek are pure state transitions over an index into
 * the precomputed snapshot array. Stop clears everything.
 */
import { useCallback, useMemo, useReducer } from 'react';
import { buildStates, initialVisualizationState } from '../engine/trace/fold';
import type {
  CompileError,
  TraceEvent,
  VisualizationState,
} from '../engine/types';

export type PlaybackStatus =
  | 'idle'
  | 'recording'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'done'
  | 'error';

export interface PlaybackState {
  status: PlaybackStatus;
  trace: TraceEvent[] | null;
  cursor: number;
  speed: number;
  compileError: CompileError | null;
}

export type PlaybackAction =
  | { type: 'run-start' }
  | { type: 'run-failed'; error: CompileError }
  | { type: 'run-complete'; events: TraceEvent[] }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'tick' }
  | { type: 'step'; delta: 1 | -1 }
  | { type: 'seek'; cursor: number }
  | { type: 'restart' }
  | { type: 'stop' }
  | { type: 'speed'; value: number }
  | { type: 'recorder-timeout' };

export const BASE_STEP_MS = 320;
export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

const initialPlaybackState: PlaybackState = {
  status: 'idle',
  trace: null,
  cursor: 0,
  speed: 1,
  compileError: null,
};

export function playbackReducer(
  state: PlaybackState,
  action: PlaybackAction,
): PlaybackState {
  switch (action.type) {
    case 'run-start':
      return { ...state, status: 'recording', trace: null, cursor: 0, compileError: null };
    case 'run-failed':
      return { ...state, status: 'error', trace: null, cursor: 0, compileError: action.error };
    case 'recorder-timeout':
      return {
        ...state,
        status: 'error',
        trace: null,
        cursor: 0,
        compileError: {
          phase: 'internal',
          message: 'Recording timed out. The sandbox was stopped — try again or simplify the code.',
          line: null,
        },
      };
    case 'run-complete': {
      // Run auto-plays from the first snapshot; Pause is one click away.
      return { ...state, status: 'playing', trace: action.events, cursor: 0 };
    }
    case 'play': {
      if (!state.trace || state.trace.length === 0) return state;
      if (state.status !== 'ready' && state.status !== 'paused' && state.status !== 'done') {
        return state;
      }
      const last = state.trace.length;
      const cursor = state.cursor >= last ? 0 : state.cursor;
      return { ...state, status: 'playing', cursor };
    }
    case 'pause':
      return state.status === 'playing' ? { ...state, status: 'paused' } : state;
    case 'tick': {
      if (state.status !== 'playing' || !state.trace) return state;
      const next = state.cursor + 1;
      const last = state.trace.length;
      if (next >= last) return { ...state, cursor: last, status: 'done' };
      return { ...state, cursor: next };
    }
    case 'step': {
      if (!state.trace) return state;
      const last = state.trace.length;
      const next = Math.max(0, Math.min(last, state.cursor + action.delta));
      const done = next >= last;
      return { ...state, cursor: next, status: done ? 'done' : 'paused' };
    }
    case 'seek': {
      if (!state.trace) return state;
      const last = state.trace.length;
      const next = Math.max(0, Math.min(last, action.cursor));
      const done = next >= last;
      return { ...state, cursor: next, status: done ? 'done' : 'paused' };
    }
    case 'restart':
      if (!state.trace) return state;
      return { ...state, cursor: 0, status: 'ready' };
    case 'stop':
      return { ...initialPlaybackState, speed: state.speed };
    case 'speed':
      return { ...state, speed: action.value };
  }
}

export interface Playback extends PlaybackState {
  states: VisualizationState[];
  current: VisualizationState;
  lastStep: number;
  canPlay: boolean;
  canPause: boolean;
  canStep: boolean;
  dispatch: React.Dispatch<PlaybackAction>;
  stepIntervalMs: number;
}

export function usePlayback(): Playback {
  const [state, dispatch] = useReducer(playbackReducer, initialPlaybackState);

  const states = useMemo(
    () => (state.trace ? buildStates(state.trace) : [initialVisualizationState()]),
    [state.trace],
  );
  const lastStep = states.length - 1;

  const stepIntervalMs = BASE_STEP_MS / state.speed;

  const canPlay =
    !!state.trace &&
    state.trace.length > 0 &&
    (state.status === 'ready' || state.status === 'paused' || state.status === 'done');
  const canPause = state.status === 'playing';
  const canStep = !!state.trace && state.trace.length > 0 && state.status !== 'recording';

  const current = states[Math.min(state.cursor, lastStep)]!;

  const dispatch2 = useCallback(dispatch, []);

  return {
    ...state,
    states,
    current,
    lastStep,
    canPlay,
    canPause,
    canStep,
    dispatch: dispatch2,
    stepIntervalMs,
  };
}
