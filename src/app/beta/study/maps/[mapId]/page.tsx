import type { Metadata } from "next";
import { notFound } from "next/navigation";
import MapScreen from "@/components/beta/maps/MapScreen";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { findLibraryMap } from "@/lib/beta/maps/library";
import { getSavedMap } from "@/lib/beta/maps/store";

/**
 * One Concept Map (LC-17654): a ready-made map by its slug, one of the
 * founder's saved maps by its id, or "new" for a generated draft that has not
 * been saved yet (it lives in the tab's session storage). Anything else, and
 * anyone else's map, is the ordinary 404.
 */
type Props = { params: Promise<{ mapId: string }> };

const DRAFT = "new";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { mapId } = await params;
	return betaMetadata({ title: mapId === DRAFT ? "New map" : findLibraryMap(mapId)?.title ?? "Concept map" });
}

export default async function BetaConceptMapPage({ params }: Props) {
	const userId = await requireBetaPage();
	const { mapId } = await params;
	if (mapId === DRAFT) return <MapScreen mode="draft" initialMap={null} />;
	const library = findLibraryMap(mapId);
	if (library) {
		const { slug: _slug, ...map } = library;
		return <MapScreen mode="library" initialMap={map} />;
	}
	const saved = await getSavedMap(userId, mapId);
	if (!saved) notFound();
	return <MapScreen mode="saved" initialMap={saved.map} itemId={saved.id} />;
}
