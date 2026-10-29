import "server-only";

import type { BetaItem } from "@prisma/client";
import { createBetaItem, listBetaItems, updateBetaItem } from "@/lib/beta/store";
import { betaRefKey } from "@/lib/beta/store-rules";
import {
	CHAPTER_GAMES,
	mergeGameAward,
	readGameAward,
	type ChapterGame,
	type GameAward,
	type GameRun,
} from "@/lib/beta/games/games-rules";
import { CARAVAN_MIN_SECONDS } from "@/lib/beta/games/the-caravan-rules";
import { CHART_MIN_SECONDS } from "@/lib/beta/games/star-chart-rules";
import { HOPPER_MIN_SECONDS } from "@/lib/beta/games/crest-hopper-rules";
import { STAR_MIN_SECONDS } from "@/lib/beta/games/follow-the-star-rules";
import { STORM_MIN_SECONDS } from "@/lib/beta/games/through-the-storm-rules";
import { WALK_MIN_SECONDS } from "@/lib/beta/games/water-walk-rules";

/**
 * Chapter Games' awards (LC-17850, docs/beta/games.md), one study-store item
 * per founder per game (module `games`, kind `award`), so the Knowledge Vault
 * finds them by passage like every other beta study.
 */

const MODULE = "games";
const KIND = "award";

/** The soonest each game can be finished; a faster reported time was not played. */
export const GAME_MIN_SECONDS: Record<string, number> = {
	"water-walk": WALK_MIN_SECONDS,
	"through-the-storm": STORM_MIN_SECONDS,
	"crest-hopper": HOPPER_MIN_SECONDS,
	"follow-the-star": STAR_MIN_SECONDS,
	"the-caravan": CARAVAN_MIN_SECONDS,
	"star-chart": CHART_MIN_SECONDS,
};

function awardItems(userId: string): Promise<BetaItem[]> {
	return listBetaItems(userId, { module: MODULE, kind: KIND, take: 100 });
}

/** The founder's award for each game they have finished, by game slug. */
export async function listGameAwards(userId: string): Promise<Record<string, GameAward>> {
	const out: Record<string, GameAward> = {};
	for (const item of await awardItems(userId)) {
		for (const game of CHAPTER_GAMES) {
			const award = readGameAward(item.data, game.slug);
			if (award && (!out[game.slug] || award.completions > out[game.slug].completions)) out[game.slug] = award;
		}
	}
	return out;
}

function awardText(game: ChapterGame, award: GameAward) {
	const grade = game.grades[award.grade];
	const measure = game.measure.charAt(0).toUpperCase() + game.measure.slice(1);
	return {
		title: `${game.award}: ${game.title}`,
		body: `Finished ${game.title}, the chapter game for ${game.reference}. Best grade: ${grade} (${award.grade}). ${measure}: ${award.bestFaith}%. Best time: ${award.bestSeconds} seconds. Finished ${award.completions} ${award.completions === 1 ? "time" : "times"}.`,
		refs: [betaRefKey(game.book, game.chapter, game.verses[0]), betaRefKey(game.book, game.chapter, game.verses[1])],
		topics: [...game.topics],
	};
}

/**
 * Records a finished run and returns the award with it folded in. The update
 * is conditional on the item not having changed since it was read, so two
 * runs finished at once both count; a lost race reads again and retries.
 */
export async function recordGameRun(userId: string, game: ChapterGame, run: GameRun): Promise<GameAward> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const at = new Date().toISOString();
		const items = await awardItems(userId);
		const item = items
			.map((entry) => ({ entry, award: readGameAward(entry.data, game.slug) }))
			.filter((found) => found.award !== null)
			.sort((a, b) => (b.award?.completions ?? 0) - (a.award?.completions ?? 0))[0];
		const award = mergeGameAward(item?.award ?? null, game.slug, run, at);
		const text = awardText(game, award);
		if (!item) {
			await createBetaItem(userId, { module: MODULE, kind: KIND, ...text, data: { ...award } });
			return award;
		}
		const updated = await updateBetaItem(userId, item.entry.id, { ...text, data: { ...award } }, { ifUpdatedAt: item.entry.updatedAt });
		if (updated) return award;
	}
	throw new Error("the award changed while it was being saved");
}
