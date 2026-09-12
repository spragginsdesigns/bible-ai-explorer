import { NextResponse } from "next/server";
import { ReadingLogError } from "@/lib/reading-log";

export function readingLogFailure(error: unknown) {
	if (error instanceof Response) return error;
	if (error instanceof ReadingLogError)
		return NextResponse.json({ error: error.message }, { status: error.status });
	console.error("[api/reading-log] request failed", error);
	return NextResponse.json(
		{ error: "Reading history could not be saved or loaded. Please retry." },
		{ status: 500 },
	);
}
