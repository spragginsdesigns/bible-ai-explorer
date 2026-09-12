import { describe, expect, it, vi } from "vitest";
import { LearnTokenBridge } from "./learnTokenBridge";

describe("LearnTokenBridge", () => {
	it("keeps one transport identity while using Clerk's latest token getter", async () => {
		const first = vi.fn(async () => "first-token");
		const second = vi.fn(async () => "second-token");
		const bridge = new LearnTokenBridge(first);
		const stableTransport = bridge.getToken;

		await expect(stableTransport()).resolves.toBe("first-token");
		bridge.update(second);

		expect(bridge.getToken).toBe(stableTransport);
		await expect(stableTransport({ fresh: true })).resolves.toBe("second-token");
		expect(second).toHaveBeenCalledWith({ skipCache: true });
	});
});
