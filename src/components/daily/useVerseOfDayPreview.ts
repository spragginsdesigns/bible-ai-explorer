"use client";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";

export interface VerseOfDayPreview {
  reference: string;
  text: string;
}

/**
 * Today's daily word, read through GET /api/verse-of-day/preview: null until
 * it loads, when there is none yet, or when the preview is offline. Refreshes
 * on focus and every 15 minutes so a page left open overnight moves on.
 */
export function useVerseOfDayPreview(): VerseOfDayPreview | null {
  const { userId } = useAuth();
  const [preview, setPreview] = useState<VerseOfDayPreview | null>(null);
  useEffect(() => {
    if (!userId) return;
    let current: AbortController | null = null;
    const load = async () => {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      try {
        const response = await fetch("/api/verse-of-day/preview", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        if (!controller.signal.aborted) setPreview(typeof data?.cross?.reference === "string" && typeof data.cross.text === "string" ? data.cross : null);
      } catch { /* The devotional remains directly reachable when its preview is offline. */ }
    };
    void load();
    const wake = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    const timer = window.setInterval(wake, 15 * 60 * 1000);
    return () => { current?.abort(); window.clearInterval(timer); window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); };
  }, [userId]);
  return preview;
}
