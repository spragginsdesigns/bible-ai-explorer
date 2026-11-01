import type { Metadata } from "next";
import { redirect } from "next/navigation";
import SermonsHub from "@/components/beta/sermons/SermonsHub";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { sermonCards } from "@/lib/beta/sermons/server";

/** Sermon to Study (LC-17643, docs/beta/sermons.md): turn a sermon into a study you can keep. */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Sermon to Study" });
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SermonsPage({ searchParams }: Props) {
	const userId = await requireBetaPage();
	// The Knowledge Vault opens a sermon as `?item=<id>` (docs/beta/vault.md); the sermon's own page checks it is the founder's.
	const { item } = await searchParams;
	if (typeof item === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(item)) redirect(`/beta/study/sermons/${item}`);
	return <SermonsHub sermons={await sermonCards(userId)} />;
}
