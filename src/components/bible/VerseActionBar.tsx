"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";
import { HIGHLIGHT_COLORS } from "@/lib/highlights";

export interface VerseAction {
  key: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Renders the chip amber, for a state the action already reached. */
  active?: boolean;
}

interface VerseActionBarProps {
  /** The colour the whole selection shares, or undefined when it varies. */
  color: string | undefined;
  /**
   * Some verse in the selection carries a highlight even though they do not
   * all share one, so the custom dot becomes the way to clear them.
   */
  canRemove?: boolean;
  onHighlight: (hex: string) => void;
  onRemoveHighlight: () => void;
  /** From the custom swatch's colour input, already normalised to upper case. */
  onCustomColor: (hex: string) => void;
  /** The reader's own name for a preset ("Yellow" unless renamed in Settings). */
  labelForPreset: (name: string) => string;
  actions: readonly VerseAction[];
  message?: string;
  messageTone?: "muted" | "danger";
}

const DOT =
  "h-[30px] w-[30px] shrink-0 rounded-full border border-black/10 dark:border-white/15 transition-transform hover:scale-105";
/** The ring and the ✕ together mean "tapping this again clears it". */
const DOT_ACTIVE = "ring-2 ring-amber-500 dark:ring-amber-400";
const DOT_GLYPH = "text-xs font-bold leading-none text-black/60";

const CUSTOM_WHEEL =
  "conic-gradient(#E84C3D, #F5A623, #F5D76E, #27AE60, #1ABC9C, #4A90D9, #9B59B6, #E87EA1, #E84C3D)";

function isPreset(color: string): boolean {
  return HIGHLIGHT_COLORS.some((preset) => preset.hex.toLowerCase() === color.toLowerCase());
}

/**
 * The verse panel's pinned action bar: the highlight strip over a row of icon
 * chips. Every control acts on whatever the panel currently has selected, so
 * this component knows nothing about verses or ranges - the panel hands it a
 * shared colour and a list of actions.
 */
export default function VerseActionBar({
  color,
  canRemove = false,
  onHighlight,
  onRemoveHighlight,
  onCustomColor,
  labelForPreset,
  actions,
  message,
  messageTone = "muted",
}: VerseActionBarProps) {
  // A colour that matches no preset came from the wheel, so the wheel is where
  // it must show as active and where it can be cleared.
  const customActive = color !== undefined && !isPreset(color);
  // A mixed range has no single colour to ring, so the last dot offers the
  // clear instead of the wheel.
  const mixedRemove = color === undefined && canRemove;

  return (
    <div className="flex-shrink-0 border-t border-black/[0.06] px-4 pt-2 dark:border-white/[0.06]">
      <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
        {HIGHLIGHT_COLORS.map((preset) => {
          const active = color?.toLowerCase() === preset.hex.toLowerCase();
          const label = labelForPreset(preset.name);
          return (
            <button
              key={preset.hex}
              type="button"
              aria-pressed={active}
              aria-label={active ? `Remove the ${label} highlight` : `Highlight ${label}`}
              title={label}
              onClick={() => (active ? onRemoveHighlight() : onHighlight(preset.hex))}
              className={`${DOT} flex items-center justify-center ${active ? DOT_ACTIVE : ""}`}
              style={{ backgroundColor: preset.hex }}
            >
              {active ? (
                <span aria-hidden className={DOT_GLYPH}>
                  {"✕"}
                </span>
              ) : null}
            </button>
          );
        })}

        {customActive || mixedRemove ? (
          <button
            type="button"
            aria-pressed
            aria-label={customActive ? "Remove the custom highlight" : "Remove the highlights"}
            title={customActive ? "Custom" : "Remove highlights"}
            onClick={onRemoveHighlight}
            className={`${DOT} ${DOT_ACTIVE} flex items-center justify-center ${
              customActive ? "" : "bg-black/[0.06] dark:bg-white/[0.08]"
            }`}
            style={customActive ? { backgroundColor: color } : undefined}
          >
            <span aria-hidden className={DOT_GLYPH}>
              {"✕"}
            </span>
          </button>
        ) : (
          <label
            aria-label="Custom highlight colour"
            title="Custom"
            className={`${DOT} relative flex cursor-pointer items-center justify-center overflow-hidden`}
            style={{ background: CUSTOM_WHEEL }}
          >
            <span aria-hidden className={DOT_GLYPH}>
              +
            </span>
            <input
              type="color"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              value={color ?? "#F5D76E"}
              onChange={(event) => onCustomColor(event.target.value.toUpperCase())}
            />
          </label>
        )}
      </div>

      <div className="flex items-stretch gap-1.5 overflow-x-auto pt-1">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.key}
              type="button"
              disabled={action.disabled}
              aria-pressed={action.active}
              onClick={action.onClick}
              className={`flex h-14 min-w-16 flex-1 shrink-0 flex-col items-center justify-center gap-1 rounded-xl transition-colors ${
                action.active
                  ? "bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400"
                  : "text-neutral-600 hover:bg-black/[0.05] dark:text-neutral-300 dark:hover:bg-white/[0.06]"
              } ${action.disabled ? "opacity-40" : ""}`}
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className="text-metadata font-bold">{action.label}</span>
            </button>
          );
        })}
      </div>

      {/* Always rendered so the live region exists before a message lands in it. */}
      <p
        aria-live="polite"
        className={`min-h-4 px-1 pt-1 text-metadata ${
          messageTone === "danger"
            ? "text-red-500 dark:text-red-400"
            : "text-neutral-500 dark:text-neutral-400"
        }`}
      >
        {message ?? ""}
      </p>
      <div className="pb-safe" aria-hidden />
    </div>
  );
}
