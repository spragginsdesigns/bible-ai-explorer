import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PathView from "@/components/beta/paths/PathView";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { writtenPath } from "@/lib/beta/paths/catalog";
import { loadPath, pageView } from "@/lib/beta/paths/server";

type Props = { params: Promise<{ pathId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { pathId } = await params;
	return betaMetadata({ title: writtenPath(pathId)?.title ?? (pathId.startsWith("c-") ? "Your curriculum" : "Not found") });
}

/** One path's map (LC-17648): units, lessons, checkpoints, and what the founder has shown. */
export default async function LearningPathPage({ params }: Props) {
	const userId = await requireBetaPage();
	const { pathId } = await params;
	const loaded = await loadPath(userId, pathId);
	if (!loaded) notFound();
	return <PathView view={await pageView(userId, loaded)} />;
}
