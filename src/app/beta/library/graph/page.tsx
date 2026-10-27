import { Suspense } from "react";
import type { Metadata } from "next";
import GraphScreen from "@/components/beta/graph/GraphScreen";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";

/**
 * The Living Study Graph (LC-17646, docs/beta/graph.md): a map of the
 * founder's passages, topics, notes, chats, sermon studies and every beta
 * study, joined by wikilinks, links, suggested connections and the
 * cross-references the Connections ring draws. This static route replaces
 * the module's placeholder under /beta/library/[slug].
 */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Living Study Graph" });
}

export default async function BetaGraphPage() {
	await requireBetaPage();
	return (
		<Suspense>
			<GraphScreen />
		</Suspense>
	);
}
