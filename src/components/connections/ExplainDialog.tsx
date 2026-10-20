"use client";

import Link from "next/link";
import { Loader2, MessageCircle, X } from "lucide-react";
import { resolveReference } from "@/lib/bible/books";
import { parseConnectionExplanation } from "@/lib/bible/connectionsMap";
import { useModalFocus } from "@/components/useModalFocus";
import type { ExplainStatus } from "./useConnectionsExplain";
import type { TranslationId } from "@/lib/bible/translations";

export default function ExplainDialog({ reference, sectionLabel, translation, status, text, error, chatHref, onClose, onRetry }: { reference: string; sectionLabel: string | null; translation: TranslationId; status: ExplainStatus; text: string; error: string | null; chatHref: string; onClose: () => void; onRetry: () => void }) {
  const ref = useModalFocus<HTMLDivElement>({ open: true, onClose });
  const parsed = parseConnectionExplanation(text, status === "done");
  const busy = status === "loading" || status === "streaming";
  return <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-5" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="connections-explain-title" tabIndex={-1} className="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-t-3xl border border-black/10 bg-[#f6f2e9] text-[#24281f] shadow-xl outline-none dark:border-white/10 dark:bg-[#111710] dark:text-[#f1eadc] sm:rounded-3xl">
      <header className="flex items-center gap-4 border-b border-black/10 px-5 py-4 dark:border-white/10"><div className="flex-1"><h2 id="connections-explain-title" className="text-xl font-bold">Why these connect</h2><p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{reference}{sectionLabel ? ` · ${sectionLabel}` : ""}</p></div><button type="button" aria-label="Close explanation" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/5"><X size={22} aria-hidden /></button></header>
      <div className="overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {status === "error" && <div role="alert" className="mb-4 rounded-xl border border-red-600/30 p-4"><p>{error ?? "These connections could not be explained."}</p><button type="button" onClick={onRetry} className="mt-2 min-h-11 font-bold text-amber-800 dark:text-[#e5b664]">Try again</button></div>}
        {status === "loading" && <p role="status" className="flex items-center gap-3 py-4 text-sm"><Loader2 className="animate-spin" size={20} aria-hidden />Tracing the links through Scripture...</p>}
        {parsed.summary && <p className="mb-5 whitespace-pre-line font-[family-name:var(--font-cormorant)] text-2xl leading-8">{parsed.summary}</p>}
        <div className="flex flex-col gap-3">{parsed.items.map(item => {
          const target = resolveReference(item.reference);
          const body = <><span className="font-bold text-amber-800 dark:text-[#e5b664]">{item.reference}</span><p className="mt-2 leading-6">{item.text}</p></>;
          return target ? <Link key={item.reference} href={`/bible/chapter?book=${target.order}&chapter=${target.chapter}&verse=${target.verse ?? 1}&translation=${translation}`} className="rounded-2xl border border-black/10 p-4 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5">{body}</Link> : <div key={item.reference} className="rounded-2xl border border-black/10 p-4 dark:border-white/10">{body}</div>;
        })}</div>
        {busy && parsed.items.length > 0 && <Loader2 aria-label="Still tracing connections" className="mx-auto my-4 animate-spin" size={22} />}
        {status === "done" && <Link href={chatHref} className="mt-5 flex min-h-12 items-center justify-center gap-3 rounded-full border border-amber-800/30 font-bold text-amber-800 dark:border-amber-300/30 dark:text-[#e5b664]"><MessageCircle size={19} aria-hidden />Keep studying this in Chat</Link>}
      </div>
    </div>
  </div>;
}
