import type { Metadata } from "next";
import { notFound } from "next/navigation";
import KidsMode from "@/components/beta/kids/KidsMode";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { getChild } from "@/lib/beta/kids/children";
import { kidsAdventureViews } from "@/lib/beta/kids/passages";

/**
 * Kids mode for one child (docs/beta/kids.md): full screen, no links out, no
 * chat, and no way back to the parent's side without the parent check. The
 * child is a query parameter, not a path segment, because page views send the
 * path to analytics and never the query.
 */
type Props = { searchParams: Promise<{ child?: string | string[] }> };

export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "SureWord Kids" });
}

export default async function BetaKidsPlayPage({ searchParams }: Props) {
	const userId = await requireBetaPage();
	const { child: childId } = await searchParams;
	const child = typeof childId === "string" ? await getChild(userId, childId) : null;
	if (!child) notFound();
	return <KidsMode child={child} adventures={await kidsAdventureViews(child.ageBand)} />;
}
