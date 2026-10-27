import type { Metadata } from "next";
import GrowthScreen, { type WeekVerse } from "@/components/beta/growth/GrowthScreen";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { growthTimezone } from "@/lib/beta/growth/growth";
import { verseForWeek, weekStartOf } from "@/lib/beta/growth/growth-rules";
import { getKjvChapter } from "@/lib/bible/kjv";
import { localDayKey } from "@/lib/reading-history";

/**
 * Habits & Reflection (LC-17652, docs/beta/growth.md): habits of time with
 * God the founder chooses, counted from what they already do in SureWord, a
 * private reflection journal, and follow-ups on what they chose to put into
 * practice. Never a score.
 */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Habits & Reflection" });
}

/** This week's closing verse, quoted from the bundled KJV, never from memory. */
async function weekVerse(userId: string): Promise<WeekVerse | null> {
	const today = localDayKey(new Date(), await growthTimezone(userId, null));
	const { book, chapter, verse, reference } = verseForWeek(weekStartOf(today));
	try {
		const text = (await getKjvChapter(book, chapter))[verse - 1];
		return text ? { reference, text } : null;
	} catch {
		return null;
	}
}

export default async function BetaGrowthPage() {
	const userId = await requireBetaPage();
	return <GrowthScreen verse={await weekVerse(userId)} />;
}
