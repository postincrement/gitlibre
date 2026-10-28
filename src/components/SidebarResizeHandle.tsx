import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const MIN_WIDTH = 180;
const MAX_WIDTH = 560;
const STORAGE_KEY = "gitlibre.sidebarWidth";

export function loadSidebarWidth(fallback = 256): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return clamp(n, MIN_WIDTH, MAX_WIDTH);
  } catch {
    return fallback;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function persistWidth(width: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // Ignore quota / private mode failures.
  }
}

interface SidebarResizeHandleProps {
  width: number;
  onResize: (width: number) => void;
}

export function SidebarResizeHandle({ width, onResize }: SidebarResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(width);
  const widthRef = useRef(width);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      startX.current = e.clientX;
      startWidth.current = width;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [width],
  );

  useEffect(() => {
    if (!dragging) return;

    function onMove(e: PointerEvent) {
      const next = clamp(startWidth.current + (e.clientX - startX.current), MIN_WIDTH, MAX_WIDTH);
      onResize(next);
    }

    function onUp() {
      setDragging(false);
      persistWidth(widthRef.current);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
    };
  }, [dragging, onResize]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(width)}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-label="Resize sidebar"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          const next = clamp(width - 16, MIN_WIDTH, MAX_WIDTH);
          onResize(next);
          persistWidth(next);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          const next = clamp(width + 16, MIN_WIDTH, MAX_WIDTH);
          onResize(next);
          persistWidth(next);
        }
      }}
      className={[
        "relative z-10 w-1.5 shrink-0 cursor-col-resize touch-none",
        "before:absolute before:inset-y-0 before:-left-1 before:right-[-4px] before:content-['']",
        dragging ? "bg-accent/70" : "bg-border hover:bg-accent/50",
      ].join(" ")}
    />
  );
}
