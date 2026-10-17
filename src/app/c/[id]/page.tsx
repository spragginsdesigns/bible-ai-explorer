import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, BookOpen } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { isSharedAnswerId } from "@/lib/shared-answer";
import { sharedPassageLink } from "@/lib/shared-passage";
import { cardReferenceLabel, quoteScripture } from "@/lib/share-cards/layout";
import { PERSONAL_CARD_SELECT, personalCardContent, personalCardUrl } from "@/lib/share-cards/personal";
import GuestAsk from "@/components/marketing/GuestAsk";
import SharedDownloads from "@/components/shared/SharedDownloads";

/**
 * The page a personal card opens (docs/FEATURES.md, "Share cards" -> "Send a
 * word"): sureword.app/c/{id}.
 *
 * Whoever received the card sees it addressed to them: "For Sarah", the
 * verse, SureWord's word for them, the sender's own line and name, then the
 * guest box opened on that verse and the install links. Public by design
 * (`/c/(.*)` in `isPublicRoute`), but never indexed: the id is the
 * capability, the card was meant for one person, and revoking takes it back
 * (a revoked or unpublished id is a plain 404).
 */

interface PersonalCardPageProps {
	params: Promise<{ id: string }>;
}

const loadCard = cache(async (id: string) => {
	if (!isSharedAnswerId(id)) return null;
	const card = await prisma.sharedCard.findFirst({
		where: { id, revokedAt: null, publishedAt: { not: null } },
		select: PERSONAL_CARD_SELECT,
	});
	if (!card) return null;
	try {
		const content = await personalCardContent(id, card);
		return content.kind === "personal" ? content : null;
	} catch {
		return null;
	}
});

export async function generateMetadata({ params }: PersonalCardPageProps): Promise<Metadata> {
	const { id } = await params;
	const card = await loadCard(id);
	if (!card) return { title: "Not found", robots: { index: false } };
	const label = cardReferenceLabel(card.reference);
	const title = card.recipient ? `A word for ${card.recipient}` : `${label} (${card.translation})`;
	const description = card.word ?? card.text.slice(0, 160);
	const image = `https://sureword.app/api/cards/c/${id}/image`;
	return {
		title,
		description,
		alternates: { canonical: personalCardUrl(id) },
		robots: { index: false },
		openGraph: {
			type: "article",
			siteName: "SureWord",
			title,
			description,
			url: personalCardUrl(id),
			images: [{ url: image, width: 1200, height: 630, alt: title }],
		},
		twitter: { card: "summary_large_image", title, description, images: [image] },
	};
}

export default async function PersonalCardPage({ params }: PersonalCardPageProps) {
	const { id } = await params;
	const card = await loadCard(id);
	if (!card) notFound();

	const label = cardReferenceLabel(card.reference);
	const context = sharedPassageLink(card.reference, card.translation);

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
					{card.recipient ? (
						<h1 className="font-[family-name:var(--font-cormorant)] text-4xl font-semibold leading-tight text-neutral-900 sm:text-5xl dark:text-neutral-100">
							A word for {card.recipient}
						</h1>
					) : null}
					<p className="mt-6 text-metadata font-semibold uppercase tracking-[0.2em] text-amber-700 dark:text-amber-400">
						{label} · {card.translation}
					</p>
					<blockquote className="mt-4 font-[family-name:var(--font-cormorant)] text-3xl font-medium leading-[1.3] text-neutral-900 [text-wrap:pretty] sm:text-4xl dark:text-neutral-100">
						{quoteScripture(card.text)}
					</blockquote>
					{card.word ? (
						<p className="mt-6 border-l-2 border-amber-500/60 pl-4 font-[family-name:var(--font-cormorant)] text-2xl italic leading-snug text-neutral-700 dark:text-neutral-300">
							{card.word}
						</p>
					) : null}
					{card.personalLine || card.signature ? (
						<div className="mt-8">
							{card.personalLine ? (
								<p className="font-[family-name:var(--font-cormorant)] text-2xl italic leading-snug text-neutral-800 dark:text-neutral-200">
									&ldquo;{card.personalLine}&rdquo;
								</p>
							) : null}
							{card.signature ? (
								<p className="mt-2 text-support font-semibold text-amber-700 dark:text-amber-400">
									With love, {card.signature}
								</p>
							) : null}
						</div>
					) : null}
					{context ? (
						<a
							href={context.href}
							target="_blank"
							rel="noopener noreferrer"
							className="mt-8 inline-flex min-h-11 items-center gap-1.5 text-support font-medium text-amber-700 underline decoration-amber-700/40 underline-offset-4 hover:decoration-current dark:text-amber-400 dark:decoration-amber-400/40"
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
						samples={[`What does ${label} mean?`, `How can ${label} help me today?`, `What is the context of ${label}?`]}
					/>
				</div>

				<footer className="mt-12 rounded-2xl border border-amber-900/10 bg-amber-50/70 p-5 sm:p-7 dark:border-amber-200/10 dark:bg-amber-200/[0.035]">
					<h2 className="font-[family-name:var(--font-cormorant)] text-3xl font-semibold leading-tight">
						A Bible study companion that knows you.
					</h2>
					<p className="mt-2 max-w-md text-support leading-relaxed text-neutral-600 dark:text-neutral-400">
						SureWord chooses a verse for your day, answers your questions from the King James Bible, and helps you
						send a word to the people you love.
					</p>
					<SharedDownloads />
				</footer>
			</div>
		</main>
	);
}
