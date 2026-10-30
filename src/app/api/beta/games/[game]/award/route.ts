import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { GAME_MIN_SECONDS, listGameAwards, recordGameRun } from "@/lib/beta/games/awards";
import { checkGameRun, findChapterGame } from "@/lib/beta/games/games-rules";
import { hasQuizAttempt } from "@/lib/quiz";

/**
 * GET /api/beta/games/<game>/award -> { award, quizTaken }: the founder's
 * award for the game, or null before it is won, and whether they have
 * finished the chapter's quiz; the chapter-end card, the game's page and the
 * quiz results read it to offer what is left (LC-17851, LC-17905).
 *
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

export async function GET(_request: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const game = findChapterGame((await params).game);
	if (!game) return betaNotFound();
	try {
		const [awards, quizTaken] = await Promise.all([
			listGameAwards(gate.userId),
			// The quiz status only picks the gold button; a failed read must not cost the medal.
			hasQuizAttempt(gate.userId, game.book, game.chapter).catch((error: unknown) => {
				console.error("[api/beta/games/award] quiz read failed", { name: error instanceof Error ? error.name : typeof error });
				return false;
			}),
		]);
		return json({ award: awards[game.slug] ?? null, quizTaken });
	} catch (error) {
		console.error("[api/beta/games/award] read failed", { name: error instanceof Error ? error.name : typeof error });
		return json({ error: "Your award could not be read." }, 500);
	}
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
