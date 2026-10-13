import { describe, expect, it } from "vitest";
import { guidePhase } from "./guideMotion";

describe("the companion follows answer delivery", () => {
	it("reaches upward before any answer text exists", () => {
		expect(guidePhase(true, "")).toBe("thinking");
		expect(guidePhase(true, " \n\t ")).toBe("thinking");
	});
	it("raises both arms once visible answer text arrives", () => {
		expect(guidePhase(true, "Genesis 1:1")).toBe("answering");
	});
	it("settles after completion, cancellation, or failure even with partial text", () => {
		expect(guidePhase(false, "Genesis 1:1")).toBe("idle");
		expect(guidePhase(false, "")).toBe("idle");
	});
});
