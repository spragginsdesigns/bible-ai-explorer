import type { Metadata } from "next";
import KidsParent from "@/components/beta/kids/KidsParent";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { KIDS_ADVENTURES } from "@/lib/beta/kids/adventures";
import { listChildren } from "@/lib/beta/kids/children";
import { passageReference } from "@/lib/beta/kids/kids-rules";
import { bookByOrder } from "@/lib/bible/books";

/**
 * SureWord Kids (LC-17657, docs/beta/kids.md): the parent's side. Add a child
 * (a first name or nickname and an age band), see their stars, and open Kids
 * mode for one of them. Kids mode itself is /beta/together/kids/play.
 */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "SureWord Kids" });
}

export default async function BetaKidsPage() {
	const userId = await requireBetaPage();
	const children = await listChildren(userId);
	const adventures = KIDS_ADVENTURES.map((adventure) => ({
		id: adventure.id,
		title: adventure.title,
		reference: passageReference(bookByOrder(adventure.book)?.name ?? "", adventure.segments),
	}));
	return <KidsParent initialChildren={children} adventures={adventures} />;
}
