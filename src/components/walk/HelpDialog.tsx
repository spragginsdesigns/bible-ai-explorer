"use client";

import { CircleCheck, MessageCircle, X } from "lucide-react";
import { useModalFocus } from "@/components/useModalFocus";
import { HELP_SHEETS, type HelpScreen } from "@/lib/onboarding-rules";

/**
 * What a "?" opens: a few plain lines about the screen, shown right away with
 * nothing sent. "Ask SureWord about this" sends the screen's fixed help
 * sentence, which the server recognises as app help (same as Android).
 */
export default function HelpDialog({ screen, onClose, onAsk }: { screen: HelpScreen; onClose: () => void; onAsk: () => void }) {
  const ref = useModalFocus<HTMLDivElement>({ open: true, onClose });
  const sheet = HELP_SHEETS[screen];
  return <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-5" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="help-sheet-title" tabIndex={-1} className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-3xl border border-black/10 bg-[#f6f2e9] text-[#24281f] shadow-xl outline-none dark:border-white/10 dark:bg-[#111710] dark:text-[#f1eadc] sm:rounded-3xl">
      <header className="flex items-center gap-4 border-b border-black/10 px-5 py-4 dark:border-white/10"><h2 id="help-sheet-title" className="flex-1 text-xl font-bold">{sheet.title}</h2><button type="button" aria-label="Close help" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/5"><X size={22} aria-hidden /></button></header>
      <div className="overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <ul className="flex flex-col gap-3">{sheet.points.map(point => <li key={point} className="flex items-start gap-3 leading-6"><CircleCheck size={20} className="mt-0.5 shrink-0 text-amber-800 dark:text-[#e5b664]" aria-hidden />{point}</li>)}</ul>
        <button type="button" onClick={onAsk} className="mt-5 flex min-h-12 w-full items-center justify-center gap-3 rounded-full border border-amber-800/30 font-bold text-amber-800 hover:bg-amber-800/5 dark:border-amber-300/30 dark:text-[#e5b664] dark:hover:bg-white/5"><MessageCircle size={19} aria-hidden />Ask SureWord about this</button>
      </div>
    </div>
  </div>;
}
