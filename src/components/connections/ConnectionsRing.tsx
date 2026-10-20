"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";
import { batchArcs, bookAtIndex, chordPath, connectionSectionOf, indexAtAngle, ringArcPath, type BaselineBook, type ChapterLink } from "@/lib/bible/connectionsMap";
import type { ConnectionsOverview } from "./connectionsData";

interface Props {
  total: number; books: BaselineBook[]; overview: ConnectionsOverview | null; links: ChapterLink[];
  chapterStart: number | null; order: number; focusVerse: number | null; sectionFilter: string | null;
  title: string; subtitle: string; onBookPress: (order: number) => void; onCenterPress: () => void;
}

/** Same data geometry as Android; section buttons provide the keyboard equivalent of ring taps. */
export default function ConnectionsRing({ total, books, overview, links, chapterStart, order, focusVerse, sectionFilter, title, subtitle, onBookPress, onCenterPress }: Props) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const frame = useMemo(() => ({ cx: 250, cy: 250, r: 195, total }), [total]);
  const ghost = useMemo(() => {
    if (!overview) return "";
    const step = total / overview.bins;
    return overview.pairs.map(([a, b]) => chordPath(frame, (a + .5) * step, (b + .5) * step, 6)).join("");
  }, [overview, total, frame]);
  const paths = useMemo(() => {
    if (chapterStart === null) return { back: [], focus: [] };
    const visible = links.filter(link => !sectionFilter || connectionSectionOf(link[1]).id === sectionFilter);
    const arc = (link: ChapterLink) => ({ color: connectionSectionOf(link[1]).color, d: chordPath(frame, chapterStart + link[0] - 1, link[4], 6) });
    return { back: batchArcs(visible.filter(link => link[0] !== focusVerse).map(arc)), focus: batchArcs(visible.filter(link => link[0] === focusVerse).map(arc)) };
  }, [links, sectionFilter, chapterStart, frame, focusVerse]);
  return <div className="relative mx-auto aspect-square w-full max-w-[520px]">
    <svg viewBox="0 0 500 500" role="img" aria-label={`${title}. ${subtitle}. Colored arcs show references across the Bible. Use the section filters below to explore.`} className="h-full w-full" onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = (event.clientX - rect.left) * 500 / rect.width - 250;
      const y = (event.clientY - rect.top) * 500 / rect.height - 250;
      if (Math.abs(Math.hypot(x, y) - frame.r) > 25) return;
      const index = indexAtAngle(frame, Math.atan2(y, x));
      if (index !== null && books.length) onBookPress(bookAtIndex(books, index));
    }}>
      <path d={ghost} fill="none" stroke="currentColor" strokeWidth=".55" opacity={isDark ? .07 : .045} />
      {paths.back.map(path => <path key={path.key} d={path.d} fill="none" stroke={path.color} strokeWidth=".7" opacity={focusVerse === null ? .28 : .07} />)}
      {paths.focus.map(path => <path key={path.key} d={path.d} fill="none" stroke={path.color} strokeWidth="1.15" opacity=".8" />)}
      {books.map(([bookOrder, start, verses]) => <path key={bookOrder} d={ringArcPath(frame, start, start + verses, frame.r, .004)} stroke={connectionSectionOf(bookOrder).color} strokeWidth={bookOrder === order ? 10 : 6} fill="none" opacity={!sectionFilter || connectionSectionOf(bookOrder).id === sectionFilter ? 1 : .25} className="cursor-pointer" />)}
    </svg>
    <button type="button" onClick={onCenterPress} aria-label="Show whole chapter" className="absolute left-1/2 top-1/2 flex min-h-24 max-w-[48%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full bg-[#f6f2e9]/90 px-5 py-3 text-center shadow-[0_0_28px_15px_#f6f2e9] dark:bg-[#0d100d]/90 dark:shadow-[0_0_28px_15px_#0d100d]"><span className="font-[family-name:var(--font-cormorant)] text-2xl font-semibold sm:text-3xl">{title}</span><span className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{subtitle}</span></button>
  </div>;
}
