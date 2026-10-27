import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MapsHome from "@/components/beta/maps/MapsHome";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { LIBRARY_MAPS } from "@/lib/beta/maps/library";
import { listSavedMaps } from "@/lib/beta/maps/store";

/** Concept Maps (LC-17654, docs/beta/maps.md): the ready-made maps, the builder and the founder's saved maps. */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Concept Maps" });
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function BetaConceptMapsPage({ searchParams }: Props) {
	const userId = await requireBetaPage();
	// The Vault opens a saved map as `?item=<id>` (docs/beta/vault.md); the map's own page checks it is the founder's.
	const { item } = await searchParams;
	if (typeof item === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(item)) redirect(`/beta/study/maps/${item}`);
	const saved = await listSavedMaps(userId);
	const library = LIBRARY_MAPS.map((map) => ({
		slug: map.slug,
		title: map.title,
		summary: map.summary,
		nodes: map.nodes.length,
		questions: map.nodes.filter((node) => node.kind === "question").length,
	}));
	return <MapsHome library={library} saved={saved} />;
}
