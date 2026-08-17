"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { BOOKS, bookGroup, type Book, type BookGroup } from "@/lib/bible/books";

/** Collapse state remembered for the app session, like the reader's font step. */
let sessionCollapsed = { OT: false, NT: false };

type Testament = "OT" | "NT";

type ListRow =
  | { key: string; type: "testament"; testament: Testament; title: string; count: number; expanded: boolean }
  | { key: string; type: "group"; group: BookGroup }
  | { key: string; type: "book"; book: Book };

const TESTAMENTS: { testament: Testament; title: string }[] = [
  { testament: "OT", title: "Old Testament" },
  { testament: "NT", title: "New Testament" },
];

/** Flatten BOOKS into testament headers, genre subheaders, and book rows. */
function buildRows(collapsed: Record<Testament, boolean>): ListRow[] {
  const rows: ListRow[] = [];
  for (const { testament, title } of TESTAMENTS) {
    const books = BOOKS.filter((book) => book.testament === testament);
    const expanded = !collapsed[testament];
    rows.push({
      key: `testament-${testament}`,
      type: "testament",
      testament,
      title,
      count: books.length,
      expanded,
    });
    if (!expanded) continue;

    let currentGroup: BookGroup | null = null;
    for (const book of books) {
      const group = bookGroup(book.order);
      if (group && group !== currentGroup) {
        currentGroup = group;
        rows.push({ key: `group-${testament}-${group}`, type: "group", group });
      }
      rows.push({ key: `book-${book.order}`, type: "book", book });
    }
  }
  return rows;
}

/**
 * Bible book picker: all 66 books grouped by testament and genre, with
 * collapsible testament sections. Clicking a book opens its chapter-number
 * grid. Mirrors mobile/app/(app)/bible/index.tsx.
 */
const BibleBookPicker: React.FC = () => {
  const [collapsed, setCollapsed] = useState(sessionCollapsed);

  const toggleTestament = (testament: Testament) => {
    setCollapsed((prev) => {
      const next = { ...prev, [testament]: !prev[testament] };
      sessionCollapsed = next;
      return next;
    });
  };

  const rows = useMemo(() => buildRows(collapsed), [collapsed]);

  return (
    <div className="min-h-[100dvh] gradient-mesh">
      <div className="mx-auto w-full max-w-2xl px-5 pb-28 lg:pb-10">
        <div className="pt-3 pb-4">
          <h1 className="font-[family-name:var(--font-pirata)] text-4xl text-neutral-900 dark:text-neutral-100 drop-shadow-[0_0_8px_rgba(200,160,40,0.3)]">
            Bible
          </h1>
          <Link
            href="/bible/search"
            className="mt-3 flex items-center gap-2 rounded-full border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-4 py-2.5 text-sm text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors"
          >
            <span aria-hidden>🔍</span>
            Search the Bible
          </Link>
        </div>

        {/* Pick Up Your Cross — the guided daily walk (mirrors the Android Bible tab card) */}
        <Link
          href="/cross"
          className="mb-3 flex items-center gap-3 rounded-xl border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 px-4 py-3 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors"
        >
          <span aria-hidden className="text-xl text-amber-600 dark:text-amber-400">✝</span>
          <span className="flex-1">
            <span className="block text-[15px] font-bold text-amber-600 dark:text-amber-400">
              Pick Up Your Cross
            </span>
            <span className="block text-[12.5px] text-neutral-500 dark:text-neutral-400">
              Today&apos;s word, chosen for your walk
            </span>
          </span>
          <span aria-hidden className="text-lg font-semibold text-amber-600 dark:text-amber-400">›</span>
        </Link>

        {rows.map((row) => {
          if (row.type === "testament") {
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => toggleTestament(row.testament)}
                className="flex w-full items-center gap-2 pt-5 pb-2 text-left"
              >
                <span className="w-3 text-xs text-neutral-400 dark:text-neutral-600">
                  {row.expanded ? "▾" : "▸"}
                </span>
                <span className="flex-1 text-xs font-bold uppercase tracking-[0.1em] text-neutral-400 dark:text-neutral-500">
                  {row.title}
                </span>
                <span className="text-xs tabular-nums text-neutral-400/70 dark:text-neutral-600">
                  {row.count} {row.count === 1 ? "book" : "books"}
                </span>
              </button>
            );
          }
          if (row.type === "group") {
            return (
              <p
                key={row.key}
                className="pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400"
              >
                {row.group}
              </p>
            );
          }
          return (
            <Link
              key={row.key}
              href={`/bible/chapters?book=${row.book.order}`}
              className="mb-2 flex items-center justify-between gap-4 rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-4 py-3.5 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors"
            >
              <span className="text-[15px] font-semibold text-neutral-700 dark:text-neutral-300">
                {row.book.name}
              </span>
              <span className="text-xs tabular-nums text-neutral-400/70 dark:text-neutral-600">
                {row.book.chapters} {row.book.chapters === 1 ? "chapter" : "chapters"}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default BibleBookPicker;
