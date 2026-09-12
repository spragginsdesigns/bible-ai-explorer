import { withReadingDeadline } from "./readingDeadline";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { AppState } from "react-native";
import { useEffect, useSyncExternalStore } from "react";
import { useAuth } from "@clerk/expo";
import { apiJson, subscribeApiAvailability, type GetToken } from "@/lib/api";
import {
	ReadingJournal,
	retryDelay,
	type JournalStatus,
} from "./readingLogCore";
let account: string | null = null;
let journal: ReadingJournal | null = null;
let token: GetToken | null = null;
let foreground = AppState.currentState === "active";
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let attempts = 0;
const listeners = new Set<() => void>();
let snapshot: JournalStatus = { pending: 0, blocked: 0, error: null };
function emit() {
	snapshot = journal?.status() ?? { pending: 0, blocked: 0, error: null };
	for (const f of listeners) f();
}
function cancel() {
	if (timer) clearTimeout(timer);
	timer = null;
}
function schedule(delay = 15_000) {
	if (timer || !foreground || !journal || attempts >= 6) return;
	timer = setTimeout(() => {
		timer = null;
		void flush();
	}, delay);
}
async function flush() {
	if (flushing || !foreground || !journal || !token) return;
	const owner = account;
	const target = journal;
	const getToken = token;
	flushing = true;
	const active = () => foreground && account === owner && journal === target;
	try {
		await target.flush(
			(entry) =>
				withReadingDeadline(async (live) => {
					// apiJson bounds fetch headers; this guard also bounds Clerk and body
					// parsing, and forbids a late token from launching an expired send.
					const guardedToken: GetToken = async (options) => {
						if (!live() || !active()) throw new Error("Reading send expired");
						const value = await getToken(options);
						if (!live() || !active()) throw new Error("Reading send expired");
						return value;
					};
					await apiJson(
						guardedToken,
						"/api/reading-log",
						{ method: "POST", body: { ...entry, evidence: "active_view" } },
						{ timeoutMs: 15_000 },
					);
				}),
			active,
		);
		if (active()) {
			attempts = 0;
			emit();
			if (snapshot.pending > snapshot.blocked) schedule();
		}
	} catch {
		if (active()) {
			attempts++;
			schedule(retryDelay(attempts - 1, Math.random()));
		}
	} finally {
		flushing = false;
		if (journal !== target) schedule();
	}
}
export function retryReadingSync() {
	attempts = 0;
	cancel();
	schedule(0);
}
export function retryBlockedReadings() {
	void journal
		?.retryBlocked()
		.then(retryReadingSync)
		.catch(() => {
			snapshot = {
				...snapshot,
				error:
					"Reading could not be saved on this device. Free some storage and try again.",
			};
			for (const f of listeners) f();
		});
}
export function touchReadingSession(owner: string) {
	if (owner === account) void journal?.touch(Date.now()).catch(() => {});
}
export function useReadingLogStatus() {
	return useSyncExternalStore(
		(f) => {
			listeners.add(f);
			return () => listeners.delete(f);
		},
		() => snapshot,
		() => snapshot,
	);
}
export async function recordVisibleReading(
	owner: string,
	input: Parameters<ReadingJournal["record"]>[0],
) {
	if (owner !== account || !journal) return;
	await journal.record(input);
	schedule();
}
/** Installed once at signed-in app root; no background work, repeating timers or wake locks. */
export function useReadingLogSync() {
	const { userId, getToken } = useAuth();
	useEffect(() => {
		cancel();
		account = userId ?? null;
		attempts = 0;
		// Capture this account's token getter. Check before AND after Clerk awaits so
		// a queued reading cannot be submitted under the next signed-in user.
		token = async (opts) => {
			if (account !== userId) throw new Error("Account changed");
			const value = await getToken(
				opts?.fresh ? { skipCache: true } : undefined,
			);
			if (account !== userId || !value)
				throw new Error("Reading account unavailable");
			return value;
		};
		journal = userId
			? new ReadingJournal(
					AsyncStorage,
					userId,
					() => Crypto.randomUUID(),
					emit,
				)
			: null;
		emit();
		const target = journal;
		void target
			?.initialize()
			.then(() => {
				if (journal === target) schedule(0);
			})
			.catch(() => {
				if (journal !== target) return;
				snapshot = {
					pending: 0,
					blocked: 0,
					error: "Reading history could not be opened on this device.",
				};
				for (const f of listeners) f();
			});
		return () => {
			cancel();
			account = null;
			journal = null;
			token = null;
			emit();
		};
	}, [userId]);
	useEffect(() => {
		const change = AppState.addEventListener("change", (state) => {
			foreground = state === "active";
			if (foreground) retryReadingSync();
			else cancel();
		});
		const focus = AppState.addEventListener("focus", () => {
			if (foreground && attempts > 0) retryReadingSync();
		});
		const unsubscribe = subscribeApiAvailability(() => {
			if (foreground && attempts > 0 && snapshot.pending > snapshot.blocked)
				retryReadingSync();
		});
		return () => {
			change.remove();
			focus.remove();
			unsubscribe();
		};
	}, []);
}
