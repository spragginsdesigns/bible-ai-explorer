import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "app/(app)/bible/cross.tsx"), "utf8");
const controls = readFileSync(
	resolve(process.cwd(), "src/features/cross/DirectionControls.tsx"),
	"utf8",
);
const api = readFileSync(resolve(process.cwd(), "src/features/notifications/api.ts"), "utf8");
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

	it("offers both steering controls with their exact labels", () => {
		// The rendered label, not the accessibility label or a comment: the words
		// on screen are the contract the other clients are held to.
		expect(controls).toContain("<Text style={styles.label}>Stay with this</Text>");
		expect(controls).toContain("<Text style={styles.label}>Take me somewhere fresh</Text>");
		expect(source).toContain("<DirectionControls themeKey={entry.themeKey}");
	});

	it("posts a direction through the one replacement handler", () => {
		expect(controls).toContain('onDirection("stay")');
		expect(controls).toContain('onDirection("fresh")');
		expect(replacement).toContain("replaceToday({ direction })");
		expect(replacement).toContain("options?.direction");
		expect(api).toContain('export type DailyCrossDirection = "stay" | "fresh"');
		expect(api).toContain("if (direction) body.direction = direction;");
		expect(api).toContain('"/api/verse-of-day/today"');
	});

	it("only offers to stay when the loaded day names a theme", () => {
		expect(controls).toContain("themeKey?: string | null");
		expect(controls).toContain('typeof themeKey === "string"');
		expect(controls).toContain("{canStay ?");
	});
});
