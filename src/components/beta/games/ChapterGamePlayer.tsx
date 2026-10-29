"use client";

import type { ComponentType } from "react";
import dynamic from "next/dynamic";
import type { ChapterGameProps } from "./types";

/**
 * Each game's component by slug (LC-17851: a passage can be played more than
 * one way). The map lives in a client component because next/dynamic splits
 * code only there: imported from the server page, every game shipped in every
 * game page's chunk.
 */
const GAMES: Record<string, ComponentType<ChapterGameProps>> = {
	"water-walk": dynamic(() => import("./PeterWaterWalk")),
	"through-the-storm": dynamic(() => import("./ThroughTheStorm")),
	"crest-hopper": dynamic(() => import("./CrestHopper")),
	"follow-the-star": dynamic(() => import("./FollowTheStar")),
	"the-caravan": dynamic(() => import("./TheCaravan")),
	"star-chart": dynamic(() => import("./StarChart")),
};

export default function ChapterGamePlayer(props: ChapterGameProps) {
	const Game = GAMES[props.game.slug];
	return Game ? <Game {...props} /> : null;
}
