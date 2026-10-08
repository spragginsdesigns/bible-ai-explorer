"use client";

import { getBsbChapter } from "@/lib/bible/bsb";
import { readerVerseSegments, readerSectionHeadings } from "@/lib/bible/redLetters";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useBrowserReading } from "./useBrowserReading";
import { useReadingLogStatus } from "./readingLogClient";
import { ChevronDown, Copy, GraduationCap, Headphones, NotebookPen, Share2, Sparkles, Users } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { hasNarration } from "@/lib/bible/audioBible";
import { bookByOrder } from "@/lib/bible/books";
import { getChapter, TRANSLATIONS, type TranslationId } from "@/lib/bible/translations";
import { saveVerseToNote } from "@/lib/bible/verseActions";
import { bibleVersePlainText } from "@/lib/bible/verseMarkup";
import {
  MAX_SELECTED_VERSES,
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
import ChapterAudioBar from "./ChapterAudioBar";
import CrossReferencesSection from "./CrossReferencesSection";
import InsightTeaser from "./InsightTeaser";
import StudyTabs, { STUDY_PANEL_ID } from "./StudyTabs";
import VerseActionBar, { type VerseAction } from "./VerseActionBar";
import VerseSheet, { type VerseSheetTier } from "./VerseSheet";
import WordStudySection from "./WordStudySection";
import { useChapterAudio } from "./useChapterAudio";
import { useChapterHighlights } from "./useChapterHighlights";
import { useVerseInsight } from "./useVerseInsight";

const FONT_STEPS = [17, 20, 24, 28] as const;
const FONT_STEP_KEY = "bible-reader-font-step";
const HIGHLIGHT_MS = 2400;
/** Long enough that growing a range by three quick taps bills one request. */
const INSIGHT_DEBOUNCE_MS = 350;
/** How long the Copy chip reads "Copied" before returning to its label. */
const COPIED_MS = 1200;
const LEARN_ERROR = "Could not add to Learn. Check your connection and try again.";
const SAVE_ERROR = "The note could not be saved. Check your connection and try again.";

/** Reader settings' translation note, word for word as on Android. */
const TRANSLATION_NOTES: Record<TranslationId, string> = {
  KJV: "KJV words of Jesus · eBible edition. Editorial headings · BSB.",
  BSB: "Section headings and words of Jesus · Berean Standard Bible",
  NKJV: "Red letters aren't available from our NKJV text provider yet.",
};

interface ActionMessage {
  text: string;
  tone: "muted" | "danger";
}

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
  // The sheet opens at the peek (teaser + actions, chapter still readable);
  // the study view is the expanded tier.
  const [sheetTier, setSheetTier] = useState<VerseSheetTier>("peek");
  const [studyTab, setStudyTab] = useState<StudyTabKey>("explain");
  const [copied, setCopied] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [learnStatus, setLearnStatus] = useState<"idle" | "adding" | "added">("idle");
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);
  // The native colour picker covers the page while it is open.
  const [pickerOpen, setPickerOpen] = useState(false);
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
    // The peek leaves most of the chapter readable; only the expanded study
    // view (or the colour picker) covers the text, as on Android.
    obscured: (selection !== null && sheetTier === "expanded") || pickerOpen,
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

  // Listen: the narrated KJV, read along with the text. Finishing a chapter
  // pages the reader to the next one, which carries on playing.
  const nextChapter = neighbors.next;
  const onChapterEnd = useCallback(() => {
    if (!nextChapter) return;
    router.push(
      `/bible/chapter?book=${nextChapter.order}&chapter=${nextChapter.chapter}${
        routeTranslation === "KJV" ? "&translation=KJV" : ""
      }`,
      { scroll: false }
    );
  }, [nextChapter, routeTranslation, router]);
  const player = useChapterAudio({
    book: order,
    chapter,
    reference,
    enabled: translation === "KJV" && !!book,
    onChapterEnd,
    nextNarrated: !!nextChapter && hasNarration(nextChapter.order),
  });
  const { available: canListen, play: playFrom } = player;

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

  const closePanel = useCallback(() => {
    setSelection(null);
    setPickerOpen(false);
  }, []);

  // The whole multi-select rule lives in toggleVerse: first click opens, a
  // further click grows the range, a click inside it re-anchors, and clicking
  // the only selected verse closes the panel. The toggle reads the current
  // selection through a ref, written at once, so two clicks in one frame chain.
  const selectionNow = useRef(selection);
  selectionNow.current = selection;
  const onVerseClick = useCallback((verse: number) => {
    const current = selectionNow.current;
    const next = toggleVerse(current, verse);
    if (next === current) {
      // The only way the toggle leaves the selection alone is the cap.
      setActionMessage({ text: `Up to ${MAX_SELECTED_VERSES} verses at a time.`, tone: "muted" });
      return;
    }
    selectionNow.current = next;
    if (!current && next) {
      // A fresh open starts at the peek on Explain; growing the range leaves
      // the reader on whichever tier and view they were already reading.
      setSheetTier("peek");
      setStudyTab("explain");
    }
    setActionMessage(null);
    setSelection(next);
  }, []);

  // Paging to another chapter or translation: the selection no longer
  // describes what is on screen.
  useEffect(() => {
    setSelection(null);
    setPickerOpen(false);
  }, [chapterKey]);

  // A different passage invalidates every piece of per-selection chip state.
  useEffect(() => {
    learnRequest.current?.abort();
    learnRequest.current = null;
    setCopied(false);
    setLearnStatus("idle");
    setActionMessage(null);
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

  // Escape steps back one tier, like Android's back button on the sheet: the
  // study view collapses to the peek, and the peek closes.
  const sheetOpen = selection !== null;
  useEffect(() => {
    if (!sheetOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (sheetTier === "expanded") setSheetTier("peek");
      else closePanel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sheetOpen, sheetTier, closePanel]);

  const openStudy = useCallback((tab: StudyTabKey) => {
    setStudyTab(tab);
    setSheetTier("expanded");
  }, []);

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

  // The Words tab's two buttons open chat with a question already written.
  // "Ask about this word" is about the verse on screen, so it pins the passage
  // too; "Every verse" is a sweep of the whole Bible and deliberately does not.
  const askAboutWord = useCallback(
    (prompt: string, attach: boolean) => {
      closePanel();
      const query = new URLSearchParams({ prompt });
      if (attach && selectionRef) {
        query.set("attachRef", selectionRef);
        query.set("attachText", selectionPlain);
        query.set("attachTranslation", translation);
      }
      router.push(`/?${query.toString()}`);
    },
    [router, closePanel, selectionRef, selectionPlain, translation]
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
    setActionMessage(null);
    try {
      const noteId = await saveVerseToNote(
        { reference: selectionRef, text: selectionPlain },
        translation
      );
      closePanel();
      router.push(`/notes?note=${encodeURIComponent(noteId)}`);
    } catch {
      setActionMessage({ text: SAVE_ERROR, tone: "danger" });
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
    setActionMessage(null);
    // A selection already carrying a highlight was marked before it was
    // studied, so it enters Learn as a highlight, as the old sheet did.
    const source = selectionHex ? "highlight" : "sheet";
    const count = selectionCount(selection);
    try {
      for (const verse of selectionVerses(selection)) {
        await addVerseToLearn(
          { book: order, chapter, verse, translation, source },
          controller.signal
        );
      }
      if (!controller.signal.aborted) {
        setLearnStatus("added");
        setActionMessage({
          text: count === 1 ? "Added to Learn." : `Added ${count} verses to Learn.`,
          tone: "muted",
        });
      }
    } catch {
      if (!controller.signal.aborted) {
        setLearnStatus("idle");
        setActionMessage({ text: LEARN_ERROR, tone: "danger" });
      }
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
    // Plays the narration from the first selected verse.
    if (canListen && selection) {
      list.push({
        key: "listen",
        icon: Headphones,
        label: "Listen",
        onClick: () => {
          playFrom(selection.start);
          closePanel();
        },
      });
    }
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
    canListen,
    playFrom,
    selection,
    closePanel,
  ]);

  const barMessage: ActionMessage | null =
    actionMessage ??
    (selectionHighlightLabel
      ? { text: `Marked as “${selectionHighlightLabel}”`, tone: "muted" }
      : null);

  const fontSize = FONT_STEPS[fontStep];
  // Android's reader line height, so a chapter breathes the same on both.
  const lineHeight = Math.round(fontSize * 1.8);

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
      {/* While the verse sheet peeks, extra room lets the last verses scroll
          clear of it, so the chapter stays readable to its final line. */}
      <div
        className={`mx-auto w-full max-w-2xl lg:max-w-3xl px-5 ${
          selection ? "pb-[24rem]" : player.open ? "pb-64 lg:pb-44" : "pb-44 lg:pb-24"
        }`}
      >
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
          {/* The reference is the chapter picker, as on Android's reader dock. */}
          <h1 className="min-w-0 text-center">
            <Link
              href={`/bible/chapters?book=${order}`}
              aria-label={`Choose chapter, ${reference}`}
              className="inline-flex min-h-9 max-w-full items-center gap-1 rounded-full px-3 text-[15px] font-semibold text-neutral-900 dark:text-neutral-100 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
            >
              <span className="truncate">{reference}</span>
              <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-neutral-500 dark:text-neutral-400" aria-hidden />
            </Link>
          </h1>
          <div className="flex justify-self-end gap-1 sm:gap-2">
            {player.available ? (
              <button
                type="button"
                aria-label={player.open ? (player.playing ? "Pause listening" : "Resume listening") : `Listen to ${reference}`}
                aria-pressed={player.open}
                title="Listen"
                onClick={() => (player.open ? player.toggle() : player.play())}
                className={`flex h-8 w-8 items-center justify-center gap-1.5 rounded-lg border lg:w-auto lg:px-2.5 ${
                  player.open
                    ? "border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400"
                    : "border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.06]"
                }`}
              >
                <Headphones className="h-4 w-4" aria-hidden />
                {/* Mobile keeps the icon in the crowded top bar; desktop names it, like Ask AI. */}
                <span className="hidden text-xs font-semibold lg:inline">Listen</span>
              </button>
            ) : null}
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
        <p className="pb-2 text-center text-metadata text-neutral-500 dark:text-neutral-400">
          {TRANSLATION_NOTES[translation]}
        </p>

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
                const selected = selectionIncludes(selection, verseNumber);
                const beingRead = player.open && player.verse === verseNumber;
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
                    aria-pressed={selected}
                    // The selection tint and the deep-link flash share one look,
                    // as on Android: both say "this is the verse we mean". The
                    // stored highlight washes the words themselves (below), so
                    // a highlighted verse still shows it is selected.
                    className={`block w-full scroll-mt-6 rounded-lg px-1 text-left transition-colors duration-500 ${
                      selected || highlighted === verseNumber || beingRead
                        ? parchment
                          ? "bg-amber-800/15 dark:bg-amber-400/15"
                          : "bg-amber-500/10 dark:bg-amber-400/10"
                        : ""
                    }`}
                  >
                    <span
                      className={`font-[family-name:var(--font-cormorant)]${
                        parchment ? "" : " text-neutral-700 dark:text-neutral-300"
                      }`}
                      style={{ fontSize, lineHeight: `${lineHeight}px` }}
                    >
                      <span
                        className={`mr-1 align-super font-sans text-xs font-bold small-caps ${
                          selected
                            ? "text-amber-600 dark:text-amber-400"
                            : parchment
                              ? "text-amber-900/70 dark:text-amber-400/80"
                              : "text-amber-700/60 dark:text-amber-500/50"
                        }`}
                      >
                        {verseNumber}
                      </span>
                      {segments.map((segment, i) => (
                        <span
                          key={i}
                          className={segment.jesusSpeech ? "text-[#a12e2a] dark:text-[#ef8a83]" : undefined}
                          style={{
                            fontStyle: segment.italic ? "italic" : undefined,
                            backgroundColor: verseColor ? highlightWash(verseColor) : undefined,
                          }}
                        >
                          {segment.text}
                        </span>
                      ))}
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
              className={`fixed ${player.open ? "bottom-[13.5rem] lg:bottom-32" : "bottom-24 lg:bottom-6"} right-3 lg:right-6 z-40 flex h-12 w-12 items-center justify-center gap-1.5 rounded-full border border-amber-500/40 dark:border-amber-400/30 bg-[hsl(var(--card))] text-sm font-bold text-amber-600 dark:text-amber-400 glow-amber shadow-lg lg:h-auto lg:w-auto lg:px-6 lg:py-3 hover:bg-amber-500/10 dark:hover:bg-amber-400/10 transition-colors`}
            >
              <span aria-hidden>✦</span>
              <span className="hidden lg:inline">Ask AI</span>
            </button>
          </>
        )}
      </div>

      {/* The verse sheet takes the bar's place while it is open; playback carries on. */}
      {player.open && !selection && <ChapterAudioBar player={player} reference={reference} />}

      {/* Tap-a-verse, the web twin of Android's two-tier verse sheet. The
          peek (teaser + action bar) has no scrim, so the chapter stays
          readable and further verses can join the selection; the expanded
          tier is the full study view. */}
      {selection && (
        <VerseSheet
          tier={sheetTier}
          onTierChange={setSheetTier}
          onClose={closePanel}
          title={selectionRef}
          subtitle={isRange ? `${selectionCount(selection)} verses` : undefined}
          peek={
            <InsightTeaser
              status={insightStatus}
              text={insightText}
              error={insightError}
              onPress={() => openStudy("explain")}
              onRetry={retryInsight}
            />
          }
          footer={
            <VerseActionBar
              color={selectionHex}
              canRemove={selectionHasColor}
              onHighlight={highlightSelection}
              onRemoveHighlight={clearSelectionHighlight}
              onCustomColor={highlightSelection}
              onCustomPickerOpenChange={setPickerOpen}
              labelForPreset={labelForPreset}
              actions={verseActions}
              message={barMessage?.text}
              messageTone={barMessage?.tone}
            />
          }
        >
          <p className="line-clamp-4 px-4 pb-3 font-[family-name:var(--font-cormorant)] text-[17px] leading-[26px] text-neutral-600 dark:text-neutral-300">
            {selectionPlain}
          </p>

          <div className="px-4 pb-2">
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
            className="px-4 pb-3"
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
              /* The original behind the verse, word by word beside the KJV
                 wording, with a short study under it. Each study is a model
                 generation, so a range studies its first verse only (as See
                 also does) rather than firing one per selected verse. */
              <div className="pt-1">
                {isRange && (
                  <p className="pb-2 text-metadata text-neutral-500 dark:text-neutral-400">
                    For verse {selection.start}
                  </p>
                )}
                <WordStudySection
                  key={selection.start}
                  book={order}
                  chapter={chapter}
                  verse={selection.start}
                  onAsk={askAboutWord}
                />
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
        </VerseSheet>
      )}
    </div>
  );
};

export default ChapterReader;
