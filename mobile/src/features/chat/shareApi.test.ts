import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Native modules are mocked: this exercises the share payload and the request
// shapes, not the device share sheet. The HTTP layer is the real `apiJson`,
// with global fetch stubbed, so a wrong path or verb fails here.
vi.mock("react-native", () => ({
	Share: { share: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("expo-constants", () => ({
	default: { expoConfig: { extra: { apiUrl: "https://api.test" } } },
}));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));

import { Share } from "react-native";
import type { GetToken } from "@/lib/api";
import {
	listShares,
	presentShareSheet,
	revokeShare,
	setShareListed,
	shareAnswer,
	SHARE_DIALOG_TITLE,
	shareSheetPayload,
} from "./shareApi";

const getToken: GetToken = async () => "tok";

const SHARE_URL = "https://sureword.app/shared/AbCdEfGhIjKlMnOp";

/** Minimal stand-in for the one Response shape `apiJson` reads. */
function jsonResponse(body: unknown): Response {
	return {
		ok: true,
		status: 200,
		json: async () => body,
	} as unknown as Response;
}

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("shareSheetPayload", () => {
	it("sends the link as the message so Android's chooser has something to pass on", () => {
		expect(shareSheetPayload(SHARE_URL)).toEqual({
			title: SHARE_DIALOG_TITLE,
			message: SHARE_URL,
			url: SHARE_URL,
		});
	});

	it("never puts the question in the chooser title", () => {
		expect(shareSheetPayload(SHARE_URL).title).toBe("An answer from SureWord");
	});

	it("carries the url separately for the sheets that render a link preview", () => {
		const payload = shareSheetPayload(SHARE_URL);
		expect(payload.url).toBe(payload.message);
	});
});

describe("presentShareSheet", () => {
	it("hands the payload straight to Share.share", async () => {
		await presentShareSheet(SHARE_URL);
		expect(Share.share).toHaveBeenCalledWith(shareSheetPayload(SHARE_URL));
	});
});

describe("request shapes", () => {
	it("mints with the conversation and message the server owner-checks", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ id: "AbCdEfGhIjKlMnOp", url: SHARE_URL, createdAt: "2026-09-15T00:00:00.000Z" })
		);

		const link = await shareAnswer(getToken, "conv_1", "msg_1");

		expect(link.url).toBe(SHARE_URL);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.test/api/shared");
		expect(init?.method).toBe("POST");
		expect(JSON.parse(String(init?.body))).toEqual({
			conversationId: "conv_1",
			messageId: "msg_1",
		});
	});

	it("lists with a plain GET", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ shares: [] }));

		await listShares(getToken);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.test/api/shared");
		expect(init?.method).toBe("GET");
		expect(init?.body).toBeUndefined();
	});

	it("revokes by share id, never by message id", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

		await revokeShare(getToken, "AbCdEfGhIjKlMnOp");

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.test/api/shared/AbCdEfGhIjKlMnOp");
		expect(init?.method).toBe("DELETE");
	});

	it("sets Show in search with a PATCH carrying only the listed flag", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ ok: true, listed: true }));

		const result = await setShareListed(getToken, "AbCdEfGhIjKlMnOp", true);

		expect(result).toEqual({ ok: true, listed: true });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.test/api/shared/AbCdEfGhIjKlMnOp");
		expect(init?.method).toBe("PATCH");
		expect(JSON.parse(String(init?.body))).toEqual({ listed: true });
	});

	it("sends listed false to take an answer back out of search", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ ok: true, listed: false }));

		await setShareListed(getToken, "AbCdEfGhIjKlMnOp", false);

		const [, init] = fetchMock.mock.calls[0];
		expect(JSON.parse(String(init?.body))).toEqual({ listed: false });
	});
});

describe("listShares listed parsing", () => {
	const base = {
		url: SHARE_URL,
		question: "q",
		createdAt: "2026-09-15T00:00:00.000Z",
		revokedAt: null,
	};

	it("keeps listed true only when the server says exactly true on a live link", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				shares: [
					{ ...base, id: "a", listed: true },
					{ ...base, id: "b", listed: false },
					{ ...base, id: "c" },
					{ ...base, id: "d", listed: "yes" },
					{ ...base, id: "e", listed: true, revokedAt: "2026-09-16T00:00:00.000Z" },
				],
			})
		);

		const { shares } = await listShares(getToken);

		expect(shares.map((s) => [s.id, s.listed])).toEqual([
			["a", true],
			["b", false],
			["c", false],
			["d", false],
			["e", false],
		]);
	});

	it("treats a missing shares array as empty", async () => {
		fetchMock.mockResolvedValue(jsonResponse({}));

		expect(await listShares(getToken)).toEqual({ shares: [] });
	});
});
