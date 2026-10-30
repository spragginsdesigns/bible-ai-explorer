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
	"baptized-in-jordan": dynamic(() => import("./stages/BaptizedInJordan")),
	"fishers-of-men": dynamic(() => import("./stages/FishersOfMen")),
	"let-your-light-shine": dynamic(() => import("./stages/LetYourLightShine")),
	"in-secret": dynamic(() => import("./stages/InSecret")),
	"house-on-the-rock": dynamic(() => import("./stages/HouseOnTheRock")),
	"lord-save-us": dynamic(() => import("./stages/LordSaveUs")),
	"take-up-thy-bed": dynamic(() => import("./stages/TakeUpThyBed")),
	"sheep-among-wolves": dynamic(() => import("./stages/SheepAmongWolves")),
	"go-and-shew-john": dynamic(() => import("./stages/GoAndShewJohn")),
	"a-bruised-reed": dynamic(() => import("./stages/ABruisedReed")),
	"the-sower": dynamic(() => import("./stages/TheSower")),
	"crest-hopper": dynamic(() => import("./stages/CrestHopper")),
	"seven-baskets": dynamic(() => import("./stages/SevenBaskets")),
	"whom-say-ye": dynamic(() => import("./stages/WhomSayYe")),
	"hear-ye-him": dynamic(() => import("./stages/HearYeHim")),
	"the-lost-sheep": dynamic(() => import("./stages/TheLostSheep")),
	"eye-of-a-needle": dynamic(() => import("./stages/EyeOfANeedle")),
	"the-last-shall-be-first": dynamic(() => import("./stages/TheLastShallBeFirst")),
	"hosanna": dynamic(() => import("./stages/Hosanna")),
	"bid-to-the-marriage": dynamic(() => import("./stages/BidToTheMarriage")),
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
