import type { Metadata } from "next";
import WhatsNewShell from "@/components/whats-new/WhatsNewShell";
import { WHATS_NEW_ENTRIES } from "@/lib/whats-new";

export const metadata: Metadata = {
	// The root layout's title template appends " | SureWord".
	title: "What's new",
	description: "Every SureWord update: what changed, why, and what it means for your study of the King James Bible.",
	alternates: { canonical: "/whats-new" },
};

export default function WhatsNewPage() {
	return <WhatsNewShell initialVersion={WHATS_NEW_ENTRIES[0]?.version ?? "beginning"} />;
}
