import { useState } from "react";
import {
  applyThemePreference,
  loadThemePreference,
  type ThemePreference,
} from "../lib/theme";
import {
  applyMonospaceFilenames,
  applySeparateUntrackedList,
  loadMonospaceFilenames,
  loadSeparateUntrackedList,
} from "../lib/uiSettings";
import {
  applyStatusColors,
  DEFAULT_STATUS_COLORS,
  loadStatusColors,
  resetStatusColors,
  type StatusColorKey,
  type StatusColors,
} from "../lib/statusColors";
import { Modal } from "./Modal";

interface SettingsPanelProps {
  onClose: () => void;
}

type SettingsTab = "ui" | "colours";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System default" },
];

const STATUS_COLOR_FIELDS: {
  key: StatusColorKey;
  label: string;
  letter: string;
}[] = [
  { key: "modified", label: "Modified", letter: "M" },
  { key: "added", label: "Added", letter: "A" },
  { key: "new", label: "New", letter: "U" },
];

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>("ui");
  const [theme, setTheme] = useState<ThemePreference>(() => loadThemePreference());
  const [monospaceFilenames, setMonospaceFilenames] = useState(() =>
    loadMonospaceFilenames(),
  );
  const [separateUntracked, setSeparateUntracked] = useState(() =>
    loadSeparateUntrackedList(),
  );
  const [statusColors, setStatusColors] = useState<StatusColors>(() =>
    loadStatusColors(),
  );

  function selectTheme(next: ThemePreference) {
    setTheme(next);
    applyThemePreference(next);
  }

  function updateStatusColor(key: StatusColorKey, value: string) {
    const next = { ...statusColors, [key]: value };
    setStatusColors(next);
    applyStatusColors(next);
  }

  function handleResetColours() {
    setStatusColors(resetStatusColors());
  }

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="mb-4 flex gap-1 border-b border-border">
        <TabButton active={tab === "ui"} onClick={() => setTab("ui")}>
          UI features
        </TabButton>
        <TabButton active={tab === "colours"} onClick={() => setTab("colours")}>
          Colours
        </TabButton>
      </div>

      {/* Both panels share one grid cell so the dialog keeps a stable size. */}
      <div className="grid [&>*]:col-start-1 [&>*]:row-start-1">
        <section
          className={[
            "space-y-3",
            tab === "ui" ? "" : "invisible pointer-events-none",
          ].join(" ")}
          aria-hidden={tab !== "ui"}
        >
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--color-accent)]"
              checked={monospaceFilenames}
              tabIndex={tab === "ui" ? 0 : -1}
              onChange={(e) => {
                const next = e.target.checked;
                setMonospaceFilenames(next);
                applyMonospaceFilenames(next);
              }}
            />
            <span>
              <span className="block">Use monospace font for filenames</span>
              <span className="mt-0.5 block text-xs text-ink-muted">
                When off, file lists use the same proportional font as the rest of
                the UI.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--color-accent)]"
              checked={separateUntracked}
              tabIndex={tab === "ui" ? 0 : -1}
              onChange={(e) => {
                const next = e.target.checked;
                setSeparateUntracked(next);
                applySeparateUntrackedList(next);
              }}
            />
            <span>
              <span className="block">Use separate list for untracked files</span>
              <span className="mt-0.5 block text-xs text-ink-muted">
                When off, untracked files are listed with other unstaged files.
              </span>
            </span>
          </label>
        </section>

        <div
          className={[
            "space-y-5",
            tab === "colours" ? "" : "invisible pointer-events-none",
          ].join(" ")}
          aria-hidden={tab !== "colours"}
        >
          <section>
            <h3 className="mb-2 text-sm font-medium text-ink">Theme</h3>
            <fieldset className="space-y-1.5">
              <legend className="mb-0 text-[0px] leading-none">Theme</legend>
              {THEME_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2.5 text-sm text-ink"
                >
                  <input
                    type="radio"
                    name="theme"
                    className="accent-[var(--color-accent)]"
                    checked={theme === option.value}
                    tabIndex={tab === "colours" ? 0 : -1}
                    onChange={() => selectTheme(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-medium text-ink">File status colours</h3>
            <div className="space-y-2.5">
              {STATUS_COLOR_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-sm text-ink">
                    {field.label}
                  </span>
                  <StatusColorSwatch
                    letter={field.letter}
                    color={statusColors[field.key]}
                  />
                  <input
                    type="color"
                    className="h-7 w-7 shrink-0 cursor-pointer appearance-none border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[3px] [&::-webkit-color-swatch]:border-0"
                    value={statusColors[field.key]}
                    title={`Default ${DEFAULT_STATUS_COLORS[field.key]}`}
                    tabIndex={tab === "colours" ? 0 : -1}
                    onChange={(e) => updateStatusColor(field.key, e.target.value)}
                  />
                  <input
                    type="text"
                    className="w-[5.5rem] shrink-0 rounded-md border border-border bg-surface-overlay px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent"
                    value={statusColors[field.key]}
                    spellCheck={false}
                    tabIndex={tab === "colours" ? 0 : -1}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setStatusColors((prev) => ({ ...prev, [field.key]: raw }));
                      if (/^#[0-9a-fA-F]{6}$/.test(raw.trim())) {
                        updateStatusColor(field.key, raw.trim());
                      }
                    }}
                    onBlur={() => {
                      const normalized = statusColors[field.key].trim();
                      if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
                        updateStatusColor(field.key, normalized);
                      } else {
                        setStatusColors(loadStatusColors());
                      }
                    }}
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn-secondary mt-3"
              tabIndex={tab === "colours" ? 0 : -1}
              onClick={handleResetColours}
            >
              Reset colours
            </button>
          </section>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <button type="button" className="btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "-mb-px border-b-2 px-3 py-2 text-sm transition",
        active
          ? "border-accent font-medium text-ink"
          : "border-transparent text-ink-muted hover:text-ink",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function StatusColorSwatch({ letter, color }: { letter: string; color: string }) {
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] font-mono text-[11px] font-bold leading-none text-[#1a1200] [:is(html.light)_&]:text-white"
      style={{ backgroundColor: color }}
      aria-hidden
    >
      {letter}
    </span>
  );
}
