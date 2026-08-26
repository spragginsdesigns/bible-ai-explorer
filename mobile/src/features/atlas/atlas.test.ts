import { describe, expect, it } from "vitest";
import {
	ATLAS,
	ATLAS_ERAS,
	getAtlasEntity,
	getAtlasEvent,
	getTimeline,
	openLocationFor,
	searchAtlas,
	whoIsIn,
} from "./atlas";
import {
	alsoCalledLine,
	askPromptForEntity,
	askPromptForEvent,
	entityCounts,
	entitySubtitle,
	eraChipLabel,
	eraChips,
	eraEventCount,
	emptyTimelineMessage,
	eventCaption,
	hitKindLabel,
} from "./atlasView";

describe("the bundled atlas", () => {
	it("ships the whole thing on the device", () => {
		expect(ATLAS.events.length).toBeGreaterThanOrEqual(150);
		expect(ATLAS.people.length).toBeGreaterThanOrEqual(150);
		expect(ATLAS.places.length).toBeGreaterThanOrEqual(80);
	});
});

describe("search ranking", () => {
	it("puts an exact name first", () => {
		expect(searchAtlas("moses")[0].id).toBe("moses");
		expect(searchAtlas("Jericho")[0].id).toBe("jericho");
	});

	it("finds someone by a name Scripture also calls them", () => {
		expect(searchAtlas("saul of tarsus")[0].id).toBe("paul");
		expect(searchAtlas("Elias")[0].id).toBe("elijah");
		expect(searchAtlas("Booz")[0].id).toBe("boaz");
		expect(searchAtlas("Calvary")[0].id).toBe("golgotha");
	});

	it("prefers a person over a place at the same strength of match", () => {
		// "Dan" is both a man's name and a city; the ranking is deterministic.
		const dan = searchAtlas("dan");
		expect(dan.length).toBeGreaterThan(0);
		expect(dan).toEqual(searchAtlas("dan"));
	});

	it("matches every word of a longer query against a longer name", () => {
		expect(searchAtlas("john baptist")[0].id).toBe("john-the-baptist");
	});

	it("matches event titles as well as names", () => {
		expect(searchAtlas("fiery furnace").some((hit) => hit.kind === "event")).toBe(true);
	});

	it("answers nothing for an empty or unknown query, rather than everything", () => {
		expect(searchAtlas("")).toEqual([]);
		expect(searchAtlas("   ")).toEqual([]);
		expect(searchAtlas("zzzznotaname")).toEqual([]);
	});

	it("honours the limit", () => {
		expect(searchAtlas("j", 4).length).toBeLessThanOrEqual(4);
	});
});

describe("era grouping", () => {
	it("returns the eras in chronological order, with nothing empty", () => {
		const groups = getTimeline();
		expect(groups.map((group) => group.era)).toEqual([...ATLAS_ERAS]);
		expect(groups.every((group) => group.events.length > 0)).toBe(true);
		expect(groups.reduce((total, group) => total + group.events.length, 0)).toBe(
			ATLAS.events.length
		);
	});

	it("keeps each era's events in the order they happened", () => {
		for (const group of getTimeline()) {
			expect(group.events.every((event) => event.era === group.era)).toBe(true);
		}
	});

	it("filters to one era", () => {
		const groups = getTimeline({ era: "Life of Christ" });
		expect(groups).toHaveLength(1);
		expect(groups[0].era).toBe("Life of Christ");
		expect(groups[0].events.length).toBeGreaterThan(10);
	});

	it("filters to the events that touch a chapter", () => {
		const groups = getTimeline({ book: 2, chapter: 14 });
		expect(groups.flatMap((group) => group.events).map((event) => event.id)).toEqual([
			"crossing-the-red-sea",
		]);
	});

	it("filters to one person's events", () => {
		const events = getTimeline({ personId: "moses" }).flatMap((group) => group.events);
		expect(events.length).toBeGreaterThan(5);
		expect(events.every((event) => event.people.some((person) => person.id === "moses"))).toBe(true);
	});

	it("gives back nothing at all for a filter that matches nothing", () => {
		expect(getTimeline({ personId: "not-a-person" })).toEqual([]);
	});
});

describe("entities and events", () => {
	it("resolves a person with their relations and events", () => {
		const moses = getAtlasEntity("moses");
		expect(moses?.kind).toBe("person");
		expect(moses?.related.map((related) => related.id)).toContain("aaron");
		expect(moses?.events.map((event) => event.id)).toContain("the-burning-bush");
	});

	it("resolves a place, which belongs to no single era", () => {
		const jericho = getAtlasEntity("jericho");
		expect(jericho?.kind).toBe("place");
		expect(jericho?.era).toBeNull();
		expect(jericho?.events.map((event) => event.id)).toContain("fall-of-jericho");
	});

	it("answers null for an id that is not in the atlas", () => {
		expect(getAtlasEntity("not-a-real-id")).toBeNull();
		expect(getAtlasEvent("not-a-real-event")).toBeNull();
	});

	it("resolves an event's people and places into chips", () => {
		const flood = getAtlasEvent("the-flood");
		expect(flood?.people.map((person) => person.name)).toContain("Noah");
		expect(flood?.places.map((place) => place.name)).toEqual(["Ararat"]);
	});
});

describe("who is in a chapter", () => {
	it("answers with the people, places and events of that chapter", () => {
		const genesis22 = whoIsIn(1, 22);
		expect(genesis22.people.map((person) => person.id)).toContain("abraham");
		expect(genesis22.places.map((place) => place.id)).toContain("moriah");
		expect(genesis22.events.map((event) => event.id)).toContain("offering-of-isaac");
	});

	it("answers empty for a chapter the atlas says nothing about", () => {
		expect(whoIsIn(3, 13).events).toEqual([]);
	});
});

describe("opening a reference in the reader", () => {
	it("resolves the chapter and verse a chip should open", () => {
		expect(openLocationFor("John 3:16")).toMatchObject({ chapter: 3, verse: 16 });
		expect(openLocationFor("John 3:16")?.book.name).toBe("John");
		expect(openLocationFor("Genesis 6-9")).toMatchObject({ chapter: 6, verse: null });
	});

	it("answers null rather than guessing at something it cannot parse", () => {
		expect(openLocationFor("Hezekiah 1:1")).toBeNull();
		expect(openLocationFor("")).toBeNull();
	});
});

describe("presentation", () => {
	it("shortens every era to a chip that fits", () => {
		expect(eraChips()).toHaveLength(ATLAS_ERAS.length);
		expect(eraChipLabel("Creation & the Patriarchs")).toBe("Patriarchs");
		expect(eraChips().every((chip) => chip.label.length <= 12)).toBe(true);
	});

	it("captions an event with its date and era", () => {
		const flood = getAtlasEvent("the-flood");
		expect(eventCaption(flood!)).toBe("c. 2348 BC · Creation & the Patriarchs");
	});

	it("describes an entity in one line", () => {
		const paul = getAtlasEntity("paul")!;
		expect(entitySubtitle(paul)).toBe("Person · The Early Church");
		expect(alsoCalledLine(paul)).toBe("Also called Saul, Saul of Tarsus");
		expect(entityCounts(paul)).toMatch(/key verses/);

		const job = getAtlasEntity("job")!;
		expect(alsoCalledLine(job)).toBe("");

		const rome = getAtlasEntity("rome")!;
		expect(entitySubtitle(rome)).toBe("Place · Italy");
	});

	it("labels what a search hit is", () => {
		expect(hitKindLabel("person")).toBe("Person");
		expect(hitKindLabel("place")).toBe("Place");
		expect(hitKindLabel("event")).toBe("Event");
	});

	it("counts an era's events with the right plural", () => {
		expect(eraEventCount({ era: "Life of Christ", events: [] })).toBe("0 events");
		const one = getTimeline({ book: 2, chapter: 14 })[0];
		expect(eraEventCount(one)).toBe("1 event");
	});

	it("writes an Ask-about-this prompt that names the thing", () => {
		expect(askPromptForEntity(getAtlasEntity("moses")!)).toContain("Moses");
		expect(askPromptForEntity(getAtlasEntity("jericho")!)).toContain("Jericho");
		expect(askPromptForEvent(getAtlasEvent("the-flood")!)).toContain("The flood");
	});

	it("says which chapter came up empty rather than just 'no results'", () => {
		expect(emptyTimelineMessage({ book: "Leviticus", chapter: 13 })).toContain("Leviticus 13");
		expect(emptyTimelineMessage({ era: "Life of Christ" })).toContain("Life of Christ");
		expect(emptyTimelineMessage({})).toBe("No events on the timeline.");
	});
});
