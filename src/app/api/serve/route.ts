import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { buildServeView, saveServeSettings, type ServeSettings } from "@/lib/serve";
import { isServeMode } from "@/lib/serve-rules";

/**
 * Ways to Serve (docs/FEATURES.md): the whole view every client renders, and
 * the reader's two choices. Free for every account; no AI call is made here.
 */

export async function GET() {
	try {
		const userId = await getAuthUser();
		return NextResponse.json({ status: "ok", serve: await buildServeView(userId) });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/serve] GET failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/** `{ mode?, givesToChurch? }`. One bad field writes nothing. */
export async function PATCH(req: Request) {
	try {
		const userId = await getAuthUser();
		const body: unknown = await req.json().catch(() => null);
		if (typeof body !== "object" || body === null) {
			return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
		}
		const { mode, givesToChurch } = body as { mode?: unknown; givesToChurch?: unknown };
		const patch: Partial<ServeSettings> = {};
		if (mode !== undefined) {
			if (!isServeMode(mode)) return NextResponse.json({ error: "mode must be off, nearby, online or both" }, { status: 400 });
			patch.mode = mode;
		}
		if (givesToChurch !== undefined) {
			if (typeof givesToChurch !== "boolean") return NextResponse.json({ error: "givesToChurch must be a boolean" }, { status: 400 });
			patch.givesToChurch = givesToChurch;
		}
		if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
		await saveServeSettings(userId, patch);
		return NextResponse.json({ status: "ok", serve: await buildServeView(userId) });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/serve] PATCH failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
