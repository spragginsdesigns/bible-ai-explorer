import { beforeEach, describe, expect, it, vi } from "vitest";

// apiJson pulls in expo-constants/expo-fetch; the tests only need its call shape.
vi.mock("@/lib/api", () => ({
	apiJson: vi.fn(),
}));

import { apiJson } from "@/lib/api";
import {
	FEEDBACK_REASON_MAX_LENGTH,
	nextFeedback,
	parseAnswerFeedback,
	setMessageFeedback,
} from "./answerFeedback";

const getToken = async () => "token";

beforeEach(() => vi.clearAllMocks());

describe("nextFeedback", () => {
	it("chooses the tapped thumb when nothing is chosen yet", () => {
		expect(nextFeedback(null, "up")).toBe("up");
		expect(nextFeedback(undefined, "down")).toBe("down");
	});

	it("clears when the chosen thumb is tapped again", () => {
		expect(nextFeedback("up", "up")).toBeNull();
		expect(nextFeedback("down", "down")).toBeNull();
	});

	it("switches straight across without a clearing tap", () => {
		expect(nextFeedback("up", "down")).toBe("down");
		expect(nextFeedback("down", "up")).toBe("up");
	});
});

describe("parseAnswerFeedback", () => {
	it("keeps the two real values", () => {
		expect(parseAnswerFeedback("up")).toBe("up");
		expect(parseAnswerFeedback("down")).toBe("down");
	});

	it("rejects everything else", () => {
		for (const value of [null, undefined, "", "UP", "helpful", 1, {}, []]) {
			expect(parseAnswerFeedback(value)).toBeNull();
		}
	});
});

describe("setMessageFeedback", () => {
	it("PATCHes the message with the thumb", async () => {
		await setMessageFeedback(getToken, "c1", "m1", "up");
		expect(apiJson).toHaveBeenCalledWith(getToken, "/api/conversations/c1/messages/m1", {
			method: "PATCH",
			body: { feedback: "up" },
		});
	});

	it("clears with an explicit null", async () => {
		await setMessageFeedback(getToken, "c1", "m1", null);
		expect(apiJson).toHaveBeenCalledWith(getToken, "/api/conversations/c1/messages/m1", {
			method: "PATCH",
			body: { feedback: null },
		});
	});

	it("carries a trimmed reason alongside a thumbs down", async () => {
		await setMessageFeedback(getToken, "c1", "m1", "down", "  It misquoted Romans 8  ");
		expect(apiJson).toHaveBeenCalledWith(getToken, "/api/conversations/c1/messages/m1", {
			method: "PATCH",
			body: { feedback: "down", feedbackReason: "It misquoted Romans 8" },
		});
	});

	it("drops a blank reason and a reason that is not about a thumbs down", async () => {
		await setMessageFeedback(getToken, "c1", "m1", "down", "   ");
		await setMessageFeedback(getToken, "c1", "m2", "up", "praise");
		await setMessageFeedback(getToken, "c1", "m3", null, "praise");
		expect(apiJson).toHaveBeenNthCalledWith(1, getToken, "/api/conversations/c1/messages/m1", {
			method: "PATCH",
			body: { feedback: "down" },
		});
		expect(apiJson).toHaveBeenNthCalledWith(2, getToken, "/api/conversations/c1/messages/m2", {
			method: "PATCH",
			body: { feedback: "up" },
		});
		expect(apiJson).toHaveBeenNthCalledWith(3, getToken, "/api/conversations/c1/messages/m3", {
			method: "PATCH",
			body: { feedback: null },
		});
	});

	it("never sends a reason longer than the server accepts", async () => {
		await setMessageFeedback(getToken, "c1", "m1", "down", "x".repeat(600));
		const call = vi.mocked(apiJson).mock.calls[0][2] as {
			body: { feedbackReason: string };
		};
		expect(call.body.feedbackReason).toHaveLength(FEEDBACK_REASON_MAX_LENGTH);
	});
});
