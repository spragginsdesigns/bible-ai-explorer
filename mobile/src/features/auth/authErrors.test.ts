import { describe, expect, it } from "vitest";
import {
	clerkErrorCode,
	clerkErrorMessage,
	googleIncompleteMessage,
	previousAuthStep,
	singleFlight,
} from "./authErrors";

describe("clerkErrorCode", () => {
	it("reads the first Clerk error code", () => {
		const err = { errors: [{ code: "form_identifier_not_found", message: "Couldn't find your account." }] };
		expect(clerkErrorCode(err)).toBe("form_identifier_not_found");
	});

	it("classifies non-Clerk failures by kind instead of a bare unknown", () => {
		expect(clerkErrorCode(new Error("boom"))).toBe("exception_Error");
		expect(clerkErrorCode(new TypeError("undefined is not a function"))).toBe("exception_TypeError");
		expect(clerkErrorCode(new TypeError("Network request failed"))).toBe("network");
		const aborted = new Error("The operation was aborted");
		aborted.name = "AbortError";
		expect(clerkErrorCode(aborted)).toBe("aborted");
		// ClerkRuntimeError: a code, no errors array.
		expect(clerkErrorCode({ code: "network_error", message: "x" })).toBe("network_error");
	});

	it("never lets message text, emails or odd names through", () => {
		const leaky = new Error("someone@example.com could not sign in with hunter22");
		leaky.name = "someone@example.com";
		expect(clerkErrorCode(leaky)).toBe("unknown");
		expect(clerkErrorCode({ code: "user typed: hunter22" })).toBe("unknown");
		for (const err of [leaky, new Error("someone@example.com"), new TypeError("hunter22")]) {
			expect(clerkErrorCode(err)).not.toMatch(/@|hunter/);
		}
	});

	it("keeps unknown for junk", () => {
		expect(clerkErrorCode(null)).toBe("unknown");
		expect(clerkErrorCode("boom")).toBe("unknown");
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
		expect(msg).toContain("your email address");
	});

	it("still points at the email path when Clerk gives no field", () => {
		const msg = googleIncompleteMessage([]);
		expect(msg).toContain("couldn't finish setting up");
		expect(msg).toContain("your email address");
	});

	it("names no Back button, since the welcome step has none", () => {
		expect(googleIncompleteMessage([])).not.toMatch(/Back/);
	});
});

describe("previousAuthStep", () => {
	it("mirrors the card's own Back and Use a different email buttons", () => {
		expect(previousAuthStep("signInEmail")).toBe("welcome");
		expect(previousAuthStep("signUp")).toBe("welcome");
		expect(previousAuthStep("signInPassword")).toBe("signInEmail");
		expect(previousAuthStep("signInCode")).toBe("signInEmail");
		expect(previousAuthStep("signUpCode")).toBe("signUp");
	});

	it("lets Back leave the screen from the first step", () => {
		expect(previousAuthStep("welcome")).toBeNull();
	});
});

describe("singleFlight", () => {
	it("drops a second submit while the first is running", async () => {
		const run = singleFlight();
		let release!: () => void;
		let calls = 0;
		const task = () => {
			calls += 1;
			return new Promise<void>((resolve) => {
				release = resolve;
			});
		};
		const first = run(task);
		await run(task);
		await run(task);
		expect(calls).toBe(1);
		release();
		await first;
		expect(calls).toBe(1);
	});

	it("frees itself after success and after failure", async () => {
		const run = singleFlight();
		let calls = 0;
		await run(async () => {
			calls += 1;
		});
		await expect(
			run(async () => {
				calls += 1;
				throw new Error("network");
			})
		).rejects.toThrow("network");
		await run(async () => {
			calls += 1;
		});
		expect(calls).toBe(3);
	});
});
