"use client";

import { getBsbChapter } from "@/lib/bible/bsb";
import { readerVerseSegments, readerSectionHeadings } from "@/lib/bible/redLetters";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useBrowserReading } from "./useBrowserReading";
import { useReadingLogStatus } from "./readingLogClient";
import { Copy, GraduationCap, NotebookPen, Share2, Sparkles, Users, X } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { bookByOrder } from "@/lib/bible/books";
import { getChapter, TRANSLATIONS, type TranslationId } from "@/lib/bible/translations";
import { saveVerseToNote } from "@/lib/bible/verseActions";
import { bibleVersePlainText } from "@/lib/bible/verseMarkup";
import {
  selectionColor,
  selectionCount,
  selectionIncludes,
  selectionReference,
  selectionShareText,
  selectionText,
  selectionVerses,
  toggleVerse,
  type VerseSelection,
} from "@/lib/bible/verseSelection";
import { readParchmentPref, readTranslationPref } from "@/lib/preferences";
import {
  highlightLabelFor,
  setTranslationPreference,
  useHighlightLabels,
  usePreference,
} from "@/lib/preferencesSync";
import { HIGHLIGHT_COLORS, highlightWash } from "@/lib/highlights";
import { useGlobalShortcuts } from "@/lib/shortcuts";
import { parseCard } from "@/components/learn/learn";
import CrossReferencesSection from "./CrossReferencesSection";
import OriginalLanguageSection from "./OriginalLanguageSection";
import StudyTabs, { STUDY_PANEL_ID } from "./StudyTabs";
import VerseActionBar, { type VerseAction } from "./VerseActionBar";
import { useChapterHighlights } from "./useChapterHighlights";
import { useVerseInsight } from "./useVerseInsight";

const FONT_STEPS = [17, 20, 24, 28] as const;
const FONT_STEP_KEY = "bible-reader-font-step";
const HIGHLIGHT_MS = 2400;
/** Long enough that growing a range by three quick taps bills one request. */
const INSIGHT_DEBOUNCE_MS = 350;
/** How long the Copy chip reads "Copied" before returning to its label. */
const COPIED_MS = 1200;
const LEARN_ERROR = "That could not be added to Learn. Check your connection and try again.";

type StudyTabKey = "explain" | "words" | "seealso";

const STUDY_TABS = [
  { key: "explain", label: "Explain" },
  { key: "words", label: "Words" },
  { key: "seealso", label: "See also" },
] as const satisfies readonly { key: StudyTabKey; label: string }[];

/**
 * One verse into the Learn queue. /api/learn is single-verse, so a selected
 * range is added one call at a time; the response is validated exactly as
 * AddLearnButton validates it, since a card for another verse means the queue
 * is not what the reader just asked for.
 */
async function addVerseToLearn(
  card: {
    book: number;
    chapter: number;
    verse: number;
    translation: TranslationId;
    source: "sheet" | "highlight";
  },
  signal: AbortSignal
): Promise<void> {
  const response = await fetch("/api/learn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
    signal,
  });
  if (!response.ok) throw new Error("Add failed");
  const added = parseCard(await response.json());
  if (added.book !== card.book || added.chapter !== card.chapter || added.verse !== card.verse) {
    throw new Error("Unexpected verse");
  }
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
  const readingStatus = useReadingLogStatus();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useGlobalShortcuts();

  const order = Number.parseInt(searchParams.get("book") ?? "1", 10);
  const chapter = Number.parseInt(searchParams.get("chapter") ?? "1", 10);
  const verseParam = Number.parseInt(searchParams.get("verse") ?? "", 10) || null;

  const book = bookByOrder(order);
  // Both come from the account document, so they follow a change made in
  // Settings, in another tab, or on the phone without a reload.
  const accountTranslation = usePreference<TranslationId>(readTranslationPref, "KJV");
  // A chat source can open the reader in the translation that produced its
  // text. This is a local route override; the account preference changes only
  // when the user explicitly taps a reader translation chip.
  const routeTranslation = searchParams.get("translation");
  const translation: TranslationId = routeTranslation === "NKJV" || routeTranslation === "KJV" || routeTranslation === "BSB"
    ? routeTranslation
    : accountTranslation;
  const parchment = usePreference(readParchmentPref, true);
  const highlightLabels = useHighlightLabels();
  const [verses, setVerses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fontStep, setFontStep] = useState(readFontStep);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [selection, setSelection] = useState<VerseSelection | null>(null);
  const [studyTab, setStudyTab] = useState<StudyTabKey>("explain");
  const [copied, setCopied] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [learnStatus, setLearnStatus] = useState<"idle" | "adding" | "added" | "error">("idle");
  const { user } = useUser();
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
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const learnRequest = useRef<AbortController | null>(null);
  const panelWasOpen = useRef(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const chapterKey = `${translation}:${order}:${chapter}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getChapter(translation, order, chapter);
      setVerses(next);
      setLoadedKey(`${translation}:${order}:${chapter}`);
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
        setLoadedKey(`${translation}:${order}:${chapter}`);
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

  useBrowserReading({
    book: order, chapter, translation, verseCount: verses.length,
    ready: !loading && !error && loadedKey === chapterKey && !!book,
    obscured: selection !== null,
  });

  // The reader's chips and Settings share one account preference.
  const setTranslation = useCallback((id: TranslationId) => {
    if (routeTranslation === "KJV" || routeTranslation === "NKJV" || routeTranslation === "BSB") {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("translation");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    }
    void setTranslationPreference(id);
  }, [pathname, routeTranslation, router, searchParams]);

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

  // Every label, payload and rule comes out of the shared selection contract,
  // so web, Android and Apple agree on what a range means.
  const plainTexts = useMemo(() => verses.map(bibleVersePlainText), [verses]);
  const selectionRef = selection && book ? selectionReference(book.name, chapter, selection) : "";
  const selectionPlain = selection ? selectionText(plainTexts, selection) : "";
  const selectionHex = selection ? selectionColor(verseHighlights, selection) : undefined;
  const selectionHasColor =
    selection !== null && selectionVerses(selection).some((verse) => verseHighlights.has(verse));
  const selectionPreset = selectionHex
    ? HIGHLIGHT_COLORS.find((preset) => preset.hex.toLowerCase() === selectionHex.toLowerCase())
    : undefined;
  const selectionHighlightLabel = highlightLabelFor(highlightLabels, selectionPreset?.name);
  const isRange = selection !== null && selectionCount(selection) > 1;
  // GET /api/bible/crossrefs collapses a range to its first verse, so the
  // See also tab asks for that verse outright and then says which one it is.
  const anchorRef =
    selection && book
      ? selectionReference(book.name, chapter, { start: selection.start, end: selection.start })
      : "";

  const closePanel = useCallback(() => setSelection(null), []);

  // The whole multi-select rule lives in toggleVerse: first click opens, a
  // further click grows the range, a click inside it re-anchors, and clicking
  // the only selected verse closes the panel.
  const onVerseClick = useCallback((verse: number) => {
    setSelection((current) => toggleVerse(current, verse));
  }, []);

  // A fresh open starts on Explain; growing the range leaves the reader on
  // whichever view they were already reading.
  useEffect(() => {
    const open = selection !== null;
    if (open && !panelWasOpen.current) setStudyTab("explain");
    panelWasOpen.current = open;
  }, [selection]);

  // A different passage invalidates every piece of per-selection chip state.
  useEffect(() => {
    learnRequest.current?.abort();
    learnRequest.current = null;
    setCopied(false);
    setSaveError(null);
    setLearnStatus("idle");
  }, [selectionRef]);

  // Tap-a-verse: the panel streams a short AI explanation of whatever is
  // selected (cached per reference for the session). The first click asks at
  // once, as on Android; a click that grows the range waits a beat so three
  // quick clicks bill one request rather than three.
  const insightWasOpen = useRef(false);
  useEffect(() => {
    if (!selectionRef) {
      insightWasOpen.current = false;
      resetInsight();
      return;
    }
    const request = () =>
      startInsight({ reference: selectionRef, text: selectionPlain, translation });
    if (!insightWasOpen.current) {
      insightWasOpen.current = true;
      request();
      return;
    }
    const timer = setTimeout(request, INSIGHT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [selectionRef, selectionPlain, translation, startInsight, resetInsight]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      learnRequest.current?.abort();
    },
    []
  );

  // Escape closes the verse panel, matching every other dismissable panel in
  // the app (and the close X added alongside it).
  useEffect(() => {
    if (!selection) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selection, closePanel]);

  const retryInsight = useCallback(() => {
    if (!selectionRef) return;
    startInsight({ reference: selectionRef, text: selectionPlain, translation });
  }, [selectionRef, selectionPlain, startInsight, translation]);

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

  const flagCopied = useCallback(() => {
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }, []);

  const onCopySelection = useCallback(async () => {
    if (!selectionRef) return;
    try {
      await navigator.clipboard.writeText(
        selectionShareText(selectionRef, selectionPlain, translation)
      );
      flagCopied();
    } catch {
      // A blocked clipboard leaves the chip alone rather than claiming a copy.
    }
  }, [selectionRef, selectionPlain, translation, flagCopied]);

  const onShareSelection = useCallback(async () => {
    if (!selectionRef) return;
    if (typeof navigator.share === "function") {
      navigator
        .share({ text: selectionShareText(selectionRef, selectionPlain, translation) })
        .catch(() => {});
      return;
    }
    await onCopySelection();
  }, [selectionRef, selectionPlain, translation, onCopySelection]);

  const onSaveSelection = useCallback(async () => {
    if (!selectionRef || saveBusy) return;
    setSaveBusy(true);
    setSaveError(null);
    try {
      const noteId = await saveVerseToNote(
        { reference: selectionRef, text: selectionPlain },
        translation
      );
      closePanel();
      router.push(`/notes?note=${encodeURIComponent(noteId)}`);
    } catch {
      setSaveError("The note could not be saved. Check your connection and try again.");
    } finally {
      setSaveBusy(false);
    }
  }, [selectionRef, selectionPlain, saveBusy, router, closePanel, translation]);

  const onLearnSelection = useCallback(async () => {
    if (!selection || learnStatus === "adding") return;
    if (learnStatus === "added") {
      // Same as Android: the chip that just added the verses opens the queue.
      router.push("/bible/learn");
      return;
    }
    learnRequest.current?.abort();
    const controller = new AbortController();
    learnRequest.current = controller;
    setLearnStatus("adding");
    // A selection already carrying a highlight was marked before it was
    // studied, so it enters Learn as a highlight, as the old sheet did.
    const source = selectionHex ? "highlight" : "sheet";
    try {
      for (const verse of selectionVerses(selection)) {
        await addVerseToLearn(
          { book: order, chapter, verse, translation, source },
          controller.signal
        );
      }
      if (!controller.signal.aborted) setLearnStatus("added");
    } catch {
      if (!controller.signal.aborted) setLearnStatus("error");
    } finally {
      if (learnRequest.current === controller) learnRequest.current = null;
    }
  }, [selection, selectionHex, learnStatus, order, chapter, translation, router]);

  const highlightSelection = useCallback(
    (hex: string) => {
      if (!selection) return;
      for (const verse of selectionVerses(selection)) setHighlightColor(verse, hex);
    },
    [selection, setHighlightColor]
  );

  const clearSelectionHighlight = useCallback(() => {
    if (!selection) return;
    for (const verse of selectionVerses(selection)) removeHighlight(verse);
  }, [selection, removeHighlight]);

  const labelForPreset = useCallback(
    (name: string) => highlightLabelFor(highlightLabels, name) ?? name,
    [highlightLabels]
  );

  const verseActions = useMemo<VerseAction[]>(() => {
    const list: VerseAction[] = [
      {
        key: "ask",
        icon: Sparkles,
        label: "Ask",
        onClick: () => askAI({ reference: selectionRef, text: selectionPlain }),
      },
      {
        key: "copy",
        icon: Copy,
        label: copied ? "Copied" : "Copy",
        onClick: () => void onCopySelection(),
      },
      { key: "share", icon: Share2, label: "Share", onClick: () => void onShareSelection() },
      {
        key: "note",
        icon: NotebookPen,
        label: saveBusy ? "Saving…" : "Note",
        onClick: () => void onSaveSelection(),
        disabled: saveBusy,
      },
    ];
    // Learn is an account feature; the old sheet's button rendered nothing
    // when signed out, so the chip is absent rather than dead.
    if (user) {
      list.push({
        key: "learn",
        icon: GraduationCap,
        label:
          learnStatus === "adding" ? "Adding…" : learnStatus === "added" ? "Added" : "Learn",
        onClick: () => void onLearnSelection(),
        disabled: learnStatus === "adding",
        active: learnStatus === "added",
      });
    }
    return list;
  }, [
    askAI,
    selectionRef,
    selectionPlain,
    copied,
    onCopySelection,
    onShareSelection,
    saveBusy,
    onSaveSelection,
    user,
    learnStatus,
    onLearnSelection,
  ]);

  const barMessage =
    saveError ??
    (learnStatus === "error" ? LEARN_ERROR : undefined) ??
    (selectionHighlightLabel ? `Marked as “${selectionHighlightLabel}”` : undefined);
  const barTone: "muted" | "danger" =
    saveError || learnStatus === "error" ? "danger" : "muted";

  const fontSize = FONT_STEPS[fontStep];
  const lineHeight = Math.round(fontSize * 1.55);

  // A source translation opened from chat must survive paging, as it does on
  // Android and Apple; without it Next silently flips back to the account default.
  const navHref = (target: { order: number; chapter: number }) =>
    `/bible/chapter?book=${target.order}&chapter=${target.chapter}${
      routeTranslation === "KJV" || routeTranslation === "NKJV" || routeTranslation === "BSB" ? `&translation=${routeTranslation}` : ""
    }`;

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

        {readingStatus.error ? (
          <p role="alert" className="mx-auto max-w-3xl px-4 py-2 text-red-600">
            {readingStatus.error}{" "}
            <Link href="/bible/history" className="underline">Open reading log</Link>
          </p>
        ) : null}
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
                const formatted = translation === "BSB" ? getBsbChapter(order, chapter)[index] : null;
                const segments = readerVerseSegments(text, translation, order, chapter, verseNumber);
                return (
                  <div key={verseNumber}>
                  {readerSectionHeadings(translation, order, chapter, verseNumber).map((heading, i) => <h3 key={i} className="mb-5 mt-8 font-serif text-2xl italic text-neutral-900 dark:text-neutral-100">{heading}</h3>)}
                  <button
                    type="button"
                    id={`bible-verse-${verseNumber}`}
                    data-reading-verse={verseNumber}
                    // The panel, insight request, clipboard and Ask AI all want
                    // the verse without bolls.life markup (NKJV), as on
                    // Android; display rendering keeps its own parsed segments,
                    // and the plain text comes from the shared plainTexts list.
                    onClick={() => onVerseClick(verseNumber)}
                    aria-pressed={selectionIncludes(selection, verseNumber)}
                    className={`block w-full scroll-mt-6 rounded-lg px-1 text-left transition-colors duration-500 ${
                      selectionIncludes(selection, verseNumber)
                        ? "underline decoration-dotted decoration-2 underline-offset-4"
                        : ""
                    } ${
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
                      {segments.map((segment, i) => <span key={i} className={segment.jesusSpeech ? "text-[#a12e2a] dark:text-[#ef8a83]" : undefined} style={{ fontStyle: segment.italic ? "italic" : undefined }}>{segment.text}</span>)}
                      {formatted?.omitted ? <span className="text-sm text-neutral-500">Not included in this edition’s main text.</span> : null}
                    </span>
                    <span className="block h-4" aria-hidden />
                  </button>
                  </div>
                );
              })}

              {/* Footer */}
              <p
                className={`mt-6 text-center text-xs italic ${
                  parchment ? "opacity-60" : "text-neutral-400/70 dark:text-neutral-600"
                }`}
              >
                {TRANSLATIONS[translation].label} - {TRANSLATIONS[translation].copyright}
                {translation === "KJV" ? " · Editorial headings: BSB" : ""}
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
                  text: verses.map((t, i) => `${i + 1} ${bibleVersePlainText(t)}`).join("\n"),
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

      {/* Verse panel (web analog of Android's redesigned verse sheet). There
          is deliberately no scrim: the reader stays clickable so further
          verses can join the selection while the panel is open. */}
      {selection && (
        <div
          role="dialog"
          aria-label={`${selectionRef} actions`}
          className="glass fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[72dvh] w-full max-w-lg flex-col rounded-t-2xl border-t border-black/[0.08] dark:border-white/[0.08] animate-message-in"
        >
          <div className="relative flex-shrink-0 px-4 pb-2 pt-4">
            <div className="flex items-baseline justify-center gap-2 pr-8">
              <p className="text-sm font-bold text-amber-600 dark:text-amber-400">{selectionRef}</p>
              {isRange && (
                <span className="text-metadata text-neutral-500 dark:text-neutral-400">
                  {selectionCount(selection)} verses
                </span>
              )}
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={closePanel}
              className="absolute right-3 top-2 flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div className="flex-shrink-0 px-4 pb-2">
            <StudyTabs
              tabs={STUDY_TABS}
              active={studyTab}
              onChange={setStudyTab}
              label="Study this passage"
            />
          </div>

          <div
            id={STUDY_PANEL_ID}
            role="tabpanel"
            aria-labelledby={`${STUDY_PANEL_ID}-tab-${studyTab}`}
            className="min-h-0 flex-1 overflow-y-auto px-4 pb-3"
          >
            {studyTab === "explain" ? (
              /* Streaming AI explanation (glowing skeleton until tokens arrive) */
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
            ) : studyTab === "words" ? (
              /* Hebrew or Greek behind each selected verse, word by word with
                 Strong's. /api/bible/original is single-verse, so a range
                 stacks one section per verse under its own caption. */
              <div className="pt-1">
                {selectionVerses(selection).map((verse) => (
                  <OriginalLanguageSection
                    key={verse}
                    book={order}
                    chapter={chapter}
                    verse={verse}
                    caption={isRange ? `Verse ${verse}` : undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="pt-1">
                {isRange && (
                  <p className="pb-2 text-metadata text-neutral-500 dark:text-neutral-400">
                    For verse {selection.start}
                  </p>
                )}
                <CrossReferencesSection
                  key={`${anchorRef}:${translation}`}
                  reference={anchorRef}
                  translation={translation}
                  alwaysExpanded
                  onNavigate={closePanel}
                />
              </div>
            )}
          </div>

          <VerseActionBar
            color={selectionHex}
            canRemove={selectionHasColor}
            onHighlight={highlightSelection}
            onRemoveHighlight={clearSelectionHighlight}
            onCustomColor={highlightSelection}
            labelForPreset={labelForPreset}
            actions={verseActions}
            message={barMessage}
            messageTone={barTone}
          />
        </div>
      )}
    </div>
  );
};

export default ChapterReader;
