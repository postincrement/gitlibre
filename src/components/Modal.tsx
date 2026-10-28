import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef } from "react";

interface ModalProps {
  title: string;
  children: ReactNode;
  onClose?: () => void;
  /** When false, Escape and backdrop click do not close the dialog. Default true. */
  dismissible?: boolean;
}

export function Modal({ title, children, onClose, dismissible = true }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dismissible || !onClose) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, dismissible]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (dismissible && onClose && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-lg border border-border bg-surface-raised shadow-xl shadow-black/40"
      >
        <div className="border-b border-border px-4 py-3 text-base font-semibold text-ink">
          {title}
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="mb-4 text-sm text-ink-muted">{message}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={danger ? "btn-danger" : "btn-primary"}
          onClick={onConfirm}
          autoFocus
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

interface PromptModalProps {
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function PromptModal({
  title,
  label,
  initialValue = "",
  confirmLabel = "Create",
  onSubmit,
  onCancel,
}: PromptModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const value = inputRef.current?.value.trim() ?? "";
    if (!value) return;
    onSubmit(value);
  }

  return (
    <Modal title={title} onClose={onCancel}>
      <form onSubmit={handleSubmit}>
        <label className="mb-1 block text-sm text-ink-muted" htmlFor="prompt-input">
          {label}
        </label>
        <input
          id="prompt-input"
          ref={inputRef}
          defaultValue={initialValue}
          className="mb-4 w-full rounded-md border border-border bg-surface-overlay px-3 py-2 text-ink outline-none focus:border-accent"
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
