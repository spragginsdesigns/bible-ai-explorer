"use client";

import React from "react";

/**
 * The scrolling body the tabs drive. The panel puts this id on the body so a
 * screen reader follows the tab into the content it reveals.
 */
export const STUDY_PANEL_ID = "verse-study-panel";

export interface StudyTab<Key extends string> {
  key: Key;
  label: string;
}

interface StudyTabsProps<Key extends string> {
  tabs: readonly StudyTab<Key>[];
  active: Key;
  onChange: (key: Key) => void;
  /** Names the group for screen readers. */
  label: string;
}

/**
 * Segmented control for the verse panel's study views. Purely presentational:
 * the panel owns which tab is active and what the body renders, so the same
 * control can front a different set of views later.
 */
export default function StudyTabs<Key extends string>({
  tabs,
  active,
  onChange,
  label,
}: StudyTabsProps<Key>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex flex-shrink-0 gap-1 rounded-xl border border-black/[0.08] bg-black/[0.03] p-1 dark:border-white/[0.08] dark:bg-white/[0.03]"
    >
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`${STUDY_PANEL_ID}-tab-${tab.key}`}
            aria-selected={selected}
            aria-controls={STUDY_PANEL_ID}
            onClick={() => onChange(tab.key)}
            className={`min-h-9 flex-1 rounded-lg px-2 text-[13px] font-bold transition-colors ${
              selected
                ? "bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400"
                : "text-neutral-500 hover:bg-black/[0.05] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
