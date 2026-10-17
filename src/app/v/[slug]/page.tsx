import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { BookOpen, ArrowUpRight } from "lucide-react";
import { canonicalPassage } from "@/lib/bible/passage-context";
import type { TranslationId } from "@/lib/bible/translations";
import { bibleVersePlainText } from "@/lib/bible/verseMarkup";
import { sharedPassageLink } from "@/lib/shared-passage";
import { readEncouragement } from "@/lib/share-cards/encouragement";
import { SHARE_CARD_DESIGN_VERSION, cardReferenceLabel, cardScriptureText, quoteScripture, verseSlug } from "@/lib/share-cards/layout";
import { referenceFromSlug } from "@/lib/share-cards/reference";
import GuestAsk from "@/components/marketing/GuestAsk";
import SharedDownloads from "@/components/shared/SharedDownloads";

/**
 * The door every verse card prints (docs/FEATURES.md, "Share cards"):
 * sureword.app/v/john-3-16.
 *
 * Whoever receives a card can type or tap that address and land here, signed
 * out: the passage, its line of encouragement when one has been written, a
 * link to read it in context, and the landing page's guest box opened on this
 * very verse ("What does John 3:16 mean?"). That last part is the point: a
 * card is no longer a picture that ends the conversation, it is the start of
 * the recipient's first study.
 *
 * Public (`/v/(.*)` in `isPublicRoute`). It reads only Scripture and the
 * shared encouragement table, never anything about the person who shared.
 */

interface VersePageProps {
	params: Promise<{ slug: string }>;
	searchParams: Promise<{ t?: string }>;
}

const TRANSLATIONS: readonly TranslationId[] = ["KJV", "BSB", "NKJV"];

function parseTranslation(value: string | undefined): TranslationId {
	const upper = value?.toUpperCase();
	return TRANSLATIONS.find((id) => id === upper) ?? "KJV";
}

const loadVerse = cache(async (slug: string, translation: TranslationId) => {
	const parsed = referenceFromSlug(slug);
	if (!parsed) return null;
	try {
		const passage = await canonicalPassage(parsed.label, translation);
		const verses = passage.verses.map((row) => ({
			verse: Number(row.reference.slice(row.reference.lastIndexOf(":") + 1)),
			text: bibleVersePlainText(row.text),
		}));
		if (!verses.some((row) => row.text)) return null;
		return {
			reference: passage.reference,
			text: cardScriptureText(verses),
			encouragement: await readEncouragement(passage.reference, { anyVersion: true }),
		};
	} catch {
		// A verse past the end of its chapter, or the NKJV source unreachable.
		return null;
	}
});

function pageUrl(reference: string, translation: TranslationId): string {
	const base = `https://sureword.app/v/${verseSlug(reference)}`;
	return translation === "KJV" ? base : `${base}?t=${translation.toLowerCase()}`;
}

export async function generateMetadata({ params, searchParams }: VersePageProps): Promise<Metadata> {
	const [{ slug }, { t }] = await Promise.all([params, searchParams]);
	const translation = parseTranslation(t);
	const verse = await loadVerse(slug, translation);
	if (!verse) return { title: "Not found", robots: { index: false } };

	const label = cardReferenceLabel(verse.reference);
	const title = `${label} (${translation})`;
	const description = verse.encouragement ?? verse.text.slice(0, 160);
	const card = new URLSearchParams({
		ref: verse.reference,
		translation,
		style: "dawn",
		format: "wide",
	});
	if (verse.encouragement) card.set("note", "1");
	card.set("v", SHARE_CARD_DESIGN_VERSION);
	const image = `https://sureword.app/api/cards/verse?${card.toString()}`;

	return {
		title,
		description,
		alternates: { canonical: pageUrl(verse.reference, translation) },
		openGraph: {
			type: "article",
			siteName: "SureWord",
			title,
			description,
			url: pageUrl(verse.reference, translation),
			images: [{ url: image, width: 1200, height: 630, alt: title }],
		},
		twitter: { card: "summary_large_image", title, description, images: [image] },
	};
}

export default async function VersePage({ params, searchParams }: VersePageProps) {
	const [{ slug }, { t }] = await Promise.all([params, searchParams]);
	const translation = parseTranslation(t);
	const verse = await loadVerse(slug, translation);
	if (!verse) notFound();
	// One page per passage: /v/jn-3-16 and /v/john-3-16-16 land on /v/john-3-16.
	const canonicalSlug = verseSlug(verse.reference);
	if (slug !== canonicalSlug) {
		permanentRedirect(`/v/${canonicalSlug}${translation === "KJV" ? "" : `?t=${translation.toLowerCase()}`}`);
	}

	const label = cardReferenceLabel(verse.reference);
	const context = sharedPassageLink(verse.reference, translation);
	const quoted = quoteScripture(verse.text);

	return (
		<main className="min-h-screen bg-background text-foreground selection:bg-amber-200 selection:text-neutral-950 dark:selection:bg-amber-400/30 dark:selection:text-amber-100">
			<div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 sm:py-14">
				<header className="flex items-center justify-between gap-3">
					<Link
						href="/"
						className="inline-flex min-h-11 items-center gap-2.5 rounded-md text-support font-semibold text-neutral-900 transition-colors hover:text-amber-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-600 dark:text-neutral-100 dark:hover:text-amber-300 dark:focus-visible:outline-amber-400"
					>
						<BookOpen aria-hidden="true" className="h-5 w-5 text-amber-700 dark:text-amber-400" strokeWidth={1.75} />
						SureWord
					</Link>
				</header>

				<article className="mt-10 sm:mt-14">
					<p className="text-metadata font-semibold uppercase tracking-[0.2em] text-amber-700 dark:text-amber-400">
						{label} · {translation}
					</p>
					<blockquote className="mt-5 font-[family-name:var(--font-cormorant)] text-3xl font-medium leading-[1.3] text-neutral-900 [text-wrap:pretty] sm:text-4xl dark:text-neutral-100">
						{quoted}
					</blockquote>
					{verse.encouragement ? (
						<p className="mt-6 border-l-2 border-amber-500/60 pl-4 font-[family-name:var(--font-cormorant)] text-2xl italic leading-snug text-neutral-700 dark:text-neutral-300">
							{verse.encouragement}
						</p>
					) : null}
					{context ? (
						<a
							href={context.href}
							target="_blank"
							rel="noopener noreferrer"
							className="mt-6 inline-flex min-h-11 items-center gap-1.5 text-support font-medium text-amber-700 underline decoration-amber-700/40 underline-offset-4 hover:decoration-current dark:text-amber-400 dark:decoration-amber-400/40"
						>
							Read it in context ({context.version})
							<ArrowUpRight aria-hidden="true" className="h-4 w-4" />
							<span className="sr-only"> (opens on {context.provider} in a new tab)</span>
						</a>
					) : null}
				</article>

				<div className="mt-12 sm:mt-16">
					<GuestAsk
						heading={`Ask SureWord about ${label}.`}
						samples={[
							`What does ${label} mean?`,
							`How can ${label} help me today?`,
							`What is the context of ${label}?`,
						]}
					/>
				</div>

				<footer className="mt-12 rounded-2xl border border-amber-900/10 bg-amber-50/70 p-5 sm:p-7 dark:border-amber-200/10 dark:bg-amber-200/[0.035]">
					<h2 className="font-[family-name:var(--font-cormorant)] text-3xl font-semibold leading-tight">
						A Bible study companion that knows you.
					</h2>
					<p className="mt-2 max-w-md text-support leading-relaxed text-neutral-600 dark:text-neutral-400">
						SureWord chooses a verse for your day, answers your questions from the King James Bible, and keeps
						your notes, highlights and prayers in one place.
					</p>
					<SharedDownloads />
				</footer>
			</div>
		</main>
	);
}
