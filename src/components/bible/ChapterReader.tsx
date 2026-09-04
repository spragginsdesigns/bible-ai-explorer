"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Users, X } from "lucide-react";
import { bookByOrder } from "@/lib/bible/books";
import { getChapter, TRANSLATIONS, type TranslationId } from "@/lib/bible/translations";
import { formatVerseForSharing, saveVerseToNote } from "@/lib/bible/verseActions";
import { readParchmentPref, readTranslationPref } from "@/lib/preferences";
import { setTranslationPreference, usePreference } from "@/lib/preferencesSync";
import { HIGHLIGHT_COLORS, highlightWash } from "@/lib/highlights";
import OriginalLanguageSection from "./OriginalLanguageSection";
import { useChapterHighlights } from "./useChapterHighlights";
import { useVerseInsight } from "./useVerseInsight";

const FONT_STEPS = [17, 20, 24, 28] as const;
const FONT_STEP_KEY = "bible-reader-font-step";
const HIGHLIGHT_MS = 2400;

interface ActionVerse {
  number: number;
  text: string;
}

function readFontStep(): number {
  if (typeof window === "undefined") return 1;
  const raw = Number.parseInt(window.sessionStorage.getItem(FONT_STEP_KEY) ?? "", 10);
  if (!Number.isInteger(raw)) return 1;
  return Math.min(FONT_STEPS.length - 1, Math.max(0, raw));
}

/**
 * Chapter reading screen: bundled KJV (offline) or NKJV (bolls.life), verse
 * click actions (copy/share/save/Ask AI), adjustable type size, and prev/next
 * navigation that rolls into adjacent books like YouVersion. Mirrors
 * mobile/app/(app)/bible/chapter.tsx.
 */
const ChapterReader: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const order = Number.parseInt(searchParams.get("book") ?? "1", 10);
  const chapter = Number.parseInt(searchParams.get("chapter") ?? "1", 10);
  const verseParam = Number.parseInt(searchParams.get("verse") ?? "", 10) || null;

  const book = bookByOrder(order);
  // Both come from the account document, so they follow a change made in
  // Settings, in another tab, or on the phone without a reload.
  const translation = usePreference<TranslationId>(readTranslationPref, "KJV");
  const parchment = usePreference(readParchmentPref, true);
  const [verses, setVerses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fontStep, setFontStep] = useState(readFontStep);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [actionVerse, setActionVerse] = useState<ActionVerse | null>(null);
  const [copied, setCopied] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const {
    status: insightStatus,
    text: insightText,
    error: insightError,
    start: startInsight,
    reset: resetInsight,
  } = useVerseInsight();
  const {
    highlights: verseHighlights,
    setColor: setHighlightColor,
    remove: removeHighlight,
  } = useChapterHighlights(translation, order, chapter);

  const lastFlashed = useRef<string | null>(null);
  const lastRecordedRead = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getChapter(translation, order, chapter);
      setVerses(next);
    } catch (err) {
      setVerses([]);
      setError(err instanceof Error ? err.message : "That chapter could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [translation, order, chapter]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await getChapter(translation, order, chapter);
        if (cancelled) return;
        setVerses(next);
        window.scrollTo(0, 0);
      } catch (err) {
        if (cancelled) return;
        setVerses([]);
        setError(err instanceof Error ? err.message : "That chapter could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [translation, order, chapter]);

  // ?verse= deep link: scroll to the verse once the chapter is on screen and
  // flash it briefly so the eye lands there.
  useEffect(() => {
    if (loading || error || !verses.length) return;
    if (!verseParam || verseParam < 1 || verseParam > verses.length) return;
    const flashKey = `${translation}:${order}:${chapter}:${verseParam}`;
    if (lastFlashed.current === flashKey) return;
    lastFlashed.current = flashKey;
    const scrollTimer = setTimeout(() => {
      document
        .getElementById(`bible-verse-${verseParam}`)
        ?.scrollIntoView({ block: "start" });
      setHighlighted(verseParam);
      setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
    }, 250);
    return () => clearTimeout(scrollTimer);
  }, [loading, error, verses, translation, order, chapter, verseParam]);

  // Reading history for the verse-of-the-day cron: count a chapter once it has
  // been on screen ~5s, at most once per chapter view (the ref also absorbs
  // StrictMode's double effect). Fire-and-forget — failures are swallowed.
  useEffect(() => {
    if (loading || error || !verses.length || !book) return;
    const readKey = `${translation}:${order}:${chapter}`;
    if (lastRecordedRead.current === readKey) return;
    const recordTimer = setTimeout(() => {
      lastRecordedRead.current = readKey;
      fetch("/api/reading-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book: book.name, chapter, translation }),
      }).catch(() => {});
    }, 5000);
    return () => clearTimeout(recordTimer);
  }, [loading, error, verses, book, translation, order, chapter]);

  // The reader's chips and Settings share one account preference.
  const setTranslation = useCallback((id: TranslationId) => {
    void setTranslationPreference(id);
  }, []);

  const stepFont = useCallback((delta: number) => {
    setFontStep((step) => {
      const next = Math.min(FONT_STEPS.length - 1, Math.max(0, step + delta));
      window.sessionStorage.setItem(FONT_STEP_KEY, String(next));
      return next;
    });
  }, []);

  const neighbors = useMemo(() => {
    const current = bookByOrder(order);
    if (!current) return { prev: null, next: null };
    const at = (o: number, c: number) => ({ order: o, chapter: c });
    const prevBook = bookByOrder(order - 1);
    const nextBook = bookByOrder(order + 1);
    return {
      prev:
        chapter > 1 ? at(order, chapter - 1) : prevBook ? at(prevBook.order, prevBook.chapters) : null,
      next:
        chapter < current.chapters ? at(order, chapter + 1) : nextBook ? at(nextBook.order, 1) : null,
    };
  }, [order, chapter]);

  const reference = book ? `${book.name} ${chapter}` : "";
  const actionReference = actionVerse ? `${reference}:${actionVerse.number}` : "";
  const actionColor = actionVerse ? verseHighlights.get(actionVerse.number) : undefined;

  const closePanel = useCallback(() => {
    setActionVerse(null);
    setCopied(false);
    setSaveError(null);
    resetInsight();
  }, [resetInsight]);

  // Tap-a-verse: opening the panel immediately starts streaming a short AI
  // explanation of the clicked verse (cached per verse for the session).
  const openVerse = useCallback(
    (verse: ActionVerse) => {
      setActionVerse(verse);
      startInsight({
        reference: `${reference}:${verse.number}`,
        text: verse.text,
        translation,
      });
    },
    [startInsight, reference, translation]
  );

  // Escape closes the verse sheet, matching every other dismissable panel in
  // the app (and the close X added alongside it).
  useEffect(() => {
    if (!actionVerse) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [actionVerse, closePanel]);

  const retryInsight = useCallback(() => {
    if (!actionVerse) return;
    startInsight({ reference: actionReference, text: actionVerse.text, translation });
  }, [actionVerse, actionReference, startInsight, translation]);

  const askAI = useCallback(
    (verse: { reference: string; text: string }) => {
      closePanel();
      router.push(
        `/?attachRef=${encodeURIComponent(verse.reference)}` +
          `&attachText=${encodeURIComponent(verse.text)}` +
          `&attachTranslation=${translation}`
      );
    },
    [router, closePanel, translation]
  );

  const onCopyVerse = useCallback(async () => {
    if (!actionVerse) return;
    await navigator.clipboard.writeText(
      formatVerseForSharing({ reference: actionReference, text: actionVerse.text }, translation)
    );
    setCopied(true);
    setTimeout(closePanel, 600);
  }, [actionVerse, actionReference, translation, closePanel]);

  const onShareVerse = useCallback(async () => {
    if (!actionVerse) return;
    const message = formatVerseForSharing(
      { reference: actionReference, text: actionVerse.text },
      translation
    );
    if (typeof navigator.share === "function") {
      navigator.share({ text: message }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(message).catch(() => {});
    }
    closePanel();
  }, [actionVerse, actionReference, translation, closePanel]);

  const onSaveVerse = useCallback(async () => {
    if (!actionVerse || saveBusy) return;
    setSaveBusy(true);
    setSaveError(null);
    try {
      await saveVerseToNote({ reference: actionReference, text: actionVerse.text }, translation);
      closePanel();
      router.push("/notes");
    } catch {
      setSaveError("The note could not be saved. Check your connection and try again.");
    } finally {
      setSaveBusy(false);
    }
  }, [actionVerse, actionReference, saveBusy, router, closePanel, translation]);

  const fontSize = FONT_STEPS[fontStep];
  const lineHeight = Math.round(fontSize * 1.55);

  const navHref = (target: { order: number; chapter: number }) =>
    `/bible/chapter?book=${target.order}&chapter=${target.chapter}`;

  if (!book) {
    return (
      <div className="min-h-[100dvh] gradient-mesh">
        <div className="mx-auto w-full max-w-2xl px-5">
          <div className="flex items-center py-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="text-[15px] font-semibold text-amber-600 dark:text-amber-400"
            >
              ‹ Back
            </button>
          </div>
          <div className="flex items-center justify-center p-8">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">That book could not be found.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] gradient-mesh">
      {/* Bottom padding reserves the floating Ask AI pill's band (its offset
          plus its height plus a gap) so the pill never lands on verse text or
          the Previous/Next row at the end of a chapter. */}
      <div className="mx-auto w-full max-w-2xl lg:max-w-3xl px-5 pb-44 lg:pb-24">
        {/* Top bar. A three-track grid with equal 1fr side slots keeps the
            title on the column's centre line however wide the right cluster
            grows; a plain flex row let the wider side push it off-centre. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-3 lg:py-5">
          <button
            type="button"
            onClick={() => router.back()}
            className="justify-self-start text-[15px] font-semibold text-amber-600 dark:text-amber-400"
          >
            ‹ Back
          </button>
          <h1 className="text-center text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
            {reference}
          </h1>
          <div className="flex justify-self-end gap-1 sm:gap-2">
            <Link
              href={`/bible/timeline?book=${order}&chapter=${chapter}`}
              aria-label="Who's in this chapter"
              title="Who's in this chapter"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.06]"
            >
              <Users className="h-4 w-4" aria-hidden />
            </Link>
            <button
              type="button"
              aria-label="Decrease text size"
              disabled={fontStep === 0}
              onClick={() => stepFont(-1)}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-xs font-bold text-neutral-600 dark:text-neutral-300 ${fontStep === 0 ? "opacity-35" : "hover:bg-black/[0.06] dark:hover:bg-white/[0.06]"}`}
            >
              A−
            </button>
            <button
              type="button"
              aria-label="Increase text size"
              disabled={fontStep === FONT_STEPS.length - 1}
              onClick={() => stepFont(1)}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-base font-bold text-neutral-600 dark:text-neutral-300 ${fontStep === FONT_STEPS.length - 1 ? "opacity-35" : "hover:bg-black/[0.06] dark:hover:bg-white/[0.06]"}`}
            >
              A+
            </button>
          </div>
        </div>

        {/* Translation chips: centred under the title so the header reads as
            one balanced block rather than a right-hung second row. */}
        <div className="flex justify-center gap-1 pb-2">
          {(Object.keys(TRANSLATIONS) as TranslationId[]).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={translation === id}
              onClick={() => setTranslation(id)}
              className={`rounded-full border px-2.5 py-1 text-metadata font-bold transition-colors ${
                translation === id
                  ? "border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400"
                  : "border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.06]"
              }`}
            >
              {id}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center p-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-500 dark:border-amber-400/30 dark:border-t-amber-400" />
            <p className="mt-4 text-[13px] text-neutral-400 dark:text-neutral-500">
              {translation === "NKJV" ? "Loading the NKJV…" : "Opening the chapter…"}
            </p>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center p-8">
            <div className="glass-card gradient-border flex flex-col items-center gap-4 rounded-2xl p-8">
              <p className="text-center text-sm leading-5 text-neutral-600 dark:text-neutral-300">
                {error}
              </p>
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-lg border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 px-6 py-2 text-sm font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors"
              >
                Try again
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* The scroll: a parchment sheet on the dark shell; verse ink
                inherits from .parchment-page (globals.css). Settings ->
                Appearance can switch it off, restoring the plain reader. */}
            <div
              className={
                parchment
                  ? "parchment-page mt-1 rounded-2xl px-5 py-6 shadow-xl ring-1 ring-black/25 dark:ring-white/10 sm:px-8"
                  : "pt-2"
              }
            >
              {verses.map((text, index) => {
                const verseNumber = index + 1;
                const verseColor = verseHighlights.get(verseNumber);
                return (
                  <button
                    key={verseNumber}
                    type="button"
                    id={`bible-verse-${verseNumber}`}
                    onClick={() => openVerse({ number: verseNumber, text })}
                    className={`block w-full scroll-mt-6 rounded-lg px-1 text-left transition-colors duration-500 ${
                      highlighted === verseNumber
                        ? parchment
                          ? "bg-amber-800/15 dark:bg-amber-400/15"
                          : "bg-amber-500/10 dark:bg-amber-400/10"
                        : ""
                    }`}
                    // The deep-link flash keeps visual precedence: while it is
                    // active the stored wash is dropped so the amber flash
                    // class shows through.
                    style={
                      verseColor && highlighted !== verseNumber
                        ? { backgroundColor: highlightWash(verseColor) }
                        : undefined
                    }
                  >
                    <span
                      className={`font-[family-name:var(--font-cormorant)]${
                        parchment ? "" : " text-neutral-700 dark:text-neutral-300"
                      }`}
                      style={{ fontSize, lineHeight: `${lineHeight}px` }}
                    >
                      <span
                        className={`mr-1 align-super font-sans text-xs font-bold small-caps ${
                          parchment
                            ? "text-amber-900/70 dark:text-amber-400/80"
                            : "text-amber-700/60 dark:text-amber-500/50"
                        }`}
                      >
                        {verseNumber}
                      </span>
                      {text}
                    </span>
                    <span className="block h-4" aria-hidden />
                  </button>
                );
              })}

              {/* Footer */}
              <p
                className={`mt-6 text-center text-xs italic ${
                  parchment ? "opacity-60" : "text-neutral-400/70 dark:text-neutral-600"
                }`}
              >
                {TRANSLATIONS[translation].label} - {TRANSLATIONS[translation].copyright}
              </p>
              <div className="mt-6 flex gap-4">
                {neighbors.prev ? (
                  <Link
                    href={navHref(neighbors.prev)}
                    className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-sm font-semibold text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors"
                  >
                    ‹ Previous
                  </Link>
                ) : (
                  <span className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-sm font-semibold text-neutral-600 dark:text-neutral-300 opacity-35">
                    ‹ Previous
                  </span>
                )}
                {neighbors.next ? (
                  <Link
                    href={navHref(neighbors.next)}
                    className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-sm font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors"
                  >
                    Next ›
                  </Link>
                ) : (
                  <span className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-sm font-semibold text-amber-600 dark:text-amber-400 opacity-35">
                    Next ›
                  </span>
                )}
              </div>
            </div>

            {/* Floating Ask AI button */}
            <button
              type="button"
              aria-label={`Ask AI about ${reference}`}
              onClick={() =>
                askAI({
                  reference,
                  text: verses.map((t, i) => `${i + 1} ${t}`).join("\n"),
                })
              }
              // Opaque, and a compact circle on phones: the old translucent
              // full-label pill let verse text read straight through it and
              // covered 112px of the reading column. Desktop has room for the
              // label clear of the column, so it keeps the full pill.
              className="fixed bottom-24 right-3 lg:bottom-6 lg:right-6 z-40 flex h-12 w-12 items-center justify-center gap-1.5 rounded-full border border-amber-500/40 dark:border-amber-400/30 bg-[hsl(var(--card))] text-sm font-bold text-amber-600 dark:text-amber-400 glow-amber shadow-lg lg:h-auto lg:w-auto lg:px-6 lg:py-3 hover:bg-amber-500/10 dark:hover:bg-amber-400/10 transition-colors"
            >
              <span aria-hidden>✦</span>
              <span className="hidden lg:inline">Ask AI</span>
            </button>
          </>
        )}
      </div>

      {/* Verse action panel (web analog of Android's long-press sheet) */}
      {actionVerse && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          role="dialog"
          aria-modal="true"
          aria-label={`${actionReference} actions`}
        >
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={closePanel}
            aria-hidden
          />
          {/* Capped and scrollable: the sheet used to grow past the viewport
              and push its own heading off the top of the screen with no way
              back. Matches Android's 88%-height sheet with a pinned title. */}
          <div className="glass relative flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-2xl border-t border-black/[0.08] dark:border-white/[0.08] animate-message-in">
            <div className="relative flex-shrink-0 px-4 pb-3 pt-4">
              <p className="px-8 text-center text-sm font-bold text-amber-600 dark:text-amber-400">
                {actionReference}
              </p>
              <button
                type="button"
                aria-label="Close"
                onClick={closePanel}
                className="absolute right-3 top-2 flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              {/* Tapped verse */}
              <div className="mb-2 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-3 py-2.5">
                <p className="line-clamp-5 font-[family-name:var(--font-cormorant)] text-chat text-neutral-700 dark:text-neutral-300">
                  {actionVerse.text}
                </p>
              </div>

              {/* Streaming AI explanation (glowing skeleton until tokens arrive) */}
              <div className="flex min-h-16 flex-col justify-center px-2 py-3">
                {insightStatus === "loading" ? (
                  <div aria-label="Generating an explanation" className="flex flex-col gap-2">
                    <div className="h-3 w-full animate-pulse rounded-full border border-amber-500/20 dark:border-amber-400/20 bg-amber-500/15 dark:bg-amber-400/15 glow-amber-sm" />
                    <div className="h-3 w-[92%] animate-pulse rounded-full border border-amber-500/20 dark:border-amber-400/20 bg-amber-500/15 dark:bg-amber-400/15 glow-amber-sm [animation-delay:150ms]" />
                    <div className="h-3 w-[64%] animate-pulse rounded-full border border-amber-500/20 dark:border-amber-400/20 bg-amber-500/15 dark:bg-amber-400/15 glow-amber-sm [animation-delay:300ms]" />
                  </div>
                ) : insightStatus === "error" ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-[13px] leading-[19px] text-neutral-500 dark:text-neutral-400">
                      {insightError}
                    </p>
                    <button
                      type="button"
                      onClick={retryInsight}
                      className="self-start text-[13.5px] font-semibold text-amber-600 dark:text-amber-400"
                    >
                      Try again
                    </button>
                  </div>
                ) : insightStatus !== "idle" ? (
                  <p className="text-[14.5px] leading-[22px] text-neutral-700 dark:text-neutral-200">
                    {insightText}
                    {insightStatus === "streaming" && (
                      <span className="text-amber-600 dark:text-amber-400"> ▍</span>
                    )}
                  </p>
                ) : null}
              </div>

              {/* Hebrew or Greek behind the verse, word by word with Strong's. */}
              <OriginalLanguageSection
                book={order}
                chapter={chapter}
                verse={actionVerse.number}
              />

              <button
                type="button"
                onClick={() => askAI({ reference: actionReference, text: actionVerse.text })}
                className="mb-2 flex min-h-[46px] w-full items-center justify-center rounded-xl border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-[14.5px] font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors"
              >
                ✦ Expand with AI
              </button>

              {/* Highlight picker: presets + custom color; applies immediately
                  and leaves the panel open (YouVersion-style). */}
              <div className="mb-2 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-3 py-2.5">
                <p className="pb-2 text-metadata font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Highlight
                </p>
                <div className="flex flex-wrap items-center gap-2.5">
                  {HIGHLIGHT_COLORS.map((preset) => {
                    const active = actionColor?.toLowerCase() === preset.hex.toLowerCase();
                    return (
                      <button
                        key={preset.hex}
                        type="button"
                        aria-label={`Highlight ${preset.name}`}
                        aria-pressed={active}
                        onClick={() => setHighlightColor(actionVerse.number, preset.hex)}
                        className={`h-9 w-9 rounded-full border border-black/10 dark:border-white/15 transition-transform hover:scale-105 ${
                          active ? "ring-2 ring-amber-500 dark:ring-amber-400" : ""
                        }`}
                        style={{ backgroundColor: preset.hex }}
                      />
                    );
                  })}
                  <label
                    aria-label="Custom highlight color"
                    className="relative h-9 w-9 cursor-pointer overflow-hidden rounded-full border border-black/10 dark:border-white/15 transition-transform hover:scale-105"
                    style={{
                      background:
                        "conic-gradient(#E84C3D, #F5A623, #F5D76E, #27AE60, #1ABC9C, #4A90D9, #9B59B6, #E87EA1, #E84C3D)",
                    }}
                  >
                    <input
                      type="color"
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      value={actionColor ?? "#F5D76E"}
                      onChange={(event) =>
                        setHighlightColor(actionVerse.number, event.target.value.toUpperCase())
                      }
                    />
                  </label>
                </div>
              </div>

              {actionColor && (
                <button
                  type="button"
                  onClick={() => removeHighlight(actionVerse.number)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
                >
                  <span className="w-5 text-center text-amber-600 dark:text-amber-400">✕</span>
                  Remove highlight
                </button>
              )}

              {[
                {
                  glyph: "⧉",
                  label: copied ? "Copied ✓" : "Copy",
                  onPress: () => void onCopyVerse(),
                },
                { glyph: "↗", label: "Share", onPress: () => void onShareVerse() },
                {
                  glyph: "✎",
                  label: saveBusy ? "Saving…" : "Save to note",
                  onPress: () => void onSaveVerse(),
                },
              ].map((row) => (
                <button
                  key={row.glyph + row.label}
                  type="button"
                  onClick={row.onPress}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
                >
                  <span className="w-5 text-center text-amber-600 dark:text-amber-400">{row.glyph}</span>
                  {row.label}
                </button>
              ))}
              {saveError && (
                <p className="px-3 py-2 text-[12.5px] text-red-500 dark:text-red-400">{saveError}</p>
              )}
              <div className="pb-safe" aria-hidden />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChapterReader;
