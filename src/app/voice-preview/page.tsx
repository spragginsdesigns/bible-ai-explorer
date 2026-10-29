import LiveVoiceTrial from "@/components/voice/LiveVoiceTrial";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Talk to SureWord, Pro trial", robots: { index: false, follow: false } };

export default function VoicePreviewPage() {
	return <main className="mx-auto min-h-screen max-w-3xl px-4 py-10 pb-28">
		<LiveVoiceTrial />
	</main>;
}
