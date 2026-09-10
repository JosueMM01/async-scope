/**
 * VisualizerApp: the React island that hosts the whole interactive tool.
 *
 * Owns: editor source, recorder (worker) lifecycle, playback state machine and
 * the responsive layout (panels on desktop, tabs on small screens).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
// Deep imports keep the Babel pipeline out of the main chunk (worker-only).
import { DEFAULT_EXAMPLE_ID, EXAMPLES, getExample } from '../engine/examples';
import type { SourceLanguage, TraceEvent } from '../engine/types';
import { CodeEditor } from './CodeEditor';
import { Controls } from './Controls';
import { ResizeHandle } from './ResizeHandle';
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

type MobileTab = 'editor' | 'runtime' | 'timeline';

const MOBILE_TABS: Array<{ id: MobileTab; label: string }> = [
  { id: 'editor', label: 'Editor' },
  { id: 'runtime', label: 'Runtime' },
  { id: 'timeline', label: 'Timeline' },
];

const STORAGE_KEY = 'asyncscope:source';
const LANGUAGE_STORAGE_KEY = 'asyncscope:language';
const EDITOR_SIZE_KEY = 'asyncscope:editor-percent';
const CONSOLE_HEIGHT_KEY = 'asyncscope:console-height';
const CONSOLE_OPEN_KEY = 'asyncscope:console-open';
const EDITOR_MIN = 28;
const EDITOR_MAX = 58;
const CONSOLE_MIN = 112;
const CONSOLE_MAX = 320;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function loadStoredNumber(key: string, fallback: number, minimum: number, maximum: number): number {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? clamp(value, minimum, maximum) : fallback;
  } catch {
    return fallback;
  }
}

function loadConsoleOpen(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const stored = window.localStorage.getItem(CONSOLE_OPEN_KEY);
    if (stored === 'true' || stored === 'false') return stored === 'true';
    return window.matchMedia(DESKTOP_QUERY).matches;
  } catch {
    return true;
  }
}

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

function loadInitialLanguage(): SourceLanguage {
  if (typeof window === 'undefined') return getExample(DEFAULT_EXAMPLE_ID).language;
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'javascript' || stored === 'typescript') return stored;
  } catch {
    // Private mode or disabled storage — fall through to JavaScript.
  }
  return getExample(DEFAULT_EXAMPLE_ID).language;
}

const DESKTOP_QUERY = '(min-width: 900px)';

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

const subscribeHydration = () => () => {};

export function VisualizerApp() {
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  return <VisualizerWorkbench key={hydrated ? 'stored' : 'server'} loadStored={hydrated} />;
}

function VisualizerWorkbench({ loadStored }: { loadStored: boolean }) {
  const initialExample = getExample(DEFAULT_EXAMPLE_ID);
  // Astro and the first client render share defaults. Once hydration completes,
  // the workbench remounts with browser-only preferences and may persist changes.
  const [source, setSource] = useState<string>(() =>
    loadStored ? loadInitialSource() : initialExample.code,
  );
  const [language, setLanguage] = useState<SourceLanguage>(() =>
    loadStored ? loadInitialLanguage() : initialExample.language,
  );
  const [editorPercent, setEditorPercent] = useState(() =>
    loadStored ? loadStoredNumber(EDITOR_SIZE_KEY, 40, EDITOR_MIN, EDITOR_MAX) : 40,
  );
  const [consoleHeight, setConsoleHeight] = useState(() =>
    loadStored ? loadStoredNumber(CONSOLE_HEIGHT_KEY, 176, CONSOLE_MIN, CONSOLE_MAX) : 176,
  );
  const [consoleOpen, setConsoleOpen] = useState(() => (loadStored ? loadConsoleOpen() : true));
  const splitRef = useRef<HTMLDivElement>(null);

  const playback = usePlayback();
  const dispatch = playback.dispatch;
  const [executed, setExecuted] = useState<Readonly<{
    source: string;
    language: SourceLanguage;
  }> | null>(null);
  const [viewExecuted, setViewExecuted] = useState(false);

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
    setExecuted({ source, language });
    setViewExecuted(false);
    dispatch({ type: 'run-start' });
    recorder.run(source, language);
  }, [dispatch, language, recorder, source]);

  const stop = useCallback(() => {
    setExecuted(null);
    setViewExecuted(false);
    recorder.stop();
    dispatch({ type: 'stop' });
  }, [dispatch, recorder]);

  // Persist the editor content (debounced) so a reload keeps the user's code.
  useEffect(() => {
    if (!loadStored) return;
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, source);
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
      } catch {
        // Storage may be unavailable; persistence is best-effort.
      }
    }, 400);
    return () => clearTimeout(id);
  }, [language, loadStored, source]);

  useEffect(() => {
    if (!loadStored) return;
    try {
      window.localStorage.setItem(EDITOR_SIZE_KEY, String(editorPercent));
      window.localStorage.setItem(CONSOLE_HEIGHT_KEY, String(consoleHeight));
      window.localStorage.setItem(CONSOLE_OPEN_KEY, String(consoleOpen));
    } catch {
      // Layout preferences are best-effort, like source persistence.
    }
  }, [consoleHeight, consoleOpen, editorPercent, loadStored]);

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
        event.defaultPrevented ||
        target?.closest(
          '.as-editor-host, input, select, textarea, [contenteditable], button, a, [role="separator"], [role="tab"]',
        ) != null
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
    setLanguage(example.language);
  }, []);

  const resetToExample = useCallback(() => {
    const example = getExample(exampleId);
    setSource(example.code);
    setLanguage(example.language);
  }, [exampleId]);

  const { current, compileError, status: pbStatus, trace } = playback;
  const [mobileTab, setMobileTab] = useState<MobileTab>('editor');
  const isDesktop = useIsDesktop();

  const resizeEditor = useCallback((delta: number) => {
    const width = splitRef.current?.getBoundingClientRect().width ?? 0;
    if (width <= 0) return;
    setEditorPercent((current) => clamp(current + (delta / width) * 100, EDITOR_MIN, EDITOR_MAX));
  }, []);

  const resizeConsole = useCallback((delta: number) => {
    setConsoleHeight((current) => clamp(current - delta, CONSOLE_MIN, CONSOLE_MAX));
  }, []);

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
  const sourceChanged =
    !!executed && (source !== executed.source || language !== executed.language);
  const showingExecuted = viewExecuted && sourceChanged;
  const activeLine = hasTrace && (!sourceChanged || showingExecuted) ? current.currentLine : null;

  const editor = (
    <CodeEditor
      key={showingExecuted ? 'executed' : 'draft'}
      value={showingExecuted ? executed!.source : source}
      onChange={(value) => {
        dispatch({ type: 'pause' });
        setSource(value);
      }}
      activeLine={activeLine}
      language={showingExecuted ? executed!.language : language}
      readOnly={showingExecuted}
      ariaLabel={
        showingExecuted
          ? 'Executed code (read-only)'
          : `${language === 'typescript' ? 'TypeScript' : 'JavaScript'} code editor`
      }
    />
  );

  const settings = (
    <div className="as-settings flex min-w-0 items-center gap-1.5">
      <label className="sr-only" htmlFor="as-example">
        Example
      </label>
      <select
        id="as-example"
        aria-label="Examples"
        title={getExample(exampleId).description}
        className="as-select min-w-0 rounded-md border px-2 py-1 text-[12px]"
        value={exampleId}
        onChange={(event) => applyExample(event.target.value)}
      >
        {EXAMPLES.map((example) => (
          <option key={example.id} value={example.id}>
            {example.name}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="as-language">
        Language
      </label>
      <select
        id="as-language"
        aria-label="Language"
        className="as-select rounded-md border px-2 py-1 text-[12px]"
        value={language}
        onChange={(event) => setLanguage(event.target.value as SourceLanguage)}
      >
        <option value="javascript">JS</option>
        <option value="typescript">TS</option>
      </select>
      <button
        type="button"
        className="as-btn as-reset-example rounded-md border px-2 py-1 text-[12px] font-semibold"
        onClick={resetToExample}
        disabled={source === getExample(exampleId).code}
        aria-label="Reset editor to the selected example"
        title="Reset editor to the selected example"
      >
        <span aria-hidden="true">↺</span>
      </button>
    </div>
  );

  const eventLoop = (
    <EventLoopBadge
      loop={current.loop}
      stackEmpty={current.stack.length === 0}
      complete={pbStatus === 'done'}
      paused={pbStatus === 'paused' || pbStatus === 'ready'}
    />
  );

  const timeline = (
    <TimelinePanel
      entries={current.timeline}
      currentIndex={Math.max(0, current.timeline.length - 1)}
      onSeekToEntry={timelineSeek}
    />
  );

  const consoleResizeHandle = consoleOpen && (
    <ResizeHandle
      orientation="horizontal"
      label="Resize console"
      valueNow={consoleHeight}
      valueMin={CONSOLE_MIN}
      valueMax={CONSOLE_MAX}
      onPointerDelta={resizeConsole}
      onDecrease={() => setConsoleHeight((value) => clamp(value - 16, CONSOLE_MIN, CONSOLE_MAX))}
      onIncrease={() => setConsoleHeight((value) => clamp(value + 16, CONSOLE_MIN, CONSOLE_MAX))}
      onMinimum={() => setConsoleHeight(CONSOLE_MIN)}
      onMaximum={() => setConsoleHeight(CONSOLE_MAX)}
    />
  );

  const consoleDrawer = (
    <div
      className="as-console-drawer min-h-0 shrink-0"
      style={{ height: consoleOpen ? consoleHeight : 34 }}
    >
      {consoleOpen ? (
        <ConsolePanel lines={current.console} onCollapse={() => setConsoleOpen(false)} />
      ) : (
        <button
          type="button"
          className="as-console-collapsed flex h-full w-full items-center gap-2 border px-3 text-left text-[11px] font-semibold tracking-wider uppercase"
          onClick={() => setConsoleOpen(true)}
          aria-label="Expand console"
          aria-expanded="false"
        >
          <span>Console</span>
          <span className="as-badge rounded-full px-2 py-0.5 text-[10px] tabular-nums">
            {current.console.length}
          </span>
          <span className="ml-auto" aria-hidden="true">
            ▲
          </span>
        </button>
      )}
    </div>
  );

  return (
    <div className="as-workbench-shell flex min-h-0 min-w-0 flex-1 flex-col">
      <Controls playback={playback} onRun={run} onStop={stop} settings={settings} />

      {sourceChanged && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1 text-[12px]">
          <p role="status" className="min-w-0 flex-1">
            {showingExecuted
              ? `Viewing executed ${executed!.language === 'typescript' ? 'TypeScript' : 'JavaScript'} (read-only). Your edits are preserved.`
              : 'Code or language changed. Playback and errors belong to the previous execution. Run to update.'}
          </p>
          <button
            type="button"
            className="as-btn rounded-md border px-2 py-1"
            onClick={() => setViewExecuted((value) => !value)}
          >
            {showingExecuted ? 'Back to edits' : 'View executed code'}
          </button>
        </div>
      )}

      {compileError && (
        <div className="as-error-banner shrink-0 border px-3 py-1.5" role="alert">
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

      <div className="as-workspace-main min-h-0 flex-1">
        {!isDesktop && (
          <div className="as-mobile-workspace flex h-full min-h-0 flex-col">
            <div
              className="as-mobile-tabs flex shrink-0 gap-1 border-b px-2 py-1"
              role="tablist"
              aria-label="Visualizer sections"
            >
              {MOBILE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  id={`as-tab-${tab.id}`}
                  aria-controls={`as-panel-${tab.id}`}
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
                id="as-panel-editor"
                role="tabpanel"
                aria-labelledby="as-tab-editor"
                aria-label="Editor"
                className="as-editor-frame min-h-0 flex-1"
              >
                {editor}
              </div>
            )}
            {mobileTab === 'runtime' && (
              <div
                id="as-panel-runtime"
                role="tabpanel"
                aria-labelledby="as-tab-runtime"
                className="as-mobile-stage min-h-0 flex-1 overflow-y-auto p-1.5"
              >
                {eventLoop}
                <div className="as-mobile-runtime-grid mt-1.5 grid gap-1.5">
                  <CallStackPanel frames={current.stack} />
                  <WebApisPanel timers={current.apis} />
                  <MicrotaskQueuePanel items={current.microtasks} />
                  <TaskQueuePanel items={current.tasks} />
                </div>
              </div>
            )}
            {mobileTab === 'timeline' && (
              <div
                id="as-panel-timeline"
                role="tabpanel"
                aria-labelledby="as-tab-timeline"
                className="min-h-0 flex-1 p-1.5"
              >
                {timeline}
              </div>
            )}
          </div>
        )}

        {isDesktop && (
          <div
            ref={splitRef}
            className="as-desktop-split grid h-full min-h-0"
            style={{ gridTemplateColumns: `${editorPercent}% 10px minmax(0, 1fr)` }}
          >
            <div className="as-editor-column flex min-h-0 min-w-0 flex-col">
              <div className="as-editor-frame min-h-0 flex-1">{editor}</div>
              {consoleResizeHandle}
              {consoleDrawer}
            </div>
            <ResizeHandle
              orientation="vertical"
              label="Resize code editor and runtime"
              valueNow={editorPercent}
              valueMin={EDITOR_MIN}
              valueMax={EDITOR_MAX}
              onPointerDelta={resizeEditor}
              onDecrease={() =>
                setEditorPercent((value) => clamp(value - 2, EDITOR_MIN, EDITOR_MAX))
              }
              onIncrease={() =>
                setEditorPercent((value) => clamp(value + 2, EDITOR_MIN, EDITOR_MAX))
              }
              onMinimum={() => setEditorPercent(EDITOR_MIN)}
              onMaximum={() => setEditorPercent(EDITOR_MAX)}
            />
            <div className="as-runtime-grid grid min-h-0 min-w-0 gap-1.5">
              {eventLoop}
              <div className="as-runtime-panels grid min-h-0 grid-cols-2 gap-1.5">
                <CallStackPanel frames={current.stack} />
                <WebApisPanel timers={current.apis} />
                <MicrotaskQueuePanel items={current.microtasks} />
                <TaskQueuePanel items={current.tasks} />
              </div>
              <div className="min-h-0">{timeline}</div>
            </div>
          </div>
        )}
      </div>

      {!isDesktop && consoleResizeHandle}
      {!isDesktop && consoleDrawer}
    </div>
  );
}
