import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
	userId: "reader", userLoaded: true, clerk: { user: { id: "reader" } },
	token: async () => "token",
	cursor: 0,
	slots: [] as Array<{ value?: unknown; current?: unknown; deps?: unknown[]; cleanup?: (() => void) | void }>,
	effects: [] as Array<() => void>,
	api: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
	...await importOriginal<typeof import("react")>(),
	useRef: (initial: unknown) => {
		const index = harness.cursor++;
		return harness.slots[index] ?? (harness.slots[index] = { current: initial });
	},
	useState: (initial: unknown) => {
		const index = harness.cursor++;
		const slot = harness.slots[index] ?? (harness.slots[index] = { value: initial });
		return [slot.value, (value: unknown) => { slot.value = value; }];
	},
	useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
		const index = harness.cursor++;
		const old = harness.slots[index];
		if (old?.deps?.every((value, i) => value === deps[i])) return;
		const slot = { deps, cleanup: old?.cleanup };
		harness.slots[index] = slot;
		harness.effects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
	},
	useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
}));
vi.mock("react-native", () => ({ ActivityIndicator: "ActivityIndicator", Alert: {}, AppState: { addEventListener: () => ({ remove() {} }) }, Linking: {}, Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", View: "View" }));
vi.mock("@clerk/expo", () => ({
	useAuth: () => ({ userId: harness.userId, isLoaded: true, isSignedIn: true }),
	useClerk: () => harness.clerk,
	useUser: () => ({ user: harness.clerk.user, isLoaded: harness.userLoaded }),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { setItem: vi.fn(), getItem: vi.fn() } }));
vi.mock("@/components/AppText", () => ({ AppText: "Text" }));
vi.mock("@/lib/api", () => ({ apiJson: (...args: unknown[]) => harness.api(...args) }));
vi.mock("@/features/notes/useStableGetToken", () => ({ useStableGetToken: () => harness.token }));
vi.mock("./settingsStore", () => ({ useTheme: () => ({ colors: { bg: "black", accent: "gold", textMuted: "gray" } }) }));

import { AIConsentPresenter } from "./AIConsentPresenter";
import { aiConsentGate } from "@/lib/aiConsentGate";

const child = "authenticated-route";
const render = () => { harness.cursor = 0; return AIConsentPresenter({ children: child }).props.children[0]; };
const flushEffects = () => { for (const effect of harness.effects.splice(0)) effect(); };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const agreed = { aiConsent: { version: 2, acceptedAt: "2026-10-19T00:00:00Z" }, aiConsentDeclined: false };

beforeEach(() => {
	aiConsentGate.configure(null);
	harness.slots = []; harness.effects = []; harness.cursor = 0;
	harness.userId = "reader"; harness.userLoaded = true; harness.clerk = { user: { id: "reader" } };
	harness.api.mockReset();
});

describe("authenticated route startup", () => {
	it("mounts a cold route only after its transport exists, then waits for the real saved agreement", async () => {
		let complete!: (doc: typeof agreed) => void;
		const loaded = new Promise<typeof agreed>((resolve) => { complete = resolve; });
		harness.api.mockReturnValue(loaded);
		expect(render()).not.toBe(child);
		expect(aiConsentGate.isCurrentAccount()).toBe(false);
		flushEffects();
		expect(render()).toBe(child);
		expect(aiConsentGate.isCurrentAccount()).toBe(true);
		let settled = false;
		const request = aiConsentGate.ensure().then((allowed) => { settled = true; return allowed; });
		await tick();
		expect(settled).toBe(false);
		complete(agreed);
		expect(await request).toBe(true);
	});

	it("keeps a recorded refusal blocked after the route is ready", async () => {
		harness.api.mockResolvedValue({ aiConsent: null, aiConsentDeclined: true });
		render(); flushEffects(); await tick();
		expect(render()).toBe(child);
		expect(await aiConsentGate.ensure()).toBe(false);
		expect(aiConsentGate.getSnapshot().prompt).toBe(false);
	});

	it("does not recreate the gate or remount routes for token getter identity changes", async () => {
		harness.api.mockResolvedValue(agreed);
		render(); flushEffects(); await tick();
		const session = aiConsentGate.sessionId;
		harness.token = async () => "refreshed-token";
		expect(render()).toBe(child); flushEffects();
		expect(aiConsentGate.sessionId).toBe(session);
	});

	it("does not mount a route while the SDK user has not finished loading", () => {
		harness.userLoaded = false;
		expect(render()).not.toBe(child); flushEffects();
		expect(aiConsentGate.isCurrentAccount()).toBe(false);
	});

	it("removes the previous account's route immediately during an identity handover", async () => {
		harness.api.mockResolvedValue(agreed);
		render(); flushEffects(); await tick();
		expect(render()).toBe(child);
		harness.userId = "another-reader";
		expect(render()).not.toBe(child); flushEffects();
		expect(aiConsentGate.isCurrentAccount()).toBe(false);
		harness.clerk = { user: { id: "another-reader" } };
		harness.api.mockResolvedValue({ aiConsent: null, aiConsentDeclined: true });
		expect(render()).not.toBe(child); flushEffects(); await tick();
		expect(render()).toBe(child);
		expect(await aiConsentGate.ensure()).toBe(false);
	});
});
