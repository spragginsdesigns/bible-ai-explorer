import { Suspense } from "react";
import ChapterGrid from "@/components/bible/ChapterGrid";

export default function BibleChaptersPage() {
  return (
    <Suspense>
      <ChapterGrid />
    </Suspense>
  );
}
