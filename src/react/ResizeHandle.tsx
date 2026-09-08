import { useEffect, useRef } from 'react';

export interface ResizeHandleProps {
  orientation: 'horizontal' | 'vertical';
  label: string;
  valueNow: number;
  valueMin: number;
  valueMax: number;
  onPointerDelta: (delta: number) => void;
  onDecrease: () => void;
  onIncrease: () => void;
  onMinimum: () => void;
  onMaximum: () => void;
}

export function ResizeHandle({
  orientation,
  label,
  valueNow,
  valueMin,
  valueMax,
  onPointerDelta,
  onDecrease,
  onIncrease,
  onMinimum,
  onMaximum,
}: ResizeHandleProps) {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    cleanupRef.current?.();
    let previous = orientation === 'vertical' ? event.clientX : event.clientY;
    document.body.classList.add('as-is-resizing');
    document.body.dataset.resizeOrientation = orientation;

    const move = (pointerEvent: PointerEvent) => {
      const current = orientation === 'vertical' ? pointerEvent.clientX : pointerEvent.clientY;
      onPointerDelta(current - previous);
      previous = current;
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.body.classList.remove('as-is-resizing');
      delete document.body.dataset.resizeOrientation;
      cleanupRef.current = null;
    };
    cleanupRef.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const decreaseKey = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowDown';
    const increaseKey = orientation === 'vertical' ? 'ArrowRight' : 'ArrowUp';
    if (event.key === decreaseKey) {
      event.preventDefault();
      onDecrease();
    } else if (event.key === increaseKey) {
      event.preventDefault();
      onIncrease();
    } else if (event.key === 'Home') {
      event.preventDefault();
      onMinimum();
    } else if (event.key === 'End') {
      event.preventDefault();
      onMaximum();
    }
  };

  return (
    <div
      className={`as-resize-handle as-resize-${orientation}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={Math.round(valueMin)}
      aria-valuemax={Math.round(valueMax)}
      aria-valuenow={Math.round(valueNow)}
      tabIndex={0}
      onPointerDown={startResize}
      onKeyDown={handleKeyDown}
    >
      <span aria-hidden="true" />
    </div>
  );
}
