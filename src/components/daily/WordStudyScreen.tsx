"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, BookOpen, Loader2, Search } from "lucide-react";
import { bookByOrder, resolveReference } from "@/lib/bible/books";
import { getChapter } from "@/lib/bible/translations";
import { bibleVersePlainText } from "@/lib/bible/verseMarkup";
import { aiConsentGate } from "@/lib/ai-consent-gate";
import WordStudySection from "@/components/bible/WordStudySection";

type StudyTarget = { book: number; chapter: number; verse: number; reference: string; text: string };

export default function WordStudyScreen() {
  const { userId } = useAuth();
  return <WordStudyContent key={userId ?? "guest"} />;
}

function WordStudyContent() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<StudyTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => { sequence.current++; abort.current?.abort(); }, []);
  const open = async (value: string) => {
    const parsed = resolveReference(value);
    if (!parsed?.verse) { setError("Enter one verse, such as John 1:1 or Psalm 23:1."); return; }
    const id = ++sequence.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); setError(null); setTarget(null);
    try {
      const chapter = await getChapter("KJV", parsed.order, parsed.chapter);
      if (id !== sequence.current) return;
      const text = chapter[parsed.verse - 1];
      if (!text) { setError("That verse is outside this chapter. Check the reference and try again."); return; }
      if (!(await aiConsentGate.ensure(true, controller.signal)) || id !== sequence.current) return;
      const reference = `${bookByOrder(parsed.order)?.name} ${parsed.chapter}:${parsed.verse}`;
      setTarget({ book: parsed.order, chapter: parsed.chapter, verse: parsed.verse, reference, text: bibleVersePlainText(text) });
    } catch { if (id === sequence.current) setError("That verse could not be loaded. Check your connection and try again."); }
    finally { if (id === sequence.current) setBusy(false); }
  };
  return <main className="mx-auto max-w-3xl px-5 pb-28 pt-6 lg:px-8 lg:pb-16">
    <Link href="/study" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-amber-800 dark:text-[#e5b664]"><ArrowLeft size={17} aria-hidden />Study</Link>
    <h1 className="mt-4 font-[family-name:var(--font-cormorant)] text-4xl font-semibold">Study the words of Scripture.</h1>
    <p className="mt-4 leading-7 text-neutral-600 dark:text-[#bbb3a7]">Choose a verse to explore its Hebrew or Greek beside the King James wording. Open a word for its Strong&apos;s definition, grammar, and other passages where it appears.</p>
    <form className="mt-6 flex items-center gap-3 rounded-2xl border border-black/10 p-2 pl-4 dark:border-white/10" onSubmit={event => { event.preventDefault(); void open(input); }}><Search size={20} className="shrink-0 text-neutral-500" aria-hidden /><input value={input} onChange={event => setInput(event.target.value)} placeholder="John 1:1" aria-label="Verse to study" className="min-w-0 flex-1 bg-transparent py-3 outline-none" /><button type="submit" disabled={busy} className="flex min-h-12 items-center gap-2 rounded-xl bg-[#e5b664] px-4 text-sm font-bold text-[#1c2118] disabled:opacity-50">{busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : null}Study verse</button></form>
    {!target && !busy && <div className="mt-3 flex flex-wrap gap-2">{["John 1:1", "Psalm 23:1", "Romans 8:1"].map(example => <button type="button" key={example} onClick={() => { setInput(example); void open(example); }} className="min-h-11 rounded-full border border-black/10 px-4 text-sm text-amber-800 hover:bg-amber-500/5 dark:border-white/10 dark:text-[#e5b664]">{example}</button>)}</div>}
    {error && <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">{error}</p>}
    {target && <section key={target.reference} className="mt-8 rounded-3xl border border-black/10 bg-white/25 p-5 dark:border-white/10 dark:bg-white/[.025]"><div className="mb-4 border-b border-black/10 pb-5 dark:border-white/10"><div className="flex items-center gap-3"><h2 className="flex-1 font-bold text-amber-800 dark:text-[#e5b664]">{target.reference} · KJV</h2><Link href={`/bible/chapter?book=${target.book}&chapter=${target.chapter}&verse=${target.verse}&translation=KJV`} aria-label={`Read ${target.reference} in context`} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/5"><BookOpen size={21} aria-hidden /></Link></div><p className="mt-3 font-[family-name:var(--font-cormorant)] text-2xl leading-8">{target.text}</p></div><WordStudySection book={target.book} chapter={target.chapter} verse={target.verse} onAsk={(prompt, attach) => { const params = new URLSearchParams({ prompt }); if (attach) { params.set("attachRef", target.reference); params.set("attachText", target.text); params.set("attachTranslation", "KJV"); } router.push(`/?${params}`); }} /></section>}
  </main>;
}
