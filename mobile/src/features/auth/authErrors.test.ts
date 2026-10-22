import { describe, expect, it } from "vitest";
import { clerkErrorCode, clerkErrorMessage, googleIncompleteMessage } from "./authErrors";

describe("clerkErrorCode", () => {
	it("reads the first Clerk error code", () => {
		const err = { errors: [{ code: "form_identifier_not_found", message: "Couldn't find your account." }] };
		expect(clerkErrorCode(err)).toBe("form_identifier_not_found");
	});

	it("falls back to unknown for plain errors and junk", () => {
		expect(clerkErrorCode(new Error("boom"))).toBe("unknown");
		expect(clerkErrorCode(null)).toBe("unknown");
		expect(clerkErrorCode({ errors: [] })).toBe("unknown");
	});
});

describe("clerkErrorMessage", () => {
	it("prefers the long message, then the short one", () => {
		expect(clerkErrorMessage({ errors: [{ longMessage: "Long", message: "Short" }] }, "x")).toBe("Long");
		expect(clerkErrorMessage({ errors: [{ message: "Short" }] }, "x")).toBe("Short");
	});

	it("uses the fallback when there is nothing to show", () => {
		expect(clerkErrorMessage({ errors: [{}] }, "Fallback")).toBe("Fallback");
		expect(clerkErrorMessage(new Error(""), "Fallback")).toBe("Fallback");
		expect(clerkErrorMessage(undefined, "Fallback")).toBe("Fallback");
	});
});

describe("googleIncompleteMessage", () => {
	it("names the missing fields in plain words", () => {
		const msg = googleIncompleteMessage(["first_name", "legal_accepted"]);
		expect(msg).toContain("first name, legal accepted");
		expect(msg).toContain("Create an account");
	});

	it("still points at the email path when Clerk gives no field", () => {
		const msg = googleIncompleteMessage([]);
		expect(msg).toContain("couldn't finish setting up");
		expect(msg).toContain("Create an account");
	});
});
