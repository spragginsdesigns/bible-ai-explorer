import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { readDailyCrossAudio } from "@/lib/daily-cross-audio";
import { readNarrationVoices } from "@/lib/daily-cross-voices";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(): Promise<Response> {
	try {
		const userId = await getAuthUser();
		const audio = await readDailyCrossAudio(userId);
		if (audio.status === "locked" || audio.status === "unavailable") return NextResponse.json({ voices: [], defaultVoiceId: "" }, { headers });
		return NextResponse.json(await readNarrationVoices(), { headers });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("Narration voice catalog failed:", error);
		return NextResponse.json({ error: "Voices couldn't load. Try again." }, { status: 503, headers });
	}
}
