/**
 * Playback controls: Run, Pause/Resume, step back/forward, Restart, Stop,
 * speed, progress slider and status.
 */
import type { Playback, PlaybackStatus } from './usePlayback';
import { SPEEDS } from './usePlayback';

const STATUS_LABEL: Record<PlaybackStatus, string> = {
  idle: 'Ready',
  recording: 'Recording…',
  ready: 'Paused at start',
  playing: 'Playing',
  paused: 'Paused',
  done: 'Finished',
  error: 'Error',
};

function StatusIcon({ status }: { status: PlaybackStatus }) {
  // Icon + color + text: state is never communicated by color alone.
  const icon: Record<PlaybackStatus, string> = {
    idle: '◇',
    recording: '●',
    ready: '❚❚',
    playing: '▶',
    paused: '❚❚',
    done: '✓',
    error: '✖',
  };
  return (
    <span className={`as-status as-status-${status} inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold`}>
      <span aria-hidden="true">{icon[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

function ControlButton({
  label,
  onClick,
  disabled,
  variant = 'default',
  hotkey,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'run' | 'default' | 'danger';
  hotkey?: string;
}) {
  const variantClass = {
    run: 'as-btn-run',
    default: 'as-btn',
    danger: 'as-btn-danger',
  }[variant];
  return (
    <button
      type="button"
      className={`${variantClass} inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-semibold`}
      onClick={onClick}
      disabled={disabled}
      aria-label={hotkey ? `${label} (${hotkey})` : label}
      title={hotkey ? `${label} (${hotkey})` : label}
    >
      {label}
    </button>
  );
}

export interface ControlsProps {
  playback: Playback;
  onRun: () => void;
  onStop: () => void;
}

export function Controls({ playback, onRun, onStop }: ControlsProps) {
  const { status, cursor, lastStep, speed, canPlay, canPause, canStep, dispatch } = playback;

  return (
    <div className="as-controls-bar flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
      <div className="flex items-center gap-1.5" role="group" aria-label="Playback controls">
        <ControlButton
          label={status === 'recording' ? 'Running…' : 'Run'}
          onClick={onRun}
          disabled={status === 'recording'}
          variant="run"
          hotkey="Ctrl+Enter"
        />
        {canPause ? (
          <ControlButton label="Pause" onClick={() => dispatch({ type: 'pause' })} hotkey="Space" />
        ) : (
          <ControlButton
            label="Resume"
            onClick={() => dispatch({ type: 'play' })}
            disabled={!canPlay}
            hotkey="Space"
          />
        )}
        <ControlButton
          label="◀ Prev"
          onClick={() => dispatch({ type: 'step', delta: -1 })}
          disabled={!canStep || cursor <= 0}
          hotkey="ArrowLeft"
        />
        <ControlButton
          label="Next ▶"
          onClick={() => dispatch({ type: 'step', delta: 1 })}
          disabled={!canStep || cursor >= lastStep}
          hotkey="ArrowRight"
        />
        <ControlButton
          label="↺ Restart"
          onClick={() => dispatch({ type: 'restart' })}
          disabled={!canStep}
        />
        <ControlButton
          label="■ Stop"
          onClick={onStop}
          disabled={status === 'idle'}
          variant="danger"
        />
      </div>

      <div className="flex min-w-[160px] flex-1 items-center gap-2">
        <label className="sr-only" htmlFor="as-progress">
          Playback position
        </label>
        <input
          id="as-progress"
          type="range"
          min={0}
          max={lastStep}
          step={1}
          value={cursor}
          onChange={(event) => dispatch({ type: 'seek', cursor: Number(event.target.value) })}
          disabled={!canStep}
          className="as-range w-full"
          aria-valuetext={`step ${cursor} of ${lastStep}`}
          style={{ '--as-range-progress': `${(cursor / Math.max(1, lastStep)) * 100}%` } as React.CSSProperties}
        />
        <span className="shrink-0 font-mono text-[11px] tabular-nums opacity-80" aria-hidden="true">
          {cursor}/{lastStep}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <label className="text-[11px] font-semibold opacity-80" htmlFor="as-speed">
          Speed
        </label>
        <select
          id="as-speed"
          className="as-select rounded-md border px-1.5 py-1 text-[12px]"
          value={speed}
          onChange={(event) => dispatch({ type: 'speed', value: Number(event.target.value) })}
        >
          {SPEEDS.map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
        <StatusIcon status={status} />
      </div>
    </div>
  );
}
