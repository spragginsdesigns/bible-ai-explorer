"use client";

import { useId } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useModalFocus } from "@/components/useModalFocus";
import TextSizeControl from "./TextSizeControl";

/** Keep the current page and its unsent work mounted while adjusting text. */
export default function TextSizeDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const panelRef = useModalFocus<HTMLDivElement>({ open: true, onClose });

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-[8px] backdrop-blur-sm"
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[calc(100dvh-16px)] w-full min-w-0 max-w-xl flex-col overflow-hidden rounded-2xl border border-black/10 bg-[#faf7ef] text-neutral-900 shadow-xl outline-none dark:border-white/10 dark:bg-[#171b16] dark:text-neutral-100"
      >
        <header className="flex shrink-0 items-center gap-[8px] border-b border-black/10 px-[16px] py-[8px] dark:border-white/10">
          <h2 id={titleId} className="min-w-0 flex-1 text-body font-semibold [overflow-wrap:anywhere]">Text size</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close text size"
            className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full hover:bg-black/5 focus-visible:outline-amber-600 dark:hover:bg-white/5"
          >
            <X size={22} aria-hidden />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          <TextSizeControl mounted />
        </div>
      </div>
    </div>,
    document.body,
  );
}
