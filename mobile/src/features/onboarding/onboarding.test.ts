import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isRenderableChatViewMessage, toViewMessage } from "@/lib/chatView";
import { hourForLabel, hourLabel } from "./dailyTime";
import { heardOnEnable, takeUnheard, type VoiceMessage } from "./voiceQueue";
import { hrefForTarget, isKnownTarget, SPOTLIGHT_NAVIGATION_OPTIONS, TOUR_READER_HREF } from "./spotlightRoutes";
import { APP_TARGET_KEYS, DAILY_TIME_HOURS, DAILY_TIME_OPTIONS, TOUR_STOPS } from "./onboardingRules";
import {
	TEXT_SCALE_FACTORS,
	normalizeTextScale,
	textScaleForLabel,
} from "@/features/settings/textScale";

vi.mock("ai", () => ({})); // type-only import in chatView

const assistant = (id: string, extra: Partial<VoiceMessage> = {}): VoiceMessage => ({ id, role: "assistant", ...extra });
const user = (id: string): VoiceMessage => ({ id, role: "user" });

describe("Read it to me queue", () => {
	it("turning voice on reads only the latest SureWord message", () => {
		const messages = [assistant("a1"), user("u1"), assistant("a2"), user("u2"), assistant("a3")];
		const heard = heardOnEnable(messages);
		expect([...heard]).toEqual(["a1", "a2"]);
		expect(takeUnheard(messages, heard)).toEqual([{ messageId: "a3" }]);
	});

	it("reads each message once, never while it streams, then its card's question", () => {
		const heard = new Set<string>();
		expect(takeUnheard([assistant("a1", { isStreaming: true })], heard)).toEqual([]);
		const settled = [assistant("a1", { step: "name" })];
		expect(takeUnheard(settled, heard)).toEqual([{ messageId: "a1" }, { step: "name" }]);
		expect(takeUnheard(settled, heard)).toEqual([]);
	});

	it("never reads the reader's own words or the free-text step", () => {
		const heard = new Set<string>();
		expect(takeUnheard([user("u1"), assistant("a1", { step: "other" })], heard)).toEqual([{ messageId: "a1" }]);
	});
});

describe("daily time chips", () => {
	it("maps every fixed chip to its hour and back", () => {
		for (const option of DAILY_TIME_OPTIONS) {
			if (option === "Pick a time") {
				expect(hourForLabel(option)).toBeNull();
				continue;
			}
			const hour = DAILY_TIME_HOURS[option];
			expect(hourForLabel(option)).toBe(hour);
			expect(hourLabel(hour)).toBe(option);
		}
	});

	it("round-trips the Pick a time hours and refuses anything else", () => {
		for (let hour = 0; hour < 24; hour += 1) expect(hourForLabel(hourLabel(hour))).toBe(hour);
		expect(hourForLabel("Not now")).toBeNull();
		expect(hourForLabel("13 pm")).toBeNull();
		expect(hourForLabel("constructor")).toBeNull();
	});
});

describe("text size", () => {
	it("reads the card's chips and never shrinks text", () => {
		expect(textScaleForLabel("Standard")).toBe("standard");
		expect(textScaleForLabel("Largest")).toBe("largest");
		expect(textScaleForLabel("Huge")).toBeNull();
		expect(normalizeTextScale("bogus")).toBe("standard");
		expect(Math.min(...Object.values(TEXT_SCALE_FACTORS))).toBe(1);
	});
});

describe("spotlight routes", () => {
	it("knows where every target SureWord can name lives", () => {
		for (const target of APP_TARGET_KEYS) expect(isKnownTarget(target)).toBe(true);
		expect(isKnownTarget("constructor")).toBe(false);
		expect(hrefForTarget("constructor")).toBeNull();
	});

	it("ends the tour on John 3:16 in the reader", () => {
		expect(TOUR_STOPS.at(-1)?.target).toBe("reader.verse");
		expect(hrefForTarget("reader.verse")).toEqual(TOUR_READER_HREF);
	});

	it("keeps each stack's home beneath what it opens, so Back never strands the reader", () => {
		// Without the anchor the Bible tab held John 3 alone after the tour.
		expect(SPOTLIGHT_NAVIGATION_OPTIONS).toEqual({ withAnchor: true });
		const overlay = readFileSync(path.resolve(__dirname, "Spotlight.tsx"), "utf8");
		expect(overlay).toContain("router.navigate(href as Href, SPOTLIGHT_NAVIGATION_OPTIONS)");
	});
});

describe("Walk with me cards in chat", () => {
	const message = (parts: unknown[]) => toViewMessage({ id: "a1", role: "assistant", parts } as never, { isStreaming: false });

	it("renders the last choice card and every Show me card", () => {
		const view = message([
			{ type: "text", text: "Welcome." },
			{ type: "tool-presentChoices", state: "output-available", output: { step: "name", question: "First?", options: ["A"] } },
			{
				type: "tool-presentChoices",
				state: "output-available",
				output: { step: "faith", question: "Where are you?", options: ["One", 2, "Two"], allowOther: true, skipLabel: "Later" },
			},
			{
				type: "tool-showInApp",
				state: "output-available",
				output: { target: "tab.bible", caption: "Here is the Bible.", stops: [{ target: "tab.today", caption: "Today." }, { bad: true }] },
			},
		]);
		expect(view.choiceCard).toEqual({
			step: "faith",
			question: "Where are you?",
			options: ["One", "Two"],
			allowOther: true,
			skipLabel: "Later",
			terms: [],
		});
		expect(view.showMe).toEqual([
			{ target: "tab.bible", caption: "Here is the Bible.", stops: [{ target: "tab.today", caption: "Today." }] },
		]);
	});

	it("keeps only the glossary words it knows", () => {
		const view = message([
			{
				type: "tool-presentChoices",
				state: "output-available",
				output: { step: "faith", question: "Have you been saved?", options: ["One"], terms: ["saved", "grace", 3] },
			},
		]);
		expect(view.choiceCard?.terms).toEqual(["saved"]);
	});

	it("a card alone still renders, and a malformed one is dropped", () => {
		const alone = message([
			{ type: "tool-presentChoices", state: "output-available", output: { step: "tour", question: "Look around?" } },
		]);
		expect(alone.choiceCard?.skipLabel).toBe("Skip for now");
		expect(isRenderableChatViewMessage(alone)).toBe(true);
		const broken = message([{ type: "tool-presentChoices", state: "output-available", output: { step: 3 } }]);
		expect(broken.choiceCard).toBeUndefined();
	});
});
