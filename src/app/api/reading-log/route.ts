import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
	recordReading,
	searchReadingLog,
	getReadingLogStats,
	type ReadingLogFilters,
} from "@/lib/reading-log";

import { readingLogFailure } from "@/lib/reading-log-http";

export async function GET(request: Request) {
	try {
		const userId = await getAuthUser();
		const params = new URL(request.url).searchParams;
		const filters: ReadingLogFilters = {};
		for (const name of ["book", "chapter", "limit", "verseStart", "verseEnd"] as const)
			if (params.has(name)) filters[name] = Number(params.get(name));
		for (const name of ["from", "to", "fromDate", "toDate", "cursor"] as const)
			if (params.has(name)) filters[name] = params.get(name)!;
		if (params.has("source")) filters.source = params.get("source") as ReadingLogFilters["source"];
		const [history, stats] = await Promise.all([
			searchReadingLog(userId, filters),
			getReadingLogStats(userId),
		]);
		return NextResponse.json({ ...history, stats });
	} catch (error) {
		return readingLogFailure(error);
	}
}
export async function POST(request: Request) {
	try {
		const userId = await getAuthUser();
		return NextResponse.json(await recordReading(userId, await request.json().catch(() => null)));
	} catch (error) {
		return readingLogFailure(error);
	}
}
