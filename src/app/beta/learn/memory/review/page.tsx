import type { Metadata } from "next";
import MemorySession from "@/components/beta/memory/MemorySession";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";

/** Scripture Memory's daily review session (LC-17651, docs/beta/memory.md). */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Review | Scripture Memory" });
}

export default async function ScriptureMemoryReviewPage() {
	await requireBetaPage();
	return <MemorySession />;
}
