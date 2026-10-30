import type { Metadata } from "next";
import AwardsRoom from "@/components/beta/games/AwardsRoom";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { loadAwardsRoom } from "@/lib/beta/games/awards-room";

/**
 * The Awards Room (LC-17906, docs/beta/games.md): the founder's grade,
 * trophies and chapter plaques for Matthew. This static route outranks the
 * games' [game] page beside it.
 */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Awards Room" });
}

export default async function BetaAwardsRoomPage() {
	const userId = await requireBetaPage();
	return <AwardsRoom room={await loadAwardsRoom(userId)} />;
}
