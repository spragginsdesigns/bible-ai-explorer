import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { canUseLiveVoice } from "@/lib/voice/live-access";

export const dynamic = "force-dynamic";

export default async function VoicePreviewPage() {
	const { userId } = await auth();
	if (!userId || !await canUseLiveVoice(userId)) notFound();
	redirect("/voice");
}
