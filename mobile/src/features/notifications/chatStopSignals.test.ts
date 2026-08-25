import { describe, expect, it, vi } from "vitest";
import { markConversationStopped, wasConversationStopped } from "./chatStopSignals";

describe("chatStopSignals", () => {
	it("remembers a conversation the user walked away from", () => {
		markConversationStopped("conv_a");
		expect(wasConversationStopped("conv_a")).toBe(true);
	});

	it("says nothing about conversations that were never stopped", () => {
		expect(wasConversationStopped("conv_never")).toBe(false);
	});

	it("forgets a stop older than the memory window", () => {
		vi.useFakeTimers();
		try {
			markConversationStopped("conv_b");
			vi.advanceTimersByTime(3 * 60 * 1000 + 1);
			expect(wasConversationStopped("conv_b")).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});
});
