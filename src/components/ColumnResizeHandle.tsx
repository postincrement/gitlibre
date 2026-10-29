import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

interface ColumnResizeHandleProps {
  /** Pixel offset of the right edge of the column being resized. */
  left: number;
  width: number;
  label: string;
  onResize: (width: number) => void;
}

/** Absolute-positioned drag handle on a column's right edge. */
export function ColumnResizeHandle({
  left,
  width,
  label,
  onResize,
}: ColumnResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(width);
  const onResizeRef = useRef(onResize);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      startX.current = e.clientX;
      startWidth.current = width;
      setDragging(true);

      const previousCursor = document.body.style.cursor;
      const previousSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX.current;
        onResizeRef.current(startWidth.current + delta);
      };
      const onUp = () => {
        setDragging(false);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousSelect;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [width],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onPointerDown}
      style={{ left: left - 4 }}
      className={[
        "absolute top-0 z-30 h-full w-2 cursor-col-resize touch-none",
        dragging ? "bg-accent/70" : "bg-transparent hover:bg-accent/50",
      ].join(" ")}
    />
  );
}
