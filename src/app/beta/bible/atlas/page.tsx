import type { Metadata } from "next";
import AtlasExplorer from "@/components/beta/atlas/AtlasExplorer";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { getBetaAtlasIndex } from "@/lib/beta/atlas/atlas";
import { parseAtlasUrl } from "@/lib/beta/atlas/atlas-rules";
import { ATLAS_REGIONS } from "@/lib/beta/atlas/regions";

/**
 * Atlas & Timeline (LC-17655, docs/beta/atlas.md), the Bible destination's
 * map and chronology of Scripture. Founders only: everyone else gets the
 * ordinary 404 before anything is read.
 */
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Atlas & Timeline" });
}

export default async function BetaAtlasPage({ searchParams }: Props) {
	await requireBetaPage();
	const [index, params] = await Promise.all([getBetaAtlasIndex(), searchParams]);
	const initial = parseAtlasUrl(params, {
		journeys: index.journeys.map((journey) => ({ id: journey.id, stops: journey.stops.length })),
		eras: index.eras.map((era) => era.era),
		regions: ATLAS_REGIONS.map((region) => region.id),
		places: new Set([...index.places.map((place) => place.id), ...Object.keys(index.sameSite), ...index.places.flatMap((place) => place.alsoHere.map((entry) => entry.id))]),
		events: new Map(index.events.map((event) => [event.id, event.dated ? event.start : null])),
		defaultJourney: "paul-2",
		defaultYear: -975,
	});
	return <AtlasExplorer index={index} initial={initial} />;
}
