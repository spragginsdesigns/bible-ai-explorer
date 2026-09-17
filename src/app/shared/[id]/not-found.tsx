import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";

export default function SharedAnswerNotFound() {
  return (
    <main className="flex min-h-screen items-center bg-background px-6 py-16 text-foreground">
      <div className="mx-auto w-full max-w-lg">
        <BookOpen aria-hidden="true" className="mb-8 h-9 w-9 text-amber-700 dark:text-amber-400" strokeWidth={1.5} />
        <h1 className="font-[family-name:var(--font-cormorant)] text-4xl font-semibold leading-tight sm:text-5xl">This shared answer is no longer available.</h1>
        <p className="mt-5 text-body leading-relaxed text-neutral-600 dark:text-neutral-400">The link may be incomplete, or the person who shared it may have removed it. You can ask them for a new link or explore Scripture with SureWord.</p>
        <Link href="/" className="mt-8 inline-flex min-h-12 items-center gap-3 rounded-xl bg-amber-400 px-5 py-3 text-control font-semibold text-neutral-950 transition-colors hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-700 dark:focus-visible:outline-amber-300">Explore SureWord <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
      </div>
    </main>
  );
}
