import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampSidebarWidth,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  persistSidebarWidth,
} from "../lib/workspaceLayout";
import type { WorkspaceId } from "../types/models";

interface SidebarResizeHandleProps {
  workspaceId: WorkspaceId;
  width: number;
  onResize: (width: number) => void;
}

export function SidebarResizeHandle({
  workspaceId,
  width,
  onResize,
}: SidebarResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(width);
  const widthRef = useRef(width);
  const workspaceIdRef = useRef(workspaceId);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
  }, [workspaceId]);

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
      const next = clampSidebarWidth(
        startWidth.current + (e.clientX - startX.current),
      );
      onResize(next);
    }

    function onUp() {
      setDragging(false);
      persistSidebarWidth(workspaceIdRef.current, widthRef.current);
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
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-label="Resize sidebar"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          const next = clampSidebarWidth(width - 16);
          onResize(next);
          persistSidebarWidth(workspaceId, next);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          const next = clampSidebarWidth(width + 16);
          onResize(next);
          persistSidebarWidth(workspaceId, next);
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

export { loadSidebarWidth } from "../lib/workspaceLayout";
