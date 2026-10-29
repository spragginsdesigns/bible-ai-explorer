"use client";

import type { ComponentType } from "react";
import dynamic from "next/dynamic";
import MicroGame from "./MicroGame";
import type { ChapterGameProps, StageProps } from "./types";

/**
 * Each chapter game's stage by slug (LC-17851), loaded on its own when that
 * game is opened, inside the one player every game shares (MicroGame). The
 * map lives in a client component because next/dynamic splits code only there.
 */
const STAGES: Record<string, ComponentType<StageProps>> = {
	"the-generations": dynamic(() => import("./stages/TheGenerations")),
	"the-caravan": dynamic(() => import("./stages/TheCaravan")),
	"winnow": dynamic(() => import("./stages/Winnow")),
	"fishers-of-men": dynamic(() => import("./stages/FishersOfMen")),
	"let-your-light-shine": dynamic(() => import("./stages/LetYourLightShine")),
	"treasures-in-heaven": dynamic(() => import("./stages/TreasuresInHeaven")),
	"house-on-the-rock": dynamic(() => import("./stages/HouseOnTheRock")),
	"lord-save-us": dynamic(() => import("./stages/LordSaveUs")),
	"hem-of-his-garment": dynamic(() => import("./stages/HemOfHisGarment")),
	"sheep-among-wolves": dynamic(() => import("./stages/SheepAmongWolves")),
	"rest-for-your-souls": dynamic(() => import("./stages/RestForYourSouls")),
	"known-by-his-fruit": dynamic(() => import("./stages/KnownByHisFruit")),
	"the-sower": dynamic(() => import("./stages/TheSower")),
	"crest-hopper": dynamic(() => import("./stages/CrestHopper")),
	"seven-baskets": dynamic(() => import("./stages/SevenBaskets")),
	"whom-say-ye": dynamic(() => import("./stages/WhomSayYe")),
	"coin-in-the-fish": dynamic(() => import("./stages/CoinInTheFish")),
	"the-lost-sheep": dynamic(() => import("./stages/TheLostSheep")),
	"eye-of-a-needle": dynamic(() => import("./stages/EyeOfANeedle")),
	"have-mercy-on-us": dynamic(() => import("./stages/HaveMercyOnUs")),
	"hosanna": dynamic(() => import("./stages/Hosanna")),
	"the-wedding-garment": dynamic(() => import("./stages/TheWeddingGarment")),
	"under-her-wings": dynamic(() => import("./stages/UnderHerWings")),
	"watch": dynamic(() => import("./stages/Watch")),
	"sheep-and-goats": dynamic(() => import("./stages/SheepAndGoats")),
	"watch-with-me": dynamic(() => import("./stages/WatchWithMe")),
	"the-veil-rent": dynamic(() => import("./stages/TheVeilRent")),
	"he-is-risen": dynamic(() => import("./stages/HeIsRisen")),
};

export default function ChapterGamePlayer(props: ChapterGameProps) {
	const Stage = STAGES[props.game.slug];
	return Stage ? <MicroGame {...props} Stage={Stage} /> : null;
}
