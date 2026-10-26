"use client";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { BOOKS } from "@/lib/bible/books";
import { isTranslationId, type TranslationId } from "@/lib/bible/translations";

/**
 * The slice of GET /api/reading-events the continue-reading row needs.
 */
interface LastRead {
  book: string;
  chapter: number;
  translation: TranslationId;
  readAt: string;
}

interface LastReadState {
  userId: string;
  value: LastRead | null;
}

const BOOK_BY_NAME = new Map(BOOKS.map((book) => [book.name, book]));

export function parseLastRead(value: unknown): LastRead | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.book !== "string" ||
    typeof candidate.chapter !== "number" ||
    !Number.isInteger(candidate.chapter) ||
    !isTranslationId(candidate.translation) ||
    typeof candidate.readAt !== "string"
  ) {
    return null;
  }
  const book = BOOK_BY_NAME.get(candidate.book);
  const chapter = candidate.chapter as number;
  if (!book || chapter < 1 || chapter > book.chapters) return null;
  return {
    book: book.name,
    chapter,
    translation: candidate.translation,
    readAt: candidate.readAt,
  };
}



/** Account keyed, abortable reads keep another reader's chapter out of the home. */
export function useContinueReading() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [lastRead, setLastRead] = useState<LastReadState | null>(null);
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) { setLastRead(null); return; }
    let current: AbortController | null = null;
    const load = async () => {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      try {
        const response = await fetch("/api/reading-events", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Reading history unavailable");
        const data: unknown = await response.json();
        const value = data && typeof data === "object" && "lastRead" in data ? parseLastRead(data.lastRead) : null;
        if (!controller.signal.aborted) setLastRead({ userId, value });
      } catch { if (!controller.signal.aborted) setLastRead({ userId, value: null }); }
    };
    const wake = () => { if (document.visibilityState === "visible") void load(); };
    void load();
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => { current?.abort(); window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); };
  }, [isLoaded, isSignedIn, userId]);
  if (!userId || lastRead?.userId !== userId || !lastRead.value) return null;
  const book = BOOK_BY_NAME.get(lastRead.value.book);
  if (!book) return null;
  return { label: `${book.name} ${lastRead.value.chapter}`, href: `/bible/chapter?book=${book.order}&chapter=${lastRead.value.chapter}&translation=${lastRead.value.translation}` };
}
