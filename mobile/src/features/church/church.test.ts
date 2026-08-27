import { describe, expect, it } from "vitest";
import {
	hostnameOf,
	isLatestRequest,
	MIN_CHURCH_QUERY_LENGTH,
	MISSION_CLAMP_LINES,
	needsMissionToggle,
	shouldSearch,
} from "./church";

describe("shouldSearch", () => {
	it("rejects anything the server would 400", () => {
		expect(shouldSearch("")).toBe(false);
		expect(shouldSearch("a")).toBe(false);
		expect(shouldSearch("ab")).toBe(false);
		// Whitespace is not length: "  a  " is a one-character query.
		expect(shouldSearch("  a  ")).toBe(false);
	});

	it("accepts the minimum the server allows", () => {
		expect(MIN_CHURCH_QUERY_LENGTH).toBe(3);
		expect(shouldSearch("abc")).toBe(true);
		expect(shouldSearch("  grace chapel ")).toBe(true);
	});
});

describe("hostnameOf", () => {
	it("strips scheme, www, port and path", () => {
		expect(hostnameOf("https://www.gracechapel.org/about")).toBe("gracechapel.org");
		expect(hostnameOf("http://gracechapel.org")).toBe("gracechapel.org");
		expect(hostnameOf("https://WWW.Grace.org:8443/a?b=c#d")).toBe("Grace.org");
		expect(hostnameOf("https://user:pass@grace.org/x")).toBe("grace.org");
	});

	it("returns null for anything it cannot read", () => {
		expect(hostnameOf(null)).toBeNull();
		expect(hostnameOf(undefined)).toBeNull();
		expect(hostnameOf("")).toBeNull();
		expect(hostnameOf("gracechapel.org")).toBeNull();
		expect(hostnameOf("https:///path")).toBeNull();
	});
});

describe("needsMissionToggle", () => {
	it("offers the toggle only once the clamp is reached", () => {
		expect(MISSION_CLAMP_LINES).toBe(6);
		expect(needsMissionToggle(0)).toBe(false);
		expect(needsMissionToggle(MISSION_CLAMP_LINES - 1)).toBe(false);
		expect(needsMissionToggle(MISSION_CLAMP_LINES)).toBe(true);
	});
});

describe("isLatestRequest", () => {
	it("drops responses from superseded keystrokes", () => {
		expect(isLatestRequest(4, 4)).toBe(true);
		expect(isLatestRequest(3, 4)).toBe(false);
	});
});
