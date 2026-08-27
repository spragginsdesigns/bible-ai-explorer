import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "app/(app)/cross.tsx"), "utf8");
const replacementStart = source.indexOf("const replaceToday");
const replacement = source.slice(
	replacementStart,
	source.indexOf("\n\tuseFocusEffect(", replacementStart),
);

describe("Daily Cross replacement UI contract", () => {
	it("keeps the existing day visible while the new one is prepared", () => {
		expect(replacement).toContain("setReplacing(true)");
		expect(replacement).not.toContain("setEntry(null)");
	});

	it("moves the completed replacement back to the verse", () => {
		expect(replacement).toContain("scrollRef.current?.scrollTo({ y: 0, animated: true })");
		expect(source).toContain("Preparing a fresh word. You can keep reading this one");
	});
});
