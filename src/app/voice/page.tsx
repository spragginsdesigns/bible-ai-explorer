import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import LiveVoiceTrial from "@/components/voice/LiveVoiceTrial";
import { canUseLiveVoice } from "@/lib/voice/live-access";

export const metadata: Metadata = { title: "Talk to SureWord", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function VoicePage({ searchParams }: { searchParams: Promise<{ conversationId?: string }> }) {
	const { userId } = await auth();
	if (!userId || !await canUseLiveVoice(userId)) notFound();
	const params = await searchParams;
	const conversationId = typeof params.conversationId === "string" && params.conversationId.length <= 128 ? params.conversationId : undefined;
	return <main className="mx-auto min-h-screen max-w-3xl px-4 py-10 pb-28">
		<LiveVoiceTrial conversationId={conversationId} />
	</main>;
}
