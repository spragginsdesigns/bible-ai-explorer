import type { Metadata } from "next";
import GamesHome from "@/components/beta/games/GamesHome";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { listGameAwards } from "@/lib/beta/games/awards";

/**
 * Chapter Games (LC-17850, docs/beta/games.md): the chapters that have a game
 * and the awards the founder has earned. This route outranks the Bible
 * destination's placeholder at [slug].
 */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Chapter Games" });
}

export default async function BetaChapterGamesPage() {
	const userId = await requireBetaPage();
	return <GamesHome awards={await listGameAwards(userId)} />;
}
