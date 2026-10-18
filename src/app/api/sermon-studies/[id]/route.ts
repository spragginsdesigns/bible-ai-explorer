import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { listChurchEvents } from "@/lib/church-events";
import { getSermonStudy } from "@/lib/sermon-studies";

/** One study, with the still-upcoming events announced at that service. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		const study = await getSermonStudy(userId, id);
		if (!study) return NextResponse.json({ error: "Not found" }, { status: 404 });
		const { events, churchApp } = await listChurchEvents(userId, { studyId: study.id });
		return NextResponse.json({ study, events, churchApp });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[sermon-studies] detail failed", error);
		return NextResponse.json({ error: "Failed to load sermon study" }, { status: 500 });
	}
}
