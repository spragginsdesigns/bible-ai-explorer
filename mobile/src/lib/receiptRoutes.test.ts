import { describe, expect, it } from "vitest";
import type { ChatReceiptTarget } from "@/lib/receipts";
import {
	receiptDestinationLabel,
	receiptNavigation,
	type ReceiptNavigation,
} from "@/lib/receiptRoutes";

/**
 * Every target shape in the receipts contract, so a route that stops existing
 * fails here rather than dead-ending on a tap. `screen` values are listed
 * explicitly and counted against the union below, so adding a target without a
 * route fails this suite.
 */
const CASES: { name: string; target: ChatReceiptTarget; expected: ReceiptNavigation }[] = [
	{
		name: "note opens the notes editor for that id",
		target: { screen: "note", noteId: "note_123" },
		expected: { href: { pathname: "/notes/[id]", params: { id: "note_123" } } },
	},
	{
		name: "memories with an id opens the list (no row param exists)",
		target: { screen: "memories", memoryId: "mem_1" },
		expected: { href: { pathname: "/(app)/memories" } },
	},
	{
		name: "memories without an id opens the list",
		target: { screen: "memories" },
		expected: { href: { pathname: "/(app)/memories" } },
	},
	{
		name: "chapter with verse and translation stringifies every param",
		target: { screen: "chapter", book: 43, chapter: 3, verse: 16, translation: "NKJV" },
		expected: {
			href: {
				pathname: "/bible/chapter",
				params: { book: "43", chapter: "3", verse: "16", translation: "NKJV" },
			},
		},
	},
	{
		name: "chapter without verse or translation omits both keys",
		target: { screen: "chapter", book: 1, chapter: 1 },
		expected: { href: { pathname: "/bible/chapter", params: { book: "1", chapter: "1" } } },
	},
	{
		name: "plan opens the reading plan",
		target: { screen: "plan" },
		expected: { href: { pathname: "/(app)/bible/plan" } },
	},
	{
		name: "readingHistory opens the reading history",
		target: { screen: "readingHistory" },
		expected: { href: { pathname: "/bible/history" } },
	},
	{
		name: "cross opens Pick Up Your Cross with the stack anchor",
		target: { screen: "cross" },
		expected: { href: { pathname: "/(app)/bible/cross" }, withAnchor: true },
	},
	{
		name: "learn opens Learn",
		target: { screen: "learn" },
		expected: { href: { pathname: "/(app)/bible/learn" } },
	},
	{
		name: "settings opens Settings",
		target: { screen: "settings" },
		expected: { href: { pathname: "/(app)/settings" } },
	},
	{
		name: "settings with a section still opens Settings (no section route exists)",
		target: { screen: "settings", section: "church" },
		expected: { href: { pathname: "/(app)/settings" } },
	},
];

describe("receiptNavigation", () => {
	for (const { name, target, expected } of CASES) {
		it(name, () => {
			// Strict so a stray `withAnchor: undefined` cannot pass as absent.
			expect(receiptNavigation(target)).toStrictEqual(expected);
		});
	}

	it("routes every screen in the contract", () => {
		const covered = new Set(CASES.map((testCase) => testCase.target.screen));
		expect([...covered].sort()).toStrictEqual([
			"chapter",
			"cross",
			"learn",
			"memories",
			"note",
			"plan",
			"readingHistory",
			"settings",
		]);
	});

	it("anchors only Cross, which is the one nested-stack destination", () => {
		const anchored = CASES.filter(({ expected }) => expected.withAnchor).map(
			({ target }) => target.screen,
		);
		expect(anchored).toStrictEqual(["cross"]);
	});
});

describe("receiptDestinationLabel", () => {
	it("gives every target a spoken destination ending in a period", () => {
		for (const { target } of CASES) {
			const label = receiptDestinationLabel(target);
			expect(label.startsWith("Opens ")).toBe(true);
			expect(label.endsWith(".")).toBe(true);
		}
	});

	it("names the destination, not the receipt", () => {
		expect(receiptDestinationLabel({ screen: "note", noteId: "n1" })).toBe("Opens the note.");
		expect(receiptDestinationLabel({ screen: "chapter", book: 43, chapter: 3 })).toBe(
			"Opens the chapter in the Bible reader.",
		);
	});
});
