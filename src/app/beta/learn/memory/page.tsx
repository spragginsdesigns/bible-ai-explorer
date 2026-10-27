import type { Metadata } from "next";
import MemoryHome from "@/components/beta/memory/MemoryHome";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { memoryOverview } from "@/lib/beta/memory/memory";

/**
 * Scripture Memory (LC-17651, docs/beta/memory.md): richer practice over
 * Learn a verse's own cards and schedule. This route outranks the learn
 * placeholder at [slug].
 */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Scripture Memory" });
}

export default async function ScriptureMemoryPage() {
	const userId = await requireBetaPage();
	return <MemoryHome initial={await memoryOverview(userId)} />;
}
