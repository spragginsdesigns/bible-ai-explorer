import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ data: new Map<string, string>() }));
vi.mock("@react-native-async-storage/async-storage", () => ({
	default: {
		getItem: async (k: string) => mocks.data.get(k) ?? null,
		setItem: async (k: string, v: string) => {
			mocks.data.set(k, v);
		},
		removeItem: async (k: string) => {
			mocks.data.delete(k);
		},
	},
}));

import { readPushTokenProof, savePushTokenProof } from "./pushTokenProof";

const TOKEN = "ExponentPushToken[device-1]";

describe("push token proof", () => {
	beforeEach(() => mocks.data.clear());

	it("has nothing to send before the server has issued a proof", async () => {
		expect(await readPushTokenProof(TOKEN)).toBeUndefined();
	});

	it("keeps the proof the server returned and sends it for the same token", async () => {
		expect(await savePushTokenProof(TOKEN, "proof-1")).toBe(true);
		expect(await readPushTokenProof(TOKEN)).toBe("proof-1");
	});

	it("reports an unchanged proof as nothing new, so it is not echoed twice", async () => {
		await savePushTokenProof(TOKEN, "proof-1");
		expect(await savePushTokenProof(TOKEN, "proof-1")).toBe(false);
	});

	it("replaces the proof when the server sends a different one", async () => {
		await savePushTokenProof(TOKEN, "proof-1");
		expect(await savePushTokenProof(TOKEN, "proof-2")).toBe(true);
		expect(await readPushTokenProof(TOKEN)).toBe("proof-2");
	});

	it("never offers a proof for a token it was not issued for", async () => {
		await savePushTokenProof(TOKEN, "proof-1");
		expect(await readPushTokenProof("ExponentPushToken[device-2]")).toBeUndefined();
		await savePushTokenProof("ExponentPushToken[device-2]", "proof-2");
		expect(await readPushTokenProof(TOKEN)).toBeUndefined();
	});

	it("ignores an absent or malformed proof from an older server", async () => {
		await savePushTokenProof(TOKEN, "proof-1");
		for (const proof of [undefined, null, "", 42, { proof: "x" }]) {
			expect(await savePushTokenProof(TOKEN, proof)).toBe(false);
		}
		expect(await readPushTokenProof(TOKEN)).toBe("proof-1");
	});

	it("treats corrupt storage as no proof rather than throwing", async () => {
		mocks.data.set("sureword.notifications.pushTokenProof", "{not json");
		expect(await readPushTokenProof(TOKEN)).toBeUndefined();
		mocks.data.set("sureword.notifications.pushTokenProof", JSON.stringify({ token: TOKEN }));
		expect(await readPushTokenProof(TOKEN)).toBeUndefined();
	});
});
