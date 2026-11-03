import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
	userId: "reader", sessionId: "session-one", userLoaded: true,
	user: { id: "reader" }, clerk: { user: { id: "reader" } as { id: string } | null },
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
	useAuth: () => ({ userId: harness.userId, sessionId: harness.sessionId, isLoaded: true, isSignedIn: true }),
	useClerk: () => harness.clerk,
	useUser: () => ({ user: harness.user, isLoaded: harness.userLoaded }),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { setItem: vi.fn(), getItem: vi.fn() } }));
vi.mock("@/components/AppText", () => ({ AppText: "Text" }));
vi.mock("@/lib/api", () => ({ apiJson: (...args: unknown[]) => harness.api(...args) }));
vi.mock("@/features/notes/useStableGetToken", () => ({ useStableGetToken: () => harness.token }));
vi.mock("./settingsStore", () => ({ useTheme: () => ({ colors: { bg: "black", accent: "gold", textMuted: "gray" } }) }));

import { AIConsentPresenter } from "./AIConsentPresenter";
import { aiConsentGate } from "@/lib/aiConsentGate";

const child = "authenticated-route";
const renderTree = () => { harness.cursor = 0; return AIConsentPresenter({ children: child }); };
const render = () => renderTree().props.children[0];
const flushEffects = () => { for (const effect of harness.effects.splice(0)) effect(); };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const agreed = { aiConsent: { version: 2, acceptedAt: "2026-10-19T00:00:00Z" }, aiConsentDeclined: false };
const presenter = () => {
	const slots: typeof harness.slots = [];
	return {
		render: () => { harness.slots = slots; return render(); },
		modal: () => { harness.slots = slots; return renderTree().props.children[1]; },
		unmount: () => { for (const slot of slots) slot.cleanup?.(); },
	};
};
const mount = async (instance: ReturnType<typeof presenter>) => {
	instance.render(); flushEffects(); await tick();
};

beforeEach(() => {
	aiConsentGate.configure(null);
	harness.slots = []; harness.effects = []; harness.cursor = 0;
	harness.userId = "reader"; harness.sessionId = "session-one"; harness.userLoaded = true;
	harness.user = { id: "reader" }; harness.clerk = { user: { id: "reader" } };
	harness.token = async () => "token";
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
		harness.user = { id: "another-reader" };
		harness.api.mockResolvedValue({ aiConsent: null, aiConsentDeclined: true });
		expect(render()).not.toBe(child); flushEffects(); await tick();
		expect(render()).toBe(child);
		expect(await aiConsentGate.ensure()).toBe(false);
	});

	it("does not let an older presenter's cleanup clear the newer live route", async () => {
		harness.api.mockResolvedValue(agreed);
		const older = presenter(); const newer = presenter();
		await mount(older); await mount(newer);
		expect(newer.render()).toBe(child);
		older.unmount(); await tick();
		expect(newer.render()).toBe(child);
		expect(await aiConsentGate.ensure()).toBe(true);
		newer.unmount();
		expect(aiConsentGate.isCurrentAccount()).toBe(false);
	});

	it("restores the older live route when the newer presenter unmounts", async () => {
		harness.api.mockResolvedValue(agreed);
		const older = presenter(); const newer = presenter();
		await mount(older); await mount(newer);
		expect(older.render()).not.toBe(child);
		newer.unmount(); await tick();
		expect(older.render()).toBe(child);
		expect(await aiConsentGate.ensure()).toBe(true);
		older.unmount();
		expect(aiConsentGate.isCurrentAccount()).toBe(false);
	});

	it("does not let an unloaded presenter clear another presenter's transport", async () => {
		harness.api.mockResolvedValue(agreed);
		const ready = presenter(); const loading = presenter();
		await mount(ready);
		harness.userLoaded = false;
		await mount(loading);
		harness.userLoaded = true;
		expect(ready.render()).toBe(child);
		loading.unmount(); ready.unmount();
	});

	it("uses coherent subscribed SDK identity while raw Clerk user is transiently absent", async () => {
		harness.clerk.user = null;
		harness.api.mockResolvedValue(agreed);
		await mount(presenter());
		expect(render()).toBe(child);
		expect(await aiConsentGate.ensure()).toBe(true);
	});

	it("invalidates a pending token when the same user gets a different session", async () => {
		harness.api.mockResolvedValue(agreed);
		const instance = presenter(); await mount(instance);
		const ownedToken = harness.api.mock.calls[0][0] as () => Promise<string>;
		let finish!: (token: string) => void;
		harness.token = () => new Promise<string>(resolve => { finish = resolve; });
		instance.render();
		const pending = ownedToken();
		harness.sessionId = "session-two";
		instance.render(); flushEffects();
		finish("old-session-token");
		await expect(pending).rejects.toThrow("Your account changed");
		instance.unmount();
	});

	it("rejects an old shell's token after another owner registers, before the old hook snapshot updates", async () => {
		harness.api.mockResolvedValue(agreed);
		const older = presenter(); await mount(older);
		const ownedToken = harness.api.mock.calls[0][0] as () => Promise<string>;
		let finish!: (token: string) => void;
		harness.token = () => new Promise<string>(resolve => { finish = resolve; });
		older.render(); const pending = ownedToken();
		harness.userId = "another-reader"; harness.user = { id: "another-reader" };
		harness.sessionId = "another-session"; harness.token = async () => "new-token";
		const newer = presenter(); await mount(newer);
		finish("old-token");
		await expect(pending).rejects.toThrow("Your account changed");
		expect(newer.render()).toBe(child);
		newer.unmount(); older.unmount();
		expect(aiConsentGate.isCurrentAccount()).toBe(false);
	});

	it("shows unanswered consent only in the presenter that owns the active registration", async () => {
		harness.api.mockResolvedValue({ aiConsent: null, aiConsentDeclined: false });
		const older = presenter(); const newer = presenter();
		await mount(older); await mount(newer);
		expect(aiConsentGate.getSnapshot().prompt).toBe(true);
		expect(older.modal().props.visible).toBe(false);
		expect(newer.modal().props.visible).toBe(true);
		harness.api.mockResolvedValue(agreed);
		await aiConsentGate.agree();
		expect(aiConsentGate.allowed).toBe(true);
		expect(newer.modal().props.visible).toBe(false);
		expect(older.modal().props.visible).toBe(false);
		newer.unmount(); older.unmount();
	});
});
