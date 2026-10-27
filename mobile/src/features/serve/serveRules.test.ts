import { describe, expect, it } from "vitest";
import {
	NEARBY_FALLBACK_PROMPT,
	PRAY_PROMPT,
	SERVE_MODES,
	entryDateLabel,
	isSearchableLocation,
	parseServeView,
	stepFor,
	stepLabel,
	telUrl,
	todayCardWay,
	withSettings,
	type WayView,
} from "./serveRules";

const verse = { reference: "Hebrews 3:13", text: "But exhort one another daily" };

function way(overrides: Partial<WayView> = {}): WayView {
	return { id: "encourage", kind: "online", title: "Send someone a verse", detail: "d", action: "share-verse", verse, ...overrides };
}

/** The shape `GET /api/serve` answers with (src/lib/serve.ts `ServeView`). */
function serverView(overrides: Record<string, unknown> = {}) {
	return {
		title: "Ways to Serve",
		settings: { mode: "online", givesToChurch: false },
		intro: { text: "Serving never saves anyone.", verses: [{ reference: "Ephesians 2:8", text: "For by grace" }] },
		today: way(),
		ways: [way(), way({ id: "pray-for", action: "pray", title: "Pray for someone by name" })],
		church: { name: "First Missionary Baptist", website: "https://fmbc.example" },
		nearby: { available: false, searches: [{ id: "food", label: "Food banks and pantries" }] },
		journal: { title: "What I did", prompt: "A private place", verse: { reference: "Matthew 25:40", text: "Inasmuch" } },
		...overrides,
	};
}

const context = { nearbyAvailable: true, churchWebsite: "https://fmbc.example", canShareVerse: true };

describe("SERVE_MODES", () => {
	it("mirrors the server's mode list in order", () => {
		expect(SERVE_MODES).toEqual(["off", "nearby", "online", "both"]);
	});
});

describe("parseServeView", () => {
	it("reads the server view", () => {
		const view = parseServeView(serverView());
		expect(view?.settings).toEqual({ mode: "online", givesToChurch: false });
		expect(view?.today?.id).toBe("encourage");
		expect(view?.ways).toHaveLength(2);
		expect(view?.intro.verses[0].reference).toBe("Ephesians 2:8");
		expect(view?.church).toEqual({ name: "First Missionary Baptist", website: "https://fmbc.example" });
		expect(view?.nearby.searches).toEqual([{ id: "food", label: "Food banks and pantries" }]);
	});

	it("keeps a way whose action this build does not know, without a button", () => {
		const view = parseServeView(serverView({ ways: [way({ action: "something-new" as never })] }));
		expect(view?.ways[0].action).toBeNull();
		expect(view && stepFor(view.ways[0], context)).toBeNull();
	});

	it("rejects anything that is not a serve view", () => {
		expect(parseServeView(null)).toBeNull();
		expect(parseServeView({})).toBeNull();
		expect(parseServeView(serverView({ settings: { mode: "sometimes" } }))).toBeNull();
	});

	it("reads a null today and church", () => {
		const view = parseServeView(serverView({ today: null, church: null, settings: { mode: "off", givesToChurch: true } }));
		expect(view?.today).toBeNull();
		expect(view?.church).toBeNull();
		expect(view?.settings.givesToChurch).toBe(true);
	});
});

describe("todayCardWay", () => {
	it("hides the Today card when Ways to Serve is off or has no way today", () => {
		const view = parseServeView(serverView());
		expect(todayCardWay(view)?.id).toBe("encourage");
		expect(todayCardWay(view && withSettings(view, { mode: "off" }))).toBeNull();
		expect(todayCardWay(parseServeView(serverView({ today: null })))).toBeNull();
		expect(todayCardWay(null)).toBeNull();
	});
});

describe("stepFor", () => {
	it("opens the share-a-verse sheet for that way's verse", () => {
		expect(stepFor(way(), context)).toEqual({ kind: "share-verse", reference: "Hebrews 3:13" });
	});

	it("falls back to chat when the verse cannot be shared directly", () => {
		expect(stepFor(way(), { ...context, canShareVerse: false })).toEqual({
			kind: "chat",
			prompt: "Help me send someone Hebrews 3:13 with a word of encouragement",
		});
	});

	it("prefills chat to pray and to reach out", () => {
		expect(stepFor(way({ action: "pray" }), context)).toEqual({ kind: "chat", prompt: PRAY_PROMPT });
		expect(stepFor(way({ action: "reach-out", title: "Call someone who's alone" }), context)).toEqual({
			kind: "chat",
			prompt: "Help me write a kind message to call someone who's alone.",
		});
	});

	it("goes to the nearby search when it is available, otherwise asks in chat", () => {
		expect(stepFor(way({ action: "nearby" }), context)).toEqual({ kind: "nearby" });
		expect(stepFor(way({ action: "give-need" }), context)).toEqual({ kind: "nearby" });
		const off = { ...context, nearbyAvailable: false };
		expect(stepFor(way({ action: "nearby" }), off)).toEqual({ kind: "chat", prompt: NEARBY_FALLBACK_PROMPT });
		expect(stepFor(way({ action: "give-need" }), off)).toEqual({ kind: "chat", prompt: NEARBY_FALLBACK_PROMPT });
	});

	it("opens the church's website, or shows no button without one", () => {
		expect(stepFor(way({ action: "give-church" }), context)).toEqual({ kind: "url", url: "https://fmbc.example" });
		expect(stepFor(way({ action: "give-church" }), { ...context, churchWebsite: null })).toBeNull();
		expect(stepFor(way({ action: "give-church" }), { ...context, churchWebsite: "javascript:alert(1)" })).toBeNull();
	});

	it("maps church and journal, and gives no button without an action", () => {
		expect(stepFor(way({ action: "church" }), context)).toEqual({ kind: "church" });
		expect(stepFor(way({ action: "journal" }), context)).toEqual({ kind: "journal", reference: way().verse.reference || null });
		expect(stepFor(way({ action: null }), context)).toBeNull();
	});

	it("labels every step without counting anything", () => {
		const steps = [
			stepFor(way(), context),
			stepFor(way({ action: "pray" }), context),
			stepFor(way({ action: "nearby" }), context),
			stepFor(way({ action: "church" }), context),
			stepFor(way({ action: "give-church" }), context),
			stepFor(way({ action: "journal" }), context),
		];
		for (const step of steps) {
			expect(step).not.toBeNull();
			if (step) expect(stepLabel(step)).not.toMatch(/\d/);
		}
	});
});

describe("helpers", () => {
	it("bounds the location like the server", () => {
		expect(isSearchableLocation(" a ")).toBe(false);
		expect(isSearchableLocation("93720")).toBe(true);
		expect(isSearchableLocation("x".repeat(81))).toBe(false);
	});

	it("formats entry dates and phone links", () => {
		expect(entryDateLabel("2026-10-27T12:00:00")).toBe("Oct 27, 2026");
		expect(entryDateLabel("not a date")).toBe("");
		expect(telUrl("(559) 555-0100")).toBe("tel:5595550100");
	});
});
