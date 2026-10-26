"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, ArrowRight, BookOpen, ChevronRight, Loader2, MessageCircle, Search, Sparkles } from "lucide-react";
import { BOOKS, bookByOrder, resolveReference } from "@/lib/bible/books";
import { CONNECTION_SECTIONS, connectionSectionOf, connectionsAskPrompt, sectionCounts, sectionInk, type ChapterLink } from "@/lib/bible/connectionsMap";
import { getChapter, parseTranslationId, TRANSLATIONS, type TranslationId } from "@/lib/bible/translations";
import { bibleVersePlainText } from "@/lib/bible/verseMarkup";
import { readTranslationPref } from "@/lib/preferences";
import { usePreference } from "@/lib/preferencesSync";
import ConnectionsRing from "./ConnectionsRing";
import ExplainDialog from "./ExplainDialog";
import { loadChapterConnections, loadConnectionsOverview, loadLinkedQuotes, quoteFor, type ChapterConnections, type ConnectionsOverview } from "./connectionsData";
import { useConnectionsExplain } from "./useConnectionsExplain";

const NO_LINKS: ChapterLink[] = [];
const positive = (value: string | null) => value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const control = "flex min-h-11 items-center justify-center gap-2 rounded-xl border border-black/10 px-3 text-sm font-bold transition-colors hover:bg-black/5 disabled:opacity-30 dark:border-white/10 dark:hover:bg-white/5";

export default function ConnectionsScreen() {
  const { userId } = useAuth();
  return <ConnectionsContent key={userId ?? "guest"} />;
}

function ConnectionsContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const accountTranslation = usePreference<TranslationId>(readTranslationPref, "KJV");
  const routeTranslation = params.get("translation");
  const translation: TranslationId = parseTranslationId(routeTranslation, accountTranslation);
  const paramBook = positive(params.get("book"));
  const paramChapter = positive(params.get("chapter"));
  const scopedBook = paramBook ? bookByOrder(paramBook) : null;
  const hasScope = params.has("book") || params.has("chapter") || params.has("verse");
  const invalidScope = hasScope && (!scopedBook || !paramChapter || paramChapter > scopedBook.chapters || (params.has("verse") && !positive(params.get("verse"))));
  const order = !invalidScope && paramBook ? paramBook : 43;
  const chapter = !invalidScope && paramChapter ? paramChapter : 3;
  const verse = hasScope ? positive(params.get("verse")) : 16;
  const book = bookByOrder(order) ?? BOOKS[42];
  const [section, setSection] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [queryError, setQueryError] = useState(false);
  const [overview, setOverview] = useState<ConnectionsOverview | null>(null);
  const [data, setData] = useState<ChapterConnections | null>(null);
  const [texts, setTexts] = useState<{ key: string; value: string[] }>({ key: "", value: [] });
  const [quotes, setQuotes] = useState(new Map<string, string>());
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [explainOpen, setExplainOpen] = useState(false);
  const explain = useConnectionsExplain();
  const { reset } = explain;
  const textKey = `${order}:${chapter}:${translation}`;
  const chapterTexts = texts.key === textKey ? texts.value : [];
  const placeData = data?.order === order && data.chapter === chapter ? data : null;
  const invalidVerse = !!placeData && verse !== null && verse > placeData.verseCount;
  const focusVerse = invalidScope || invalidVerse ? null : verse;
  const focusRef = focusVerse === null ? null : `${book.name} ${chapter}:${focusVerse}`;

  useEffect(() => {
    let live = true;
    void loadConnectionsOverview().then(value => { if (live) setOverview(value); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let live = true;
    setError(false);
    void loadChapterConnections(order, chapter).then(value => { if (live) setData(value); }).catch(() => { if (live) setError(true); });
    void getChapter(translation, order, chapter).then(value => { if (live) setTexts({ key: textKey, value: value.map(bibleVersePlainText) }); }).catch(() => { if (live) setTexts({ key: textKey, value: [] }); });
    return () => { live = false; };
  }, [order, chapter, translation, textKey, attempt]);
  useEffect(() => {
    let live = true;
    setQuotes(new Map());
    if (focusRef) void loadLinkedQuotes(focusRef, translation).then(value => { if (live) setQuotes(value); }).catch(() => undefined);
    return () => { live = false; };
  }, [focusRef, translation]);
  // A completed or streaming answer belongs to exactly one verse, section, and translation.
  useEffect(() => { setExplainOpen(false); reset(); }, [focusRef, translation, section, reset]);

  const links = placeData?.links ?? NO_LINKS;
  const scopeLinks = useMemo(() => focusVerse === null ? links : links.filter(link => link[0] === focusVerse), [links, focusVerse]);
  const shownLinks = useMemo(() => section ? scopeLinks.filter(link => connectionSectionOf(link[1]).id === section) : scopeLinks, [scopeLinks, section]);
  const counts = useMemo(() => sectionCounts(scopeLinks.map(link => link[1])), [scopeLinks]);
  const countsByVerse = useMemo(() => { const counts = new Map<number, number>(); for (const link of links) counts.set(link[0], (counts.get(link[0]) ?? 0) + 1); return counts; }, [links]);
  const sectionLabel = CONNECTION_SECTIONS.find(candidate => candidate.id === section)?.label ?? null;
  const linkedReferences = shownLinks.map(([, order, chapter, verse]) => `${bookByOrder(order)?.name ?? ""} ${chapter}:${verse}`);
  const chatHref = focusRef ? `/?${new URLSearchParams({ prompt: connectionsAskPrompt(focusRef, linkedReferences), attachRef: focusRef, attachText: chapterTexts[(focusVerse ?? 1) - 1] ?? "", attachTranslation: translation })}` : "/";
  const readerHref = (order: number, chapter: number, verse?: number) => `/bible/chapter?book=${order}&chapter=${chapter}${verse ? `&verse=${verse}` : ""}&translation=${translation}`;
  const navigate = useCallback((order: number, chapter: number, verse?: number) => {
    setSection(null);
    router.push(`/connections?book=${order}&chapter=${chapter}${verse ? `&verse=${verse}` : ""}&translation=${translation}`, { scroll: false });
  }, [router, translation]);
  const focus = (verse?: number) => router.replace(`/connections?book=${order}&chapter=${chapter}${verse ? `&verse=${verse}` : ""}&translation=${translation}`, { scroll: false });
  const previous = chapter > 1 ? { order, chapter: chapter - 1 } : order > 1 ? { order: order - 1, chapter: bookByOrder(order - 1)?.chapters ?? 1 } : null;
  const next = chapter < book.chapters ? { order, chapter: chapter + 1 } : order < 66 ? { order: order + 1, chapter: 1 } : null;
  const startExplain = () => { if (focusRef) { setExplainOpen(true); explain.start({ reference: focusRef, translation, section }); } };

  return <main className="mx-auto w-full max-w-6xl px-5 pb-28 pt-6 lg:px-8 lg:pb-16">
    <header className="mb-6 flex items-start gap-4"><div className="flex-1"><p className="text-xs font-bold uppercase tracking-[.23em] text-amber-800 dark:text-[#e5b664]">Connections</p><h1 className="mt-2 font-[family-name:var(--font-cormorant)] text-3xl font-semibold sm:text-4xl">Scripture interprets Scripture.</h1></div><Link href={readerHref(order, chapter, focusVerse ?? undefined)} aria-label={`Read ${book.name} ${chapter}`} className={control}><BookOpen size={21} aria-hidden /><span className="hidden sm:inline">Read chapter</span></Link></header>
    {(invalidScope || invalidVerse) && <div role="alert" className="mb-4 rounded-xl border border-amber-700/30 p-4"><p>That reference is outside the Bible. Choose a valid chapter or verse below.</p><button type="button" onClick={() => navigate(order, chapter)} className="mt-2 min-h-11 font-bold text-amber-800 dark:text-[#e5b664]">Show {book.name} {chapter}</button></div>}
    <form onSubmit={event => { event.preventDefault(); const target = resolveReference(query); if (!target) { setQueryError(true); return; } setQueryError(false); setQuery(""); navigate(target.order, target.chapter, target.verse); }} className="mb-3 flex min-h-12 items-center gap-3 rounded-2xl border border-black/10 px-4 dark:border-white/10"><Search size={19} className="shrink-0 text-neutral-500" aria-hidden /><input value={query} onChange={event => { setQuery(event.target.value); setQueryError(false); }} aria-label="Go to a verse or chapter" placeholder="Go to John 3:16, Psalm 22..." className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none" /><button type="submit" className="min-h-11 px-2 text-sm font-bold text-amber-800 dark:text-[#e5b664]">Go</button></form>
    {queryError && <p role="alert" className="mb-3 text-sm text-red-700 dark:text-red-300">Try a reference like Romans 8 or John 3:16.</p>}
    <div className="grid gap-7 lg:grid-cols-[1fr_1fr] lg:items-start">
      <section aria-label="Connections map">
        <div className="flex items-center gap-2"><button type="button" disabled={!previous} aria-label="Previous chapter" className={control} onClick={() => previous && navigate(previous.order, previous.chapter)}><ArrowLeft size={18} aria-hidden /></button><label className="sr-only" htmlFor="connection-book">Book</label><select id="connection-book" value={order} onChange={event => navigate(Number(event.target.value), 1)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-black/10 bg-transparent px-3 text-sm font-bold dark:border-white/10 dark:bg-[#0d100d]">{BOOKS.map(book => <option key={book.order} value={book.order}>{book.name}</option>)}</select><label className="sr-only" htmlFor="connection-chapter">Chapter</label><select id="connection-chapter" value={chapter} onChange={event => navigate(order, Number(event.target.value))} className="min-h-11 rounded-xl border border-black/10 bg-transparent px-2 text-sm font-bold dark:border-white/10 dark:bg-[#0d100d]">{Array.from({ length: book.chapters }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select><button type="button" disabled={!next} aria-label="Next chapter" className={control} onClick={() => next && navigate(next.order, next.chapter)}><ArrowRight size={18} aria-hidden /></button></div>
        <ConnectionsRing total={placeData?.total ?? overview?.total ?? 31102} books={placeData?.books ?? overview?.books ?? []} overview={overview} links={links} chapterStart={placeData?.chapterStart ?? null} order={order} focusVerse={focusVerse} sectionFilter={section} title={focusRef ?? `${book.name} ${chapter}`} subtitle={placeData ? `${shownLinks.length} connections` : error ? "Could not load" : "Loading..."} onBookPress={order => setSection(current => current === connectionSectionOf(order).id ? null : connectionSectionOf(order).id)} onCenterPress={() => focus()} />
        {error ? <div role="alert" className="mb-4 rounded-xl border border-red-600/20 p-4"><p>Connections could not load.</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-11 font-bold text-amber-800 dark:text-[#e5b664]">Try again</button></div> : !placeData && <p role="status" className="mb-4 flex items-center justify-center gap-2 text-sm text-neutral-500"><Loader2 size={18} className="animate-spin" aria-hidden />Loading chapter connections...</p>}
        <div aria-label="Filter connections by Bible section" className="flex flex-wrap gap-2"><button type="button" aria-pressed={section === null} onClick={() => setSection(null)} className={`${control} ${section === null ? "bg-amber-500/10" : ""}`}>All {scopeLinks.length}</button>{CONNECTION_SECTIONS.map(item => {
          const count = counts.get(item.id) ?? 0;
          return <button type="button" key={item.id} aria-pressed={section === item.id} onClick={() => setSection(current => current === item.id ? null : item.id)} className={control} style={section === item.id ? { borderColor: item.color, backgroundColor: `${item.color}15` } : undefined}><span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} /><span>{item.label} {count}</span></button>;
        })}</div>
        <p className="mt-4 text-xs leading-5 text-neutral-600 dark:text-neutral-400">Each arc follows a cross-reference. Choose a verse to focus its links, or a section to trace where they lead.</p>
      </section>
      <section aria-label={focusRef ? `Passages connected to ${focusRef}` : `Verses in ${book.name} ${chapter}`} className="rounded-3xl border border-black/10 bg-white/25 p-4 dark:border-white/10 dark:bg-white/[.02] sm:p-5">
        {focusRef ? <>
          <div className="flex items-center gap-3"><h2 className="flex-1 text-sm font-bold uppercase tracking-wider text-amber-800 dark:text-[#e5b664]">{focusRef}</h2><span className="text-xs text-neutral-500 dark:text-neutral-400">{TRANSLATIONS[translation].label}</span></div>
          {chapterTexts[(focusVerse ?? 1) - 1] ? <p className="mt-4 font-[family-name:var(--font-cormorant)] text-[26px] leading-8">{chapterTexts[(focusVerse ?? 1) - 1]}</p> : <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">The verse text is unavailable. <Link href={readerHref(order, chapter, focusVerse ?? undefined)} className="underline">Open this verse in the reader</Link>.</p>}
          <div className="mb-4 mt-5 flex items-center justify-between gap-3 border-t border-black/10 pt-4 dark:border-white/10"><h3 className="text-xs font-bold uppercase tracking-wider">Connected verses · {shownLinks.length}</h3><button type="button" onClick={() => focus()} className="min-h-11 text-sm font-bold text-amber-800 dark:text-[#e5b664]">Whole chapter</button></div>
          {!shownLinks.length && <p className="py-4 text-sm text-neutral-600 dark:text-neutral-400">{!placeData ? error ? "Connections are unavailable. Use Try again on the map." : "Loading connected passages..." : sectionLabel && scopeLinks.length ? `No links into ${sectionLabel} from this verse. Choose All to see its other connections.` : "No connected passages are listed for this verse."}</p>}
          <div className="flex flex-col gap-3">{shownLinks.map(([, targetOrder, targetChapter, targetVerse, index], position) => {
            const category = connectionSectionOf(targetOrder);
            const reference = `${bookByOrder(targetOrder)?.name ?? ""} ${targetChapter}:${targetVerse}`;
            const quote = quoteFor(quotes, reference);
            return <Link key={`${index}:${position}`} href={readerHref(targetOrder, targetChapter, targetVerse)} className="rounded-2xl border border-black/10 px-4 py-3 transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"><div className="flex flex-wrap items-center gap-2"><span className="flex-1 font-bold">{reference}</span><span className="rounded-full border px-2 py-1 text-metadata font-bold" style={{ borderColor: `${category.color}88`, color: sectionInk(category.color, isDark) }}>{category.label}</span><ChevronRight size={17} aria-hidden /></div>{quote && <p className="mt-2 line-clamp-3 text-sm leading-6 text-neutral-600 dark:text-neutral-300">&ldquo;{quote}&rdquo;</p>}</Link>;
          })}</div>
          <button type="button" disabled={!shownLinks.length || !chapterTexts.length} onClick={startExplain} className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-[#e5b664] px-4 font-bold text-[#1c2118] hover:bg-[#f0c77f] disabled:opacity-40"><Sparkles size={19} aria-hidden />Ask why these connect</button>
          <Link href={chatHref} className="mt-2 flex min-h-12 items-center justify-center gap-2 text-sm font-bold text-amber-800 dark:text-[#e5b664]"><MessageCircle size={18} aria-hidden />Study these connections in Chat</Link>
        </> : <>
          <h2 className="font-[family-name:var(--font-cormorant)] text-3xl font-semibold">{book.name} {chapter}</h2><p className="mb-4 mt-2 text-sm text-neutral-600 dark:text-neutral-400">Choose a verse to follow its connected passages.</p>
          <div className="flex flex-col divide-y divide-black/10 dark:divide-white/10">{chapterTexts.map((text, index) => <button type="button" key={index} onClick={() => focus(index + 1)} className="flex min-h-14 gap-3 py-4 text-left hover:bg-black/[.025] dark:hover:bg-white/[.025]"><span className="w-6 shrink-0 text-sm font-bold text-amber-800 dark:text-[#e5b664]">{index + 1}</span><span className="flex-1"><span className="font-[family-name:var(--font-cormorant)] text-xl leading-7">{text}</span><span className="mt-1 block text-xs text-neutral-500 dark:text-neutral-400">{countsByVerse.get(index + 1) ?? 0} connections</span></span><ChevronRight size={17} className="mt-1 shrink-0 text-neutral-500" aria-hidden /></button>)}</div>
          {!chapterTexts.length && <p className="py-4 text-sm text-neutral-600 dark:text-neutral-400">The chapter text is unavailable. <Link href={readerHref(order, chapter)} className="underline">Open it in the reader</Link>.</p>}
        </>}
      </section>
    </div>
    {explainOpen && focusRef && <ExplainDialog reference={focusRef} sectionLabel={sectionLabel} translation={translation} status={explain.status} text={explain.text} error={explain.error} chatHref={chatHref} onClose={() => { setExplainOpen(false); reset(); }} onRetry={startExplain} />}
  </main>;
}
