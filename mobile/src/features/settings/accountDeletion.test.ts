import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({
	default: { expoConfig: { extra: { apiUrl: "https://api.test" } } },
}));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));

import { ApiError, type GetToken } from "@/lib/api";
import {
	DELETE_CONFIRM_MESSAGE,
	FAILED_NETWORK,
	FAILED_NOTHING_REMOVED,
	FAILED_RETRYABLE,
	FAILED_SESSION,
	initialDeletionState,
	isConfirmationTyped,
	outcomeFromError,
	reduceDeletion,
	requestAccountDeletion,
	type DeletionState,
} from "./accountDeletion";

const failedWith = (state: DeletionState) =>
	state.phase.kind === "failed" ? state.phase.message : null;

describe("reduceDeletion", () => {
	it("200 is done", () => {
		expect(reduceDeletion(initialDeletionState, { kind: "ok" }).phase.kind).toBe("deleted");
	});

	it("500 says nothing was removed and does not arm the 401 rule", () => {
		const next = reduceDeletion(initialDeletionState, { kind: "status", status: 500 });
		expect(failedWith(next)).toBe(FAILED_NOTHING_REMOVED);
		expect(next.mayHaveDeleted).toBe(false);
	});

	it("any other status is treated as nothing removed", () => {
		expect(failedWith(reduceDeletion(initialDeletionState, { kind: "status", status: 400 }))).toBe(
			FAILED_NOTHING_REMOVED
		);
	});

	it("502 offers a retry, and a 401 on that retry counts as done", () => {
		const afterPartial = reduceDeletion(initialDeletionState, { kind: "status", status: 502 });
		expect(failedWith(afterPartial)).toBe(FAILED_RETRYABLE);
		expect(afterPartial.mayHaveDeleted).toBe(true);
		const afterRetry = reduceDeletion(afterPartial, { kind: "status", status: 401 });
		expect(afterRetry.phase.kind).toBe("deleted");
	});

	it("a 401 on the first attempt is an expired session, not a deletion", () => {
		expect(failedWith(reduceDeletion(initialDeletionState, { kind: "status", status: 401 }))).toBe(
			FAILED_SESSION
		);
	});

	it("offline shows the connection copy and arms the 401 rule", () => {
		const next = reduceDeletion(initialDeletionState, { kind: "offline" });
		expect(failedWith(next)).toBe(FAILED_NETWORK);
		expect(reduceDeletion(next, { kind: "status", status: 401 }).phase.kind).toBe("deleted");
	});

	it("a lost response is retryable and arms the 401 rule", () => {
		const next = reduceDeletion(initialDeletionState, { kind: "lost" });
		expect(failedWith(next)).toBe(FAILED_RETRYABLE);
		expect(next.mayHaveDeleted).toBe(true);
	});

	it("a 500 after a 502 keeps the 401 rule armed", () => {
		const partial = reduceDeletion(initialDeletionState, { kind: "status", status: 502 });
		const aborted = reduceDeletion(partial, { kind: "status", status: 500 });
		expect(aborted.mayHaveDeleted).toBe(true);
	});
});

describe("outcomeFromError", () => {
	it("maps ApiError statuses, offline and timeouts", () => {
		expect(outcomeFromError(new ApiError("x", { status: 502 }))).toEqual({ kind: "status", status: 502 });
		expect(outcomeFromError(new ApiError("x", { isNetworkError: true }))).toEqual({ kind: "offline" });
		expect(outcomeFromError(new ApiError("x", { isTimeout: true }))).toEqual({ kind: "offline" });
		expect(outcomeFromError(new SyntaxError("bad json"))).toEqual({ kind: "lost" });
	});
});

describe("isConfirmationTyped", () => {
	it("needs exactly DELETE, surrounding whitespace allowed", () => {
		expect(isConfirmationTyped("DELETE")).toBe(true);
		expect(isConfirmationTyped("  DELETE ")).toBe(true);
		expect(isConfirmationTyped("delete")).toBe(false);
		expect(isConfirmationTyped("")).toBe(false);
	});
});

describe("copy", () => {
	it("matches the Apple dialog word for word", () => {
		expect(DELETE_CONFIRM_MESSAGE).toBe(
			"This permanently deletes your conversations, notes, highlights, memories, testimony, voice messages and your account. This can't be undone."
		);
	});
});

describe("requestAccountDeletion", () => {
	const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
	const getToken: GetToken = async () => "tok";

	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("fetch", fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	it("sends DELETE /api/account with exactly the confirm body", async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response);
		await expect(requestAccountDeletion(getToken)).resolves.toEqual({ kind: "ok" });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.test/api/account");
		expect(init?.method).toBe("DELETE");
		expect(init?.body).toBe('{"confirm":"DELETE"}');
		const headers = init?.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer tok");
		expect(headers["x-sureword-client"]).toBe("android");
	});

	it("reduces a 502 to its status", async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) } as Response);
		await expect(requestAccountDeletion(getToken)).resolves.toEqual({ kind: "status", status: 502 });
	});
});
