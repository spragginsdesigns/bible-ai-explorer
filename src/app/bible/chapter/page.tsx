import { Suspense } from "react";
import ChapterReader from "@/components/bible/ChapterReader";

export default function BibleChapterPage() {
  return (
    <Suspense>
      <ChapterReader />
    </Suspense>
  );
}
