import type { Metadata } from "next";
import SermonsHub from "@/components/beta/sermons/SermonsHub";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { sermonCards } from "@/lib/beta/sermons/server";

/** Sermon to Study (LC-17643, docs/beta/sermons.md): turn a sermon into a study you can keep. */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Sermon to Study" });
}

export default async function SermonsPage() {
	const userId = await requireBetaPage();
	return <SermonsHub sermons={await sermonCards(userId)} />;
}
