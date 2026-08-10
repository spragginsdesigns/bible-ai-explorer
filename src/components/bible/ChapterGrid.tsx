"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { bookByOrder } from "@/lib/bible/books";

/**
 * Chapter-number grid for one book. Clicking a number opens the reading
 * screen for that chapter. Mirrors mobile/app/(app)/bible/chapters.tsx.
 */
const ChapterGrid: React.FC = () => {
  const searchParams = useSearchParams();
  const order = Number.parseInt(searchParams.get("book") ?? "", 10);
  const book = bookByOrder(order);

  if (!book) {
    return (
      <div className="min-h-[100dvh] gradient-mesh">
        <div className="mx-auto w-full max-w-2xl px-5">
          <div className="flex items-center py-3">
            <Link href="/bible" className="text-[15px] font-semibold text-amber-600 dark:text-amber-400">
              ‹ Back
            </Link>
          </div>
          <div className="flex items-center justify-center p-8">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">That book could not be found.</p>
          </div>
        </div>
      </div>
    );
  }

  const chapters = Array.from({ length: book.chapters }, (_, index) => index + 1);

  return (
    <div className="min-h-[100dvh] gradient-mesh">
      <div className="mx-auto w-full max-w-2xl px-5 pb-10">
        <div className="flex items-center gap-4 py-3">
          <Link href="/bible" className="text-[15px] font-semibold text-amber-600 dark:text-amber-400">
            ‹ Back
          </Link>
          <h1 className="flex-1 truncate text-center text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
            {book.name}
          </h1>
          <span className="w-11" aria-hidden />
        </div>

        <div className="grid grid-cols-5 gap-2 pt-2 sm:grid-cols-8 md:grid-cols-10">
          {chapters.map((chapter) => (
            <Link
              key={chapter}
              href={`/bible/chapter?book=${book.order}&chapter=${chapter}`}
              aria-label={`${book.name} chapter ${chapter}`}
              className="flex aspect-square items-center justify-center rounded-lg border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] text-[15px] font-semibold tabular-nums text-neutral-700 dark:text-neutral-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] hover:border-amber-500/30 dark:hover:border-amber-400/20 transition-colors"
            >
              {chapter}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ChapterGrid;
