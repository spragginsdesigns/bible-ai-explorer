import type { Metadata } from "next";
import PathsHub from "@/components/beta/paths/PathsHub";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { hubView } from "@/lib/beta/paths/server";

/** Learning Paths (LC-17648, docs/beta/paths.md): Duolingo-style courses through Scripture. */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Learning Paths" });
}

export default async function LearningPathsPage() {
	const userId = await requireBetaPage();
	const view = await hubView(userId);
	return <PathsHub written={view.written} personal={view.personal} />;
}
