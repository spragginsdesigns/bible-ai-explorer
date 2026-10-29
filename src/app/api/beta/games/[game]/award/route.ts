import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { GAME_MIN_SECONDS, recordGameRun } from "@/lib/beta/games/awards";
import { checkGameRun, findChapterGame } from "@/lib/beta/games/games-rules";

/**
 * POST /api/beta/games/<game>/award { faithKept, seconds, swellsCleared }
 * -> { award }: records a finished chapter game and returns the founder's
 * award with it folded in (docs/beta/games.md). An unknown game is the
 * ordinary 404.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ game: string }> };

function json(body: unknown, status = 200) {
	return NextResponse.json(body, { status, headers: BETA_PRIVATE_HEADERS });
}

export async function POST(request: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const game = findChapterGame((await params).game);
	if (!game) return betaNotFound();
	const run = checkGameRun(await request.json().catch(() => null), GAME_MIN_SECONDS[game.slug] ?? 0);
	if (!run.ok) return json({ error: run.error }, 400);
	try {
		return json({ award: await recordGameRun(gate.userId, game, run.value) });
	} catch (error) {
		console.error("[api/beta/games/award] failed", {
			name: error instanceof Error ? error.name : typeof error,
			stack: error instanceof Error ? error.stack?.split("\n").slice(1, 6).join("\n") : undefined,
		});
		return json({ error: "Your award could not be saved. Please try again." }, 500);
	}
}
