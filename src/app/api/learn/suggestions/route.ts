import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
	DEFAULT_TRANSLATION,
	TRANSLATION_IDS,
	readStoredHighlightLabels,
} from "@/lib/preferences-contract";
import type { TranslationId } from "@/lib/bible/translations";
import { suggestVerses } from "@/lib/learn-suggestions";
import { prisma } from "@/lib/prisma";

/**
 * Verses SureWord suggests this user learn: at most five, each one already
 * near to their walk and already load-bearing in Scripture, and each one
 * naming why it was chosen. Verses already in their Learn queue are never
 * suggested, at any stage, including the ones they have marked known.
 */
export async function GET() {
	try {
		const userId = await getAuthUser();
		const user = await prisma.user.findUnique({
			where: { id: userId },
			select: { translation: true, highlightLabels: true },
		});
		const stored = user?.translation;
		const translation: TranslationId = (TRANSLATION_IDS as readonly string[]).includes(stored ?? "")
			? (stored as TranslationId)
			: DEFAULT_TRANSLATION;

		return NextResponse.json({
			suggestions: await suggestVerses(
				userId,
				translation,
				readStoredHighlightLabels(user?.highlightLabels),
			),
		});
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/learn/suggestions] GET failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
