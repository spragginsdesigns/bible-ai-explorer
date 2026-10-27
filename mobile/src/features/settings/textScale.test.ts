import { describe, expect, it } from "vitest";
import { normalizeTextScale, stepTextScale, TEXT_SCALES, TEXT_SCALE_FACTORS, scaleTextDimensions } from "./textScale";

describe("bounded app text sizing", () => {
	it("normalizes corrupt persisted values without changing the existing three stops", () => {
		expect(TEXT_SCALES).toEqual(["standard", "large", "largest"]);
		for (const invalid of [null, undefined, "", "huge", 130, Infinity, NaN, {}, []]) {
			expect(normalizeTextScale(invalid)).toBe("standard");
		}
		for (const value of TEXT_SCALES) expect(normalizeTextScale(value)).toBe(value);
	});

	it("steps in both directions and cannot cross either endpoint", () => {
		expect(stepTextScale("standard", -1)).toBe("standard");
		expect(stepTextScale("standard", 1)).toBe("large");
		expect(stepTextScale("large", 1)).toBe("largest");
		expect(stepTextScale("largest", 1)).toBe("largest");
		expect(stepTextScale("largest", -1)).toBe("large");
		expect(stepTextScale("large", -1)).toBe("standard");
	});

	it("scales explicit dimensions once without scaling layout or adding nested sizes", () => {
		const parent = { fontSize: 20, lineHeight: 36, padding: 8 };
		expect(scaleTextDimensions(parent, TEXT_SCALE_FACTORS.largest)).toEqual({ fontSize: 26, lineHeight: expect.closeTo(46.8), padding: 8 });
		const inherited = { fontWeight: "700" };
		expect(scaleTextDimensions(inherited, 1.3)).toEqual(inherited);
		expect(scaleTextDimensions({ fontSize: 12 }, 1.3).fontSize).toBeCloseTo(15.6);
		expect(parent).toEqual({ fontSize: 20, lineHeight: 36, padding: 8 });
	});
});
