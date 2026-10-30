import { approvedSharedSnapshot } from "@/lib/ai/history/shared-boundary.server";
import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import SharedAnswerView from "@/components/shared/SharedAnswerView";
import {
	isSharedAnswerId,
	shareDescription,
	shareTitle,
	sharedAnswerCardUrl,
	sharedAnswerUrl,
} from "@/lib/shared-answer";

/**
 * The public page for a shared answer (docs/FEATURES.md, "Share an answer").
 *
 * Signed-out reads keep the immutable snapshot, and require its exact answer,
 * references and translation to match a currently verified owned source.
 * Unchecked snapshots stay stored and remain hidden until checked.
 *
 * Unknown ids and revoked ids are both a plain 404: distinguishing them would
 * confirm to a stranger that an id had once existed.
 */

interface SharedAnswerParams {
	params: Promise<{ id: string }>;
}

/**
 * `cache` deduplicates the lookup across generateMetadata and the render,
 * which Next runs as two separate passes over the same request.
 */
const loadSharedAnswer = cache(async (id: string) => {
	if (!isSharedAnswerId(id)) return null;
	const share = await prisma.sharedAnswer.findFirst({
		where: { id, revokedAt: null },
		select: { id: true, userId: true, conversationId: true, messageId: true, question: true, answer: true, references: true, translation: true, listedAt: true },
	});
	return share && await approvedSharedSnapshot(share) ? share : null;
});

function readReferences(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string");
}

export async function generateMetadata({ params }: SharedAnswerParams): Promise<Metadata> {
	const { id } = await params;
	const share = await loadSharedAnswer(id);
	if (!share) return { title: "Not found", robots: { index: false } };

	const title = shareTitle(share.question);
	const description = shareDescription(share.answer);
	const card = sharedAnswerCardUrl(share.id);

	return {
		title,
		description,
		alternates: { canonical: sharedAnswerUrl(share.id) },
		// Unlisted unless the owner turned on "Show in search": the link is the
		// capability, and indexing every share would publish questions people
		// only meant to send to a friend. Noindex only, not nofollow: the link
		// back to SureWord should still carry weight either way.
		robots: { index: share.listedAt !== null },
		openGraph: {
			type: "article",
			siteName: "SureWord",
			title,
			description,
			url: sharedAnswerUrl(share.id),
			images: [{ url: card, width: 1200, height: 630, alt: title }],
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
			images: [card],
		},
	};
}

export default async function SharedAnswerPage({ params }: SharedAnswerParams) {
	const { id } = await params;
	const share = await loadSharedAnswer(id);
	if (!share) notFound();

	return (
		<SharedAnswerView
			question={share.question}
			answer={share.answer}
			references={readReferences(share.references)}
			translation={share.translation}
		/>
	);
}
