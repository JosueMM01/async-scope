/**
 * Visualization panels: Call Stack, Web APIs, Microtask Queue, Task Queue,
 * Event Loop badge, Console and Timeline.
 *
 * All panels are pure functions of VisualizationState — no engine knowledge.
 */
import { useEffect, useRef, useState } from 'react';
import type {
  ApiTimer,
  ConsoleLine,
  Frame,
  LoopAction,
  QueueItem,
  TaskItem,
  TimelineEntry,
} from '../engine';

export function PanelShell({
  title,
  accent,
  count,
  children,
  ariaLabel,
  headerAction,
  contentRef,
  onUserScroll,
}: {
  title: string;
  accent: 'cyan' | 'purple' | 'orange' | 'green' | 'yellow' | 'muted';
  count?: number;
  children: React.ReactNode;
  ariaLabel?: string;
  headerAction?: React.ReactNode;
  contentRef?: React.Ref<HTMLDivElement>;
  onUserScroll?: () => void;
}) {
  const accentClass = {
    cyan: 'as-accent-cyan',
    purple: 'as-accent-purple',
    orange: 'as-accent-orange',
    green: 'as-accent-green',
    yellow: 'as-accent-yellow',
    muted: 'as-accent-muted',
  }[accent];
  return (
    <section
      aria-label={ariaLabel ?? title}
      className={`as-panel flex min-h-0 flex-col overflow-hidden rounded-lg border ${accentClass}`}
    >
      <header className="as-panel-header flex shrink-0 items-center justify-between gap-2 px-3 py-1.5">
        <h3 className="text-[11px] font-semibold tracking-wider uppercase">{title}</h3>
        <div className="flex items-center gap-1.5">
          {typeof count === 'number' && (
            <span className="as-badge rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums">
              {count}
            </span>
          )}
          {headerAction}
        </div>
      </header>
      <div
        ref={contentRef}
        className="as-panel-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        onWheelCapture={onUserScroll}
        onTouchStartCapture={onUserScroll}
        onPointerDownCapture={onUserScroll}
        onKeyDownCapture={(event) => {
          if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
            onUserScroll?.();
          }
        }}
      >
        {children}
      </div>
    </section>
  );
}

export function CallStackPanel({ frames }: { frames: Frame[] }) {
  return (
    <PanelShell title="Call Stack" accent="cyan" count={frames.length} ariaLabel="Call Stack">
      {frames.length === 0 ? (
        <EmptyHint>Stack is empty</EmptyHint>
      ) : (
        <ol className="flex flex-col gap-1" aria-label="Stack frames, topmost last">
          {frames.map((frame, index) => {
            const isTop = index === frames.length - 1;
            return (
              <li
                key={frame.id}
                className={`as-frame rounded-md border px-2.5 py-1.5 font-mono text-[12.5px] ${
                  isTop ? 'as-frame-top' : 'as-frame-idle'
                } ${frame.name === '(global)' ? 'as-frame-global' : ''}`}
                aria-current={isTop ? 'true' : undefined}
              >
                <span className="as-frame-index tabular-nums opacity-60">
                  {String(index + 1).padStart(2, '0')}
                </span>{' '}
                {frame.name}
                {isTop && (
                  <span className="as-frame-badge ml-2 rounded px-1 py-px text-[9px] font-bold tracking-wider uppercase">
                    running
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </PanelShell>
  );
}

export function WebApisPanel({ timers }: { timers: ApiTimer[] }) {
  return (
    <PanelShell
      title="Browser APIs"
      accent="green"
      count={timers.length}
      ariaLabel="Browser and Async APIs"
    >
      {timers.length === 0 ? (
        <EmptyHint>No pending timers</EmptyHint>
      ) : (
        <ul className="flex flex-col gap-1">
          {timers.map((timer) => (
            <li
              key={timer.timerId}
              className="as-timer as-timer-kind rounded-md border px-2.5 py-1.5 font-mono text-[12px]"
              data-kind={timer.kind}
            >
              <span className="as-timer-kind-badge" aria-hidden="true">
                {timer.kind === 'timeout' ? '⏱' : '↻'}
              </span>
              <span className="as-timer-name">
                {timer.kind === 'timeout' ? 'setTimeout' : 'setInterval'}
              </span>
              <span className="as-timer-label opacity-80"> {timer.label}</span>
              <span className="as-timer-remaining ml-auto tabular-nums">{timer.remaining}ms</span>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}

export function MicrotaskQueuePanel({ items }: { items: QueueItem[] }) {
  return (
    <PanelShell
      title="Microtask Queue"
      accent="purple"
      count={items.length}
      ariaLabel="Microtask Queue"
    >
      {items.length === 0 ? (
        <EmptyHint>No pending microtasks</EmptyHint>
      ) : (
        <ol className="flex flex-col gap-1">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="as-microtask rounded-md border px-2.5 py-1.5 font-mono text-[12px]"
            >
              <span className="as-queue-position tabular-nums opacity-60">
                {String(index + 1).padStart(2, '0')}
              </span>{' '}
              {item.label}
              {index === 0 && (
                <span className="as-queue-next ml-2 rounded px-1 py-px text-[9px] font-bold tracking-wider uppercase">
                  next
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </PanelShell>
  );
}

export function TaskQueuePanel({ items }: { items: TaskItem[] }) {
  return (
    <PanelShell title="Task Queue" accent="orange" count={items.length} ariaLabel="Task Queue">
      {items.length === 0 ? (
        <EmptyHint>No pending tasks</EmptyHint>
      ) : (
        <ol className="flex flex-col gap-1">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="as-task rounded-md border px-2.5 py-1.5 font-mono text-[12px]"
            >
              <span className="as-queue-position tabular-nums opacity-60">
                {String(index + 1).padStart(2, '0')}
              </span>{' '}
              {item.label}
              {index === 0 && (
                <span className="as-queue-next ml-2 rounded px-1 py-px text-[9px] font-bold tracking-wider uppercase">
                  next
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </PanelShell>
  );
}

const LOOP_LABEL: Record<LoopAction, string> = {
  idle: 'idle',
  'drain-microtasks': 'draining microtasks',
  'run-task': 'selecting next task',
  'advance-time': 'waiting for timers',
};

export function EventLoopBadge({
  loop,
  stackEmpty,
  complete = false,
  paused = false,
}: {
  loop: LoopAction;
  stackEmpty: boolean;
  complete?: boolean;
  paused?: boolean;
}) {
  const active = loop !== 'idle';
  const description = complete
    ? 'execution complete'
    : active
      ? LOOP_LABEL[loop]
      : stackEmpty
        ? 'waiting for work'
        : 'executing synchronous code';
  const visualState = complete
    ? 'complete'
    : loop === 'drain-microtasks'
      ? 'microtasks'
      : loop === 'run-task'
        ? 'task'
        : loop === 'advance-time'
          ? 'timers'
          : stackEmpty
            ? 'waiting'
            : 'synchronous';
  return (
    <div
      className={`as-loop-badge flex items-center gap-3 rounded-lg border px-3 py-2 ${active ? 'as-loop-active' : 'as-loop-idle'}`}
      role="status"
      aria-label={`Event Loop: ${description}`}
      data-active={active ? 'true' : 'false'}
      data-loop-state={visualState}
      data-paused={paused ? 'true' : 'false'}
    >
      <span className="as-loop-icon" aria-hidden="true">
        <svg className="as-loop-mark" viewBox="0 0 32 32" focusable="false">
          <path d="M25.8 11.3A11 11 0 0 0 7.1 8.1" />
          <path d="m7.3 3.8-.2 4.3 4.3.2" />
          <path d="M6.2 20.7a11 11 0 0 0 18.7 3.2" />
          <path d="m24.7 28.2.2-4.3-4.3-.2" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold tracking-wider uppercase">Event Loop</p>
        <p className="truncate text-[11.5px] opacity-90">{description}</p>
      </div>
      <span
        className="as-loop-stack rounded px-1.5 py-0.5 font-mono text-[10px]"
        title="Call stack state"
      >
        stack {stackEmpty ? 'empty' : 'busy'}
      </span>
    </div>
  );
}

const CONSOLE_LEVEL_CLASS: Record<ConsoleLine['level'], string> = {
  log: 'as-console-log',
  info: 'as-console-info',
  warn: 'as-console-warn',
  error: 'as-console-error',
};

const CONSOLE_LEVEL_ICON: Record<ConsoleLine['level'], string> = {
  log: '›',
  info: 'ℹ',
  warn: '⚠',
  error: '✖',
};

export function ConsolePanel({
  lines,
  onCollapse,
}: {
  lines: ConsoleLine[];
  onCollapse?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [followLatest, setFollowLatest] = useState(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && followLatest) el.scrollTop = el.scrollHeight;
  }, [followLatest, lines]);

  return (
    <PanelShell
      title="Console"
      accent="muted"
      count={lines.length}
      ariaLabel="Console output"
      headerAction={
        <>
          <FollowToggle active={followLatest} onActivate={() => setFollowLatest(true)} />
          {onCollapse && (
            <button
              type="button"
              className="as-dock-toggle"
              onClick={onCollapse}
              aria-label="Collapse console"
              aria-expanded="true"
            >
              <span aria-hidden="true">▼</span>
            </button>
          )}
        </>
      }
      contentRef={scrollRef}
      onUserScroll={() => setFollowLatest(false)}
    >
      <div aria-live="polite">
        {lines.length === 0 ? (
          <EmptyHint>console output will appear here</EmptyHint>
        ) : (
          <ol aria-label="Console output lines">
            {lines.map((line) => (
              <li
                key={line.id}
                className={`as-console-line ${CONSOLE_LEVEL_CLASS[line.level]} flex items-start gap-2 rounded px-2 py-1 font-mono text-[12.5px] whitespace-pre-wrap break-words`}
              >
                <span className="as-console-icon shrink-0 opacity-80" aria-hidden="true">
                  {CONSOLE_LEVEL_ICON[line.level]}
                </span>
                <span className="as-console-text min-w-0">{line.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </PanelShell>
  );
}

const TIMELINE_KIND_CLASS: Record<TimelineEntry['kind'], string> = {
  start: 'as-tl-start',
  end: 'as-tl-end',
  stack: 'as-tl-stack',
  api: 'as-tl-api',
  microtask: 'as-tl-microtask',
  task: 'as-tl-task',
  loop: 'as-tl-loop',
  console: 'as-tl-console',
  error: 'as-tl-error',
  time: 'as-tl-time',
};

export function TimelinePanel({
  entries,
  currentIndex,
  onSeekToEntry,
}: {
  entries: TimelineEntry[];
  currentIndex: number;
  onSeekToEntry: (eventIndex: number) => void;
}) {
  const activeRef = useRef<HTMLLIElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [followActive, setFollowActive] = useState(true);
  useEffect(() => {
    if (followActive) activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentIndex, followActive]);

  return (
    <PanelShell
      title="Timeline"
      accent="yellow"
      count={entries.length}
      ariaLabel="Execution timeline"
      headerAction={<FollowToggle active={followActive} onActivate={() => setFollowActive(true)} />}
      contentRef={scrollRef}
      onUserScroll={() => setFollowActive(false)}
    >
      {entries.length === 0 ? (
        <EmptyHint>run the code to record a timeline</EmptyHint>
      ) : (
        <ol className="flex flex-col" aria-label="Execution timeline events">
          {entries.map((entry, index) => {
            const isPast = index <= currentIndex;
            const isActive = index === currentIndex;
            return (
              <li
                key={entry.id}
                ref={isActive ? activeRef : undefined}
                className={`as-tl-item ${TIMELINE_KIND_CLASS[entry.kind]} ${
                  isPast ? 'as-tl-past' : 'as-tl-future'
                } ${isActive ? 'as-tl-active' : ''}`}
              >
                <button
                  type="button"
                  className="as-tl-button flex w-full items-start gap-2 rounded px-2 py-1 text-left text-[12px]"
                  onClick={() => onSeekToEntry(index)}
                  aria-current={isActive ? 'step' : undefined}
                >
                  <span className="as-tl-index shrink-0 tabular-nums opacity-60">{index + 1}</span>
                  <span className="as-tl-text min-w-0 flex-1">{entry.text}</span>
                  {entry.line !== null && (
                    <span className="as-tl-line shrink-0 font-mono text-[10px] opacity-60">
                      :{entry.line}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </PanelShell>
  );
}

function FollowToggle({ active, onActivate }: { active: boolean; onActivate: () => void }) {
  return (
    <button
      type="button"
      className="as-follow-toggle rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase"
      aria-pressed={active}
      title={active ? 'Automatic follow is active' : 'Resume automatic follow'}
      onClick={onActivate}
    >
      {active ? 'Following' : 'Follow'}
    </button>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="as-empty-hint px-2 py-3 text-center text-[12px] italic opacity-70">{children}</p>
  );
}
