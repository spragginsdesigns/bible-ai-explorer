import { beforeEach, describe, expect, it, vi } from "vitest";

// apiJson pulls in expo-constants/expo-fetch; the tests only need its call shape.
vi.mock("@/lib/api", () => ({
	apiJson: vi.fn(),
}));

import { apiJson } from "@/lib/api";
import {
	FEEDBACK_REASON_MAX_LENGTH,
	FEEDBACK_TAGS,
	copyableAnswerText,
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

describe("FEEDBACK_TAGS", () => {
	it("mirrors the server's five chips, in order", () => {
		expect(FEEDBACK_TAGS.map((tag) => tag.id)).toEqual([
			"not-kjv",
			"doctrine",
			"missed-question",
			"wrong-verse",
			"too-long",
		]);
		expect(FEEDBACK_TAGS.map((tag) => tag.label)).toEqual([
			"Not KJV",
			"Doctrinally off",
			"Missed my question",
			"Wrong or missing verse",
			"Too long",
		]);
	});
});

describe("copyableAnswerText", () => {
	it("drops the follow-up marker lines and trims what is left", () => {
		const answer = [
			"Romans 8:1 speaks to this.",
			"",
			"[FOLLOWUP] What is condemnation?",
			"[FOLLOWUP] Who walks after the Spirit?",
			"",
		].join("\n");
		expect(copyableAnswerText(answer)).toBe("Romans 8:1 speaks to this.");
	});

	it("keeps the markdown and trims the leading blank lines a trim alone would miss", () => {
		expect(copyableAnswerText("\n\n## Heading\n\n- **one**\n- two\n\n")).toBe(
			"## Heading\n\n- **one**\n- two"
		);
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

	it("carries the chosen chips alongside a thumbs down", async () => {
		await setMessageFeedback(getToken, "c1", "m1", "down", "", ["too-long", "not-kjv"]);
		expect(apiJson).toHaveBeenCalledWith(getToken, "/api/conversations/c1/messages/m1", {
			method: "PATCH",
			body: { feedback: "down", feedbackTags: ["too-long", "not-kjv"] },
		});
	});

	it("omits an empty chip list, and chips that are not about a thumbs down", async () => {
		await setMessageFeedback(getToken, "c1", "m1", "down", undefined, []);
		await setMessageFeedback(getToken, "c1", "m2", "up", undefined, ["not-kjv"]);
		await setMessageFeedback(getToken, "c1", "m3", null, undefined, ["not-kjv"]);
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

	it("sends a reason and its chips together", async () => {
		await setMessageFeedback(getToken, "c1", "m1", "down", "  It quoted the NIV  ", [
			"not-kjv",
		]);
		expect(apiJson).toHaveBeenCalledWith(getToken, "/api/conversations/c1/messages/m1", {
			method: "PATCH",
			body: {
				feedback: "down",
				feedbackReason: "It quoted the NIV",
				feedbackTags: ["not-kjv"],
			},
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
