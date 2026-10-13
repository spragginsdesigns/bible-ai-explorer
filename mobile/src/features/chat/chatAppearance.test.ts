import { describe, expect, it } from "vitest";
import { sanctuaryDark, sanctuaryLight } from "./chatAppearance";

function luminance(hex: string) {
	const rgb = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255);
	const linear = rgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
	return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(a: string, b: string) {
	const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("chat text remains readable in both appearances", () => {
	for (const [name, c] of [["dark", sanctuaryDark], ["light", sanctuaryLight]] as const) {
		it(`${name} keeps questions, references, placeholders, and navigation at AA contrast`, () => {
			expect(contrast(c.text, c.surface)).toBeGreaterThanOrEqual(4.5);
			expect(contrast(c.accent, c.surface)).toBeGreaterThanOrEqual(4.5);
			expect(contrast(c.textGhost, c.surfaceStrong)).toBeGreaterThanOrEqual(4.5);
			expect(contrast(c.textMuted, c.bgElevated)).toBeGreaterThanOrEqual(4.5);
			expect(contrast(c.bg, c.accent)).toBeGreaterThanOrEqual(4.5);
			// Held Send keeps the opaque accent, with opacity applied to the whole control.
			expect(contrast(c.bg, c.accentDim)).toBeGreaterThanOrEqual(4.5);
		});
	}
});
