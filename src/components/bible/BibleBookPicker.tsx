"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronRight, ChevronDown, BookOpen } from "lucide-react";
import { BOOKS, bookGroup, type Book, type BookGroup } from "@/lib/bible/books";
import { useContinueReading } from "@/components/daily/useContinueReading";

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



export default function BibleBookPicker() {
  const [collapsed, setCollapsed] = useState(sessionCollapsed);
  const continueTarget = useContinueReading();
  const sections = useMemo(() => buildSections(), []);
  const toggleTestament = (testament: Testament) => {
    setCollapsed(previous => {
      const next = { ...previous, [testament]: !previous[testament] };
      sessionCollapsed = next;
      return next;
    });
  };
  return <main className="mx-auto w-full max-w-2xl px-5 pb-28 lg:max-w-6xl lg:px-8 lg:pb-16">
    <header className="flex flex-col gap-3 pb-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-xs font-bold uppercase tracking-[.2em] text-amber-800 dark:text-[#e5b664]">The written Word</p><h1 className="mt-1 font-[family-name:var(--font-cormorant)] text-4xl font-semibold">Read the Bible</h1></div>
      <Link href="/bible/search" className="flex min-h-12 items-center gap-3 rounded-2xl border border-black/10 bg-white/40 px-4 text-sm text-neutral-600 hover:bg-white/70 dark:border-white/10 dark:bg-white/[.03] dark:text-neutral-300 dark:hover:bg-white/[.06] sm:w-72"><Search size={19} aria-hidden />Search Scripture</Link>
    </header>
    {continueTarget && <Link href={continueTarget.href} className="mb-3 flex min-h-20 items-center gap-4 rounded-2xl border border-amber-800/15 bg-amber-500/[.06] px-4 dark:border-amber-300/15"><BookOpen size={25} className="text-amber-800 dark:text-[#e5b664]" aria-hidden /><span className="flex-1"><span className="block font-bold">Continue reading</span><span className="text-sm text-neutral-600 dark:text-neutral-400">{continueTarget.label}</span></span><ChevronRight size={20} aria-hidden /></Link>}
        {sections.map((section) => {
          const expanded = !collapsed[section.testament];
          return (
            <section key={section.testament}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => toggleTestament(section.testament)}
                className="flex w-full items-center gap-2 pt-6 pb-3 text-left"
              >
                <ChevronDown size={16} aria-hidden className={expanded ? "" : "-rotate-90"} />
                <span className="flex-1 text-xs font-bold uppercase tracking-[0.1em] text-neutral-600 dark:text-neutral-400">
                  {section.title}
                </span>
                <span className="text-xs tabular-nums text-neutral-600 dark:text-neutral-400">
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
                          <span className="truncate text-[0.9375rem] font-semibold text-neutral-700 dark:text-neutral-300">
                            {book.name}
                          </span>
                          <span className="flex-shrink-0 text-xs tabular-nums text-neutral-600 dark:text-neutral-400">
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
  </main>;
}
