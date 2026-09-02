/**
 * VirtualScheduler: a deterministic, recordable model of the browser's
 * asynchronous machinery.
 *
 * Owns the microtask queue, the task queue, the "Web APIs" timer table and a
 * virtual clock. The whole program — including every microtask and task — runs
 * synchronously during recording; timers never actually wait, the clock just
 * jumps to the next due time. The result is a fully ordered event trace that
 * the UI can scrub back and forth.
 */
import { LimitError, formatThrownValue } from '../errors';
import type {
  EngineLimits,
  Frame,
  LoopAction,
  StackPopReason,
  TimerKind,
  TraceEvent,
} from '../types';
import type { PromiseHost } from './promise';

interface MicrotaskJob {
  id: number;
  label: string;
  run: () => void;
}

interface ReadyTask {
  taskId: number;
  timerId: number;
  label: string;
  callback: () => void;
}

interface TimerEntry {
  timerId: number;
  kind: TimerKind;
  /** Delay as requested by the user (for display). */
  delay: number;
  /** Interval period for `setInterval`. */
  period: number | null;
  dueTime: number;
  seq: number;
  label: string;
  callback: () => void;
}

interface UnhandledEntry {
  promise: object;
  reason: unknown;
}

type WithoutLine<T> = T extends TraceEvent ? Omit<T, 'line'> : never;
type EventPayload = WithoutLine<TraceEvent>;

export class VirtualScheduler implements PromiseHost {
  readonly events: TraceEvent[] = [];
  private readonly limits: EngineLimits;

  /** Source line of the statement currently executing. */
  line: number | null = null;

  private readonly frames: Frame[] = [];
  private frameSeq = 0;

  private readonly microtasks: MicrotaskJob[] = [];
  private microSeq = 0;
  private microtasksRun = 0;

  private readonly tasks: ReadyTask[] = [];
  private taskSeq = 0;
  private tasksRun = 0;

  private readonly timers = new Map<number, TimerEntry>();
  private timerSeq = 0;

  private readonly unhandled: UnhandledEntry[] = [];

  private ticks = 0;
  private readonly startedAt = Date.now();

  virtualTime = 0;
  fatal: LimitError | null = null;
  hadError = false;

  constructor(limits: EngineLimits) {
    this.limits = limits;
  }

  // ── Event emission ────────────────────────────────────────────────────────

  pushEvent(payload: EventPayload): void {
    if (this.events.length >= this.limits.maxEvents) {
      throw new LimitError(
        `Recording stopped: the trace exceeded ${this.limits.maxEvents} events.`,
      );
    }
    this.events.push({ ...payload, line: this.line } as TraceEvent);
  }

  /**
   * Pushes an event without the cap check. Reserved for terminal events
   * (the final error and execution:end) so a trace at its cap still ends
   * coherently.
   */
  pushTerminalEvent(payload: EventPayload): void {
    this.events.push({ ...payload, line: this.line } as TraceEvent);
  }

  /** Budget guard invoked per statement, loop iteration and function entry. */
  tick(): void {
    if (++this.ticks > this.limits.maxTicks) {
      throw new LimitError(
        'Execution stopped: the step budget was exceeded (possible infinite loop).',
      );
    }
    if ((this.ticks & 0x3ff) === 0 && Date.now() - this.startedAt > this.limits.wallClockMs) {
      throw new LimitError(
        `Execution stopped: recording exceeded ${this.limits.wallClockMs / 1000}s of CPU time.`,
      );
    }
  }

  // ── Call stack ─────────────────────────────────────────────────────────────

  private nextFrameId(): number {
    return ++this.frameSeq;
  }

  enterFrame(name: string): void {
    this.tick();
    if (this.frames.length >= this.limits.maxStackDepth) {
      const error = new RangeError('Maximum call stack size exceeded');
      error.name = 'RangeError';
      throw error;
    }
    const frame: Frame = { id: this.nextFrameId(), name };
    this.frames.push(frame);
    this.pushEvent({ type: 'stack:push', frameId: frame.id, name, reason: 'call' });
  }

  exitFrame(): void {
    const frame = this.frames.pop();
    if (frame) {
      this.pushEvent({ type: 'stack:pop', name: frame.name, reason: 'return' });
    }
  }

  /** Pops the top frame when an async function suspends at `await`. */
  suspendTopFrame(name: string): void {
    const frame = this.frames.pop();
    if (frame) {
      this.pushEvent({ type: 'stack:pop', name: frame.name, reason: 'suspend' });
    } else {
      // Defensive: suspension without a matching frame should not lose the name.
      this.pushEvent({ type: 'stack:pop', name, reason: 'suspend' });
    }
  }

  /** Re-pushes the frame of an async function resuming after `await`. */
  resumeFrame(name: string): void {
    this.tick();
    const frame: Frame = { id: this.nextFrameId(), name };
    this.frames.push(frame);
    this.pushEvent({ type: 'stack:push', frameId: frame.id, name, reason: 'resume' });
  }

  private unwindFrames(): void {
    while (this.frames.length > 0) {
      const frame = this.frames.pop()!;
      this.pushTerminalEvent({
        type: 'stack:pop',
        name: frame.name,
        reason: 'error' as StackPopReason,
      });
    }
  }

  // ── Microtask queue (host surface for SandboxPromise) ─────────────────────

  enqueueMicrotask(run: () => void, label: string): void {
    if (this.microtasksRun + this.microtasks.length >= this.limits.maxMicrotasks) {
      throw new LimitError(
        `Execution stopped: more than ${this.limits.maxMicrotasks} microtasks were scheduled.`,
      );
    }
    const id = ++this.microSeq;
    this.pushEvent({ type: 'microtask:enqueue', id, label });
    this.microtasks.push({ id, label, run });
  }

  // ── Unhandled rejections ──────────────────────────────────────────────────

  notifyUnhandledRejection(promise: object, reason: unknown): void {
    this.unhandled.push({ promise, reason });
  }

  revokeUnhandledRejection(promise: object): void {
    const index = this.unhandled.findIndex((entry) => entry.promise === promise);
    if (index >= 0) this.unhandled.splice(index, 1);
  }

  private flushUnhandledRejections(): void {
    while (this.unhandled.length > 0) {
      const entry = this.unhandled.shift()!;
      this.pushTerminalEvent({
        type: 'error',
        message: `Uncaught (in promise) ${formatThrownValue(entry.reason)}`,
        kind: 'unhandled-rejection',
      });
    }
  }

  // ── Timers ("Web APIs") ───────────────────────────────────────────────────

  private static normalizeDelay(delay: unknown): number {
    const n = Number(delay);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.ceil(n);
  }

  scheduleTimer(callback: () => void, delay: unknown, kind: TimerKind): number {
    if (this.timers.size >= this.limits.maxTimers) {
      throw new LimitError(
        `Execution stopped: more than ${this.limits.maxTimers} timers are active at once.`,
      );
    }
    const normalized = VirtualScheduler.normalizeDelay(delay);
    const timerId = ++this.timerSeq;
    const label = (callback as { name?: string }).name || 'callback';
    const entry: TimerEntry = {
      timerId,
      kind,
      delay: normalized,
      period: kind === 'interval' ? Math.max(1, normalized) : null,
      dueTime: this.virtualTime + normalized,
      seq: this.timerSeq,
      label,
      callback,
    };
    this.timers.set(timerId, entry);
    this.pushEvent({
      type: 'api:schedule',
      timerId,
      kind,
      delay: normalized,
      label,
      dueTime: entry.dueTime,
    });
    return timerId;
  }

  clearTimer(timerId: unknown): void {
    const id = Number(timerId);
    if (!Number.isInteger(id)) return;
    if (this.timers.delete(id)) {
      this.pushEvent({ type: 'api:clear', timerId: id });
    }
  }

  // ── Event loop ────────────────────────────────────────────────────────────

  private turn(action: LoopAction): void {
    this.pushEvent({ type: 'loop:turn', action });
  }

  /** Moves every timer that is due into the task queue, in firing order. */
  private collectDueTimers(): void {
    const due = [...this.timers.values()]
      .filter((entry) => entry.dueTime <= this.virtualTime)
      .sort((a, b) => a.dueTime - b.dueTime || a.seq - b.seq);
    for (const entry of due) {
      this.timers.delete(entry.timerId);
      this.pushEvent({ type: 'api:complete', timerId: entry.timerId });
      if (entry.period !== null) {
        // setInterval: re-arm for the next period before running the callback.
        const reEntry: TimerEntry = {
          ...entry,
          dueTime: this.virtualTime + entry.period,
          seq: ++this.timerSeq,
        };
        this.timers.set(reEntry.timerId, reEntry);
        this.pushEvent({
          type: 'api:schedule',
          timerId: reEntry.timerId,
          kind: 'interval',
          delay: entry.period,
          label: entry.label,
          dueTime: reEntry.dueTime,
        });
      }
      const taskId = ++this.taskSeq;
      this.pushEvent({
        type: 'task:enqueue',
        taskId,
        timerId: entry.timerId,
        label: entry.label,
        dueTime: entry.dueTime,
      });
      this.tasks.push({
        taskId,
        timerId: entry.timerId,
        label: entry.label,
        callback: entry.callback,
      });
    }
  }

  /** Runs one segment of user code, converting throws into trace events. */
  runProtected(segment: () => void): void {
    try {
      segment();
    } catch (error) {
      if (error instanceof LimitError) {
        this.fatal = this.fatal ?? error;
        this.unwindFrames();
        this.pushTerminalEvent({ type: 'error', message: error.message, kind: 'limit' });
        this.hadError = true;
      } else {
        this.unwindFrames();
        this.pushTerminalEvent({
          type: 'error',
          message: formatThrownValue(error),
          kind: 'sync',
        });
        this.hadError = true;
      }
    }
  }

  /**
   * Drains microtasks and tasks until the program is finished, exactly in
   * event-loop order: microtasks always run to completion between tasks.
   */
  drive(): void {
    try {
      this.drainLoop();
    } catch (error) {
      // A limit error thrown by a direct pushEvent call must not escape the
      // engine; convert it into a terminal error event.
      const limit =
        error instanceof LimitError
          ? error
          : new LimitError(`Execution stopped: ${(error as Error).message}`);
      this.fatal = this.fatal ?? limit;
      this.unwindFrames();
      this.pushTerminalEvent({ type: 'error', message: limit.message, kind: 'limit' });
      this.hadError = true;
    }
    this.flushUnhandledRejections();
  }

  private drainLoop(): void {
    while (this.fatal === null) {
      if (this.microtasks.length > 0) {
        this.turn('drain-microtasks');
        while (this.microtasks.length > 0 && this.fatal === null) {
          const job = this.microtasks.shift()!;
          this.microtasksRun++;
          this.pushEvent({ type: 'microtask:dequeue', id: job.id, label: job.label });
          this.runProtected(job.run);
        }
        if (this.fatal !== null) break;
        this.flushUnhandledRejections();
        continue;
      }

      this.collectDueTimers();

      if (this.tasks.length > 0) {
        if (this.tasksRun >= this.limits.maxTasksRun) {
          this.fatal = new LimitError(
            `Execution stopped: more than ${this.limits.maxTasksRun} tasks ran (setInterval can run forever).`,
          );
          this.unwindFrames();
          this.pushTerminalEvent({ type: 'error', message: this.fatal.message, kind: 'limit' });
          this.hadError = true;
          break;
        }
        this.turn('run-task');
        const task = this.tasks.shift()!;
        this.tasksRun++;
        this.pushEvent({ type: 'task:dequeue', taskId: task.taskId, label: task.label });
        this.runProtected(task.callback);
        continue;
      }

      if (this.timers.size > 0) {
        let next = Infinity;
        for (const entry of this.timers.values()) {
          if (entry.dueTime < next) next = entry.dueTime;
        }
        if (next <= this.virtualTime) {
          // collectDueTimers should have consumed everything due; safety net.
          continue;
        }
        this.turn('advance-time');
        this.virtualTime = next;
        this.pushEvent({ type: 'time:advance', to: next });
        this.collectDueTimers();
        continue;
      }

      break;
    }
  }
}
