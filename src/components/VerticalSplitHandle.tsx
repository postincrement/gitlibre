import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

interface VerticalSplitHandleProps {
  onDrag: (deltaY: number) => void;
  onDragEnd?: () => void;
}

/** Drag handle between stacked panes. Positive deltaY grows the lower pane. */
export function VerticalSplitHandle({ onDrag, onDragEnd }: VerticalSplitHandleProps) {
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const onDragRef = useRef(onDrag);
  const onDragEndRef = useRef(onDragEnd);

  useEffect(() => {
    onDragRef.current = onDrag;
  }, [onDrag]);
  useEffect(() => {
    onDragEndRef.current = onDragEnd;
  }, [onDragEnd]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    startY.current = e.clientY;
    setDragging(true);

    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      // Dragging the handle down increases the lower pane.
      onDragRef.current(ev.clientY - startY.current);
      startY.current = ev.clientY;
    };
    const onUp = () => {
      setDragging(false);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      onDragEndRef.current?.();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize commit details"
      onPointerDown={onPointerDown}
      className={[
        "z-20 h-1.5 shrink-0 cursor-row-resize touch-none",
        dragging ? "bg-accent/70" : "bg-border hover:bg-accent/50",
      ].join(" ")}
    />
  );
}
