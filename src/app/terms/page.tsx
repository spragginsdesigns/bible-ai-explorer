import type { Metadata } from "next";
import Link from "next/link";
import LegalBlocks from "@/components/marketing/LegalBlocks";
import { MEMBERSHIP_TERMS } from "@/lib/marketing/legal-content";

// The root layout's title template appends " | SureWord".
// The text lives in src/lib/marketing/legal-content.ts, shared with /terms.md.
export const metadata: Metadata = {
  title: "Membership terms",
  alternates: {
    canonical: "/terms",
    types: { "text/markdown": "/terms.md" },
  },
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#101410] px-6 py-14 text-[#f3efe3]">
      <article className="mx-auto max-w-2xl space-y-7 leading-7">
        <Link href="/" className="text-[#d9b878]">
          Back to SureWord
        </Link>
        <h1 className="text-4xl">{MEMBERSHIP_TERMS.title}</h1>
        <p className="text-sm text-[#b6bcb0]">{MEMBERSHIP_TERMS.byline}</p>
        <LegalBlocks
          blocks={MEMBERSHIP_TERMS.blocks}
          classNames={{ h2: "text-xl", link: "text-[#d9b878] underline" }}
        />
      </article>
    </main>
  );
}
