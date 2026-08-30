"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { BOOKS, bookGroup, type Book, type BookGroup } from "@/lib/bible/books";
import { planCardSubtitle } from "@/components/plan/planView";
import { useReadingPlan } from "@/components/plan/useReadingPlan";

/** Collapse state remembered for the app session, like the reader's font step. */
let sessionCollapsed = { OT: false, NT: false };

type Testament = "OT" | "NT";

interface GroupSection {
  group: BookGroup | null;
  books: Book[];
}

interface TestamentSection {
  testament: Testament;
  title: string;
  count: number;
  groups: GroupSection[];
}

const TESTAMENTS: { testament: Testament; title: string }[] = [
  { testament: "OT", title: "Old Testament" },
  { testament: "NT", title: "New Testament" },
];

/** Group BOOKS into testament sections, each split by genre group. */
function buildSections(): TestamentSection[] {
  return TESTAMENTS.map(({ testament, title }) => {
    const books = BOOKS.filter((book) => book.testament === testament);
    const groups: GroupSection[] = [];
    for (const book of books) {
      const group = bookGroup(book.order);
      const last = groups[groups.length - 1];
      if (last && last.group === group) {
        last.books.push(book);
      } else {
        groups.push({ group, books: [book] });
      }
    }
    return { testament, title, count: books.length, groups };
  });
}

/**
 * Bible book picker: all 66 books grouped by testament and genre, with
 * collapsible testament sections. Clicking a book opens its chapter-number
 * grid. Single column on phones (mirrors mobile/app/(app)/bible/index.tsx);
 * on desktop the books lay out as a multi-column card grid per genre.
 */
const BibleBookPicker: React.FC = () => {
  const [collapsed, setCollapsed] = useState(sessionCollapsed);
  // Read-only here: the card shows where the plan stands and hands the user on
  // to the plan page, which owns every action.
  const { plan } = useReadingPlan();

  const toggleTestament = (testament: Testament) => {
    setCollapsed((prev) => {
      const next = { ...prev, [testament]: !prev[testament] };
      sessionCollapsed = next;
      return next;
    });
  };

  const sections = useMemo(() => buildSections(), []);

  return (
    <div className="min-h-[100dvh] gradient-mesh">
      <div className="mx-auto w-full max-w-2xl lg:max-w-6xl px-5 lg:px-8 pb-28 lg:pb-16">
        {/* Header: title left, search right on desktop; stacked on mobile */}
        <div className="pt-3 lg:pt-8 pb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h1 className="font-[family-name:var(--font-pirata)] text-4xl lg:text-5xl text-neutral-900 dark:text-neutral-100 drop-shadow-[0_0_8px_rgba(200,160,40,0.3)]">
            Bible
          </h1>
          <Link
            href="/bible/search"
            className="flex items-center gap-2 rounded-full border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-4 py-2.5 text-sm text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors lg:w-96"
          >
            <Search className="w-4 h-4 flex-shrink-0" aria-hidden />
            Search the Bible
          </Link>
        </div>

        {/* Reading plan - where they are in it, or an invitation (mirrors the Android Bible tab card) */}
        <Link
          href="/bible/plan"
          className="mb-3 flex items-center gap-3 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-4 py-3 lg:px-5 lg:py-4 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors"
        >
          <span aria-hidden className="text-lg lg:text-xl text-neutral-500 dark:text-neutral-400">◷</span>
          <span className="flex-1">
            <span className="block text-[15px] lg:text-base font-bold text-neutral-900 dark:text-neutral-100">
              {plan ? plan.title : "Reading plan"}
            </span>
            <span className="block text-[12.5px] lg:text-sm text-neutral-500 dark:text-neutral-400">
              {planCardSubtitle(plan)}
            </span>
          </span>
          <span aria-hidden className="text-lg font-semibold text-neutral-400 dark:text-neutral-500">›</span>
        </Link>

        {/* Timeline, People & Places - when, who, and where (mirrors the Android Bible tab card) */}
        <Link
          href="/bible/timeline"
          className="mb-3 flex items-center gap-3 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-4 py-3 lg:px-5 lg:py-4 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors"
        >
          <span aria-hidden className="text-lg lg:text-xl text-neutral-500 dark:text-neutral-400">◈</span>
          <span className="flex-1">
            <span className="block text-[15px] lg:text-base font-bold text-neutral-900 dark:text-neutral-100">
              Timeline, People &amp; Places
            </span>
            <span className="block text-[12.5px] lg:text-sm text-neutral-500 dark:text-neutral-400">
              When, who, and where in Scripture
            </span>
          </span>
          <span aria-hidden className="text-lg font-semibold text-neutral-400 dark:text-neutral-500">›</span>
        </Link>

        {/* Pick Up Your Cross - the guided daily walk (mirrors the Android Bible tab card) */}
        <Link
          href="/cross"
          className="mb-3 flex items-center gap-3 rounded-xl border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 px-4 py-3 lg:px-5 lg:py-4 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors"
        >
          <span aria-hidden className="text-xl lg:text-2xl text-amber-600 dark:text-amber-400">✝</span>
          <span className="flex-1">
            <span className="block text-[15px] lg:text-base font-bold text-amber-600 dark:text-amber-400">
              Pick Up Your Cross
            </span>
            <span className="block text-[12.5px] lg:text-sm text-neutral-500 dark:text-neutral-400">
              Today&apos;s word, chosen for your walk
            </span>
          </span>
          <span aria-hidden className="text-lg font-semibold text-amber-600 dark:text-amber-400">›</span>
        </Link>

        {sections.map((section) => {
          const expanded = !collapsed[section.testament];
          return (
            <section key={section.testament}>
              <button
                type="button"
                onClick={() => toggleTestament(section.testament)}
                className="flex w-full items-center gap-2 pt-6 pb-3 text-left"
              >
                <span className="w-3 text-xs text-neutral-400 dark:text-neutral-600">
                  {expanded ? "▾" : "▸"}
                </span>
                <span className="flex-1 text-xs font-bold uppercase tracking-[0.1em] text-neutral-400 dark:text-neutral-500">
                  {section.title}
                </span>
                <span className="text-xs tabular-nums text-neutral-400/70 dark:text-neutral-600">
                  {section.count} {section.count === 1 ? "book" : "books"}
                </span>
              </button>

              {expanded &&
                section.groups.map(({ group, books }) => (
                  <div key={group ?? "ungrouped"} className="mb-4">
                    {group && (
                      <p className="pb-2 text-metadata font-semibold uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
                        {group}
                      </p>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                      {books.map((book) => (
                        <Link
                          key={book.order}
                          href={`/bible/chapters?book=${book.order}`}
                          className="flex items-center justify-between gap-4 rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-4 py-3.5 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] hover:border-amber-500/30 dark:hover:border-amber-400/20 transition-colors"
                        >
                          <span className="truncate text-[15px] font-semibold text-neutral-700 dark:text-neutral-300">
                            {book.name}
                          </span>
                          <span className="flex-shrink-0 text-xs tabular-nums text-neutral-400/70 dark:text-neutral-600">
                            {book.chapters} {book.chapters === 1 ? "chapter" : "chapters"}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default BibleBookPicker;
