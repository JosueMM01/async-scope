/**
 * VisualizerApp: the React island that hosts the whole interactive tool.
 *
 * Owns: editor source, recorder (worker) lifecycle, playback state machine and
 * the responsive layout (panels on desktop, tabs on small screens).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
// Deep imports keep the Babel pipeline out of the main chunk (worker-only).
import {
  DEFAULT_EXAMPLE_ID,
  EXAMPLES,
  getExample,
} from '../engine/examples';
import type { TraceEvent } from '../engine/types';
import { CodeEditor } from './CodeEditor';
import { Controls } from './Controls';
import {
  CallStackPanel,
  ConsolePanel,
  EventLoopBadge,
  MicrotaskQueuePanel,
  TaskQueuePanel,
  TimelinePanel,
  WebApisPanel,
} from './panels';
import { usePlayback } from './usePlayback';
import { useRecorder } from './useRecorder';

type MobileTab = 'editor' | 'runtime' | 'queues' | 'output';

const MOBILE_TABS: Array<{ id: MobileTab; label: string }> = [
  { id: 'editor', label: 'Editor' },
  { id: 'runtime', label: 'Stack & APIs' },
  { id: 'queues', label: 'Queues' },
  { id: 'output', label: 'Console & Timeline' },
];

const STORAGE_KEY = 'asyncscope:source';

function loadInitialSource(): string {
  if (typeof window === 'undefined') return getExample(DEFAULT_EXAMPLE_ID).code;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (typeof stored === 'string' && stored.trim().length > 0) return stored;
  } catch {
    // Private mode or disabled storage — fall through to the default example.
  }
  return getExample(DEFAULT_EXAMPLE_ID).code;
}

const DESKTOP_QUERY = '(min-width: 1024px)';

function subscribeDesktop(callback: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

/** true when the viewport uses the desktop workbench layout. */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

export function VisualizerApp() {
  const [source, setSource] = useState<string>(loadInitialSource);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const playback = usePlayback();
  const dispatch = playback.dispatch;

  const handleTrace = useCallback(
    (events: TraceEvent[]) => {
      dispatch({ type: 'run-complete', events });
    },
    [dispatch],
  );

  const recorder = useRecorder({
    onTrace: handleTrace,
    onCompileError: (error) => dispatch({ type: 'run-failed', error }),
    onTimeout: () => dispatch({ type: 'recorder-timeout' }),
  });

  const run = useCallback(() => {
    dispatch({ type: 'run-start' });
    recorder.run(sourceRef.current);
  }, [dispatch, recorder]);

  const stop = useCallback(() => {
    recorder.stop();
    dispatch({ type: 'stop' });
  }, [dispatch, recorder]);

  // Persist the editor content (debounced) so a reload keeps the user's code.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, source);
      } catch {
        // Storage may be unavailable; persistence is best-effort.
      }
    }, 400);
    return () => clearTimeout(id);
  }, [source]);

  // Playback ticker: advance the cursor while playing.
  const { status, cursor, stepIntervalMs } = playback;
  useEffect(() => {
    if (status !== 'playing') return;
    const id = setTimeout(() => dispatch({ type: 'tick' }), stepIntervalMs);
    return () => clearTimeout(id);
  }, [status, cursor, stepIntervalMs, dispatch]);

  // Global keyboard shortcuts (skipped while typing in the editor or a field).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        run();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target?.closest('.as-editor-host, input, select, textarea, [contenteditable]') != null
      ) {
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        dispatch({ type: playback.status === 'playing' ? 'pause' : 'play' });
      } else if (event.key === 'ArrowRight') {
        dispatch({ type: 'step', delta: 1 });
      } else if (event.key === 'ArrowLeft') {
        dispatch({ type: 'step', delta: -1 });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playback.status, dispatch, run]);

  const [exampleId, setExampleId] = useState<string>(DEFAULT_EXAMPLE_ID);
  const applyExample = useCallback((id: string) => {
    const example = getExample(id);
    setExampleId(example.id);
    setSource(example.code);
  }, []);

  const resetToExample = useCallback(() => {
    setSource(getExample(exampleId).code);
  }, [exampleId]);

  const { current, compileError, status: pbStatus, trace } = playback;
  const [mobileTab, setMobileTab] = useState<MobileTab>('editor');
  const isDesktop = useIsDesktop();

  const timelineSeek = useCallback(
    (entryIndex: number) => {
      if (!trace) return;
      let seen = -1;
      for (let i = 0; i < trace.length; i++) {
        const event = trace[i]!;
        if (event.type !== 'loc') {
          seen++;
          if (seen === entryIndex) {
            dispatch({ type: 'seek', cursor: i + 1 });
            return;
          }
        }
      }
    },
    [trace, dispatch],
  );

  const hasTrace = !!trace && pbStatus !== 'recording';
  const activeLine = hasTrace ? current.currentLine : null;

  const editor = (
    <CodeEditor value={source} onChange={setSource} activeLine={activeLine} />
  );

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-col gap-2">
        <Controls playback={playback} onRun={run} onStop={stop} />
        <div className="as-example-row flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
          <label
            htmlFor="as-example"
            className="text-[11px] font-semibold tracking-wider uppercase opacity-80"
          >
            Examples
          </label>
          <select
            id="as-example"
            className="as-select min-w-0 flex-1 rounded-md border px-2 py-1 text-[12.5px] sm:max-w-xs"
            value={exampleId}
            onChange={(event) => applyExample(event.target.value)}
          >
            {EXAMPLES.map((example) => (
              <option key={example.id} value={example.id}>
                {example.name}
              </option>
            ))}
          </select>
          <span className="hidden truncate text-[12px] opacity-70 md:inline">
            {getExample(exampleId).description}
          </span>
          <button
            type="button"
            className="as-btn ml-auto shrink-0 rounded-md border px-2.5 py-1.5 text-[12px] font-semibold"
            onClick={resetToExample}
            disabled={source === getExample(exampleId).code}
            aria-label="Reset editor to the selected example"
            title="Reset editor to the selected example"
          >
            ↺ Reset code
          </button>
        </div>
      </div>

      {compileError && (
        <div className="as-error-banner rounded-lg border px-3 py-2" role="alert">
          <p className="font-semibold">
            {compileError.phase === 'syntax'
              ? 'Syntax error'
              : compileError.phase === 'unsupported'
                ? 'Unsupported feature'
                : 'Execution error'}
            {compileError.line !== null && (
              <span className="font-mono opacity-80"> — line {compileError.line}</span>
            )}
          </p>
          <p className="mt-0.5 text-[13px] opacity-90">{compileError.message}</p>
        </div>
      )}

      {/* Small screens: tabs instead of shrinking every panel at once.
          Rendered only when not desktop so the CodeMirror instance is
          mounted exactly once (either here or in the workbench). */}
      {!isDesktop && (
      <div>
        <div className="flex flex-wrap gap-1.5 pb-1" role="tablist" aria-label="Visualizer sections">
          {MOBILE_TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={mobileTab === tab.id}
              type="button"
              onClick={() => setMobileTab(tab.id)}
              className={`as-tab rounded-md border px-3 py-1.5 text-[12px] font-semibold ${
                mobileTab === tab.id ? 'as-tab-active' : 'as-tab-idle'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {mobileTab === 'editor' && (
          <div
            role="tabpanel"
            aria-label="Editor"
            className="as-editor-frame h-[48vh] min-h-[280px]"
          >
            {editor}
          </div>
        )}
        {mobileTab === 'runtime' && (
          <div role="tabpanel" aria-label="Stack and APIs" className="flex flex-col gap-2">
            <EventLoopBadge loop={current.loop} stackEmpty={current.stack.length === 0} />
            <div className="max-h-[38vh] min-h-[170px]">
              <CallStackPanel frames={current.stack} />
            </div>
            <div className="max-h-[38vh] min-h-[170px]">
              <WebApisPanel timers={current.apis} />
            </div>
          </div>
        )}
        {mobileTab === 'queues' && (
          <div role="tabpanel" aria-label="Queues" className="flex flex-col gap-2">
            <div className="max-h-[40vh] min-h-[170px]">
              <MicrotaskQueuePanel items={current.microtasks} />
            </div>
            <div className="max-h-[40vh] min-h-[170px]">
              <TaskQueuePanel items={current.tasks} />
            </div>
          </div>
        )}
        {mobileTab === 'output' && (
          <div role="tabpanel" aria-label="Console and timeline" className="flex flex-col gap-2">
            <div className="h-[28vh] min-h-[150px]">
              <ConsolePanel lines={current.console} />
            </div>
            <div className="h-[34vh] min-h-[170px]">
              <TimelinePanel
                entries={current.timeline}
                currentIndex={Math.max(0, current.timeline.length - 1)}
                onSeekToEntry={timelineSeek}
              />
            </div>
          </div>
        )}
      </div>
      )}

      {/* Desktop: panels workbench. */}
      {isDesktop && (
      <div className="as-workbench min-h-[560px] gap-2 grid">
        <div className="as-cell-editor as-editor-frame min-h-0">{editor}</div>
        <div className="as-cell-side flex min-h-0 flex-col gap-2">
          <EventLoopBadge loop={current.loop} stackEmpty={current.stack.length === 0} />
          <div className="min-h-[120px] flex-1">
            <CallStackPanel frames={current.stack} />
          </div>
          <div className="min-h-[110px] flex-1">
            <WebApisPanel timers={current.apis} />
          </div>
          <div className="min-h-[110px] flex-1">
            <MicrotaskQueuePanel items={current.microtasks} />
          </div>
          <div className="min-h-[110px] flex-1">
            <TaskQueuePanel items={current.tasks} />
          </div>
        </div>
        <div className="as-cell-timeline min-h-0">
          <TimelinePanel
            entries={current.timeline}
            currentIndex={Math.max(0, current.timeline.length - 1)}
            onSeekToEntry={timelineSeek}
          />
        </div>
        <div className="as-cell-console min-h-0">
          <ConsolePanel lines={current.console} />
        </div>
      </div>
      )}
    </div>
  );
}
