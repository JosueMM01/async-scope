import {
  cloneElement,
  useEffect,
  type CSSProperties,
  type ReactElement,
  type RefObject,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

type Row = ReactElement<{
  style?: CSSProperties;
  'data-index'?: number;
  ref?: (element: HTMLLIElement | null) => void;
  'aria-posinset'?: number;
  'aria-setsize'?: number;
}>;

/** Variable-height rows share the panel's existing scroll owner. */
export function VirtualRows({
  count,
  scrollRef,
  followIndex,
  label,
  renderRow,
  enabled,
}: {
  count: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  followIndex: number | null;
  label: string;
  renderRow: (index: number) => Row;
  enabled: boolean;
}) {
  'use no memo'; // Virtualizer owns mutable measurements; do not compiler-memoize this adapter.
  const virtual = enabled && count > 100;
  // Measurements stay local to this adapter and are never passed to memoized consumers.
  // eslint-disable-next-line react-hooks/incompatible-library
  const list = useVirtualizer<HTMLDivElement, HTMLLIElement>({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 32,
    overscan: 8,
    enabled: virtual,
    useFlushSync: false,
  });
  // Parent refs are available after commit, including when a long list mounts directly.
  useEffect(() => list.measure(), [list]);
  useEffect(() => {
    if (virtual && followIndex !== null && followIndex >= 0) {
      list.scrollToIndex(followIndex, { align: 'auto' });
    }
  }, [virtual, followIndex, count, list]);

  if (!virtual)
    return (
      <ol aria-label={label}>{Array.from({ length: count }, (_, index) => renderRow(index))}</ol>
    );
  return (
    <ol
      aria-label={label}
      data-virtualized="true"
      style={{ height: list.getTotalSize(), position: 'relative' }}
    >
      {list.getVirtualItems().map((row) =>
        cloneElement(renderRow(row.index), {
          'data-index': row.index,
          'aria-posinset': row.index + 1,
          'aria-setsize': count,
          ref: list.measureElement,
          style: {
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${row.start}px)`,
          },
        }),
      )}
    </ol>
  );
}
