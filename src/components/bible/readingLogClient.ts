"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useAuth } from "@clerk/nextjs";
import { withReadingDeadline } from "../../../mobile/src/features/reading/readingDeadline";
import {
	ReadingJournal,
	retryDelay,
	type JournalStatus,
} from "../../../mobile/src/features/reading/readingLogCore";
let account: string | null = null;
let journal: ReadingJournal | null = null;
let accessToken: (() => Promise<string | null>) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let attempts = 0;
const listeners = new Set<() => void>();
const empty: JournalStatus = { pending: 0, blocked: 0, error: null };
let snapshot = empty;
function emit() {
	snapshot = journal?.status() ?? empty;
	listeners.forEach((f) => f());
}
function reportError(message: string) {
	snapshot = { ...snapshot, error: message };
	listeners.forEach((f) => f());
}
function foreground() {
	return (
		typeof document !== "undefined" && document.visibilityState === "visible"
	);
}
function cancel() {
	if (timer) clearTimeout(timer);
	timer = null;
}
function schedule(delay = 15_000) {
	if (timer || !journal || !foreground() || attempts >= 6) return;
	timer = setTimeout(() => {
		timer = null;
		void flush();
	}, delay);
}
async function flush() {
	if (flushing || !journal || !accessToken || !foreground()) return;
	const target = journal;
	const owner = account;
	const getToken = accessToken;
	const active = () => account === owner && target === journal && foreground();
	flushing = true;
	try {
		await target.flush(
			(entry) =>
				withReadingDeadline(async (live, signal) => {
					if (!live() || !active()) throw new Error("Reading send expired");
					const token = await getToken();
					if (!live() || !active() || !token)
						throw new Error("Reading account unavailable");
					// Bearer token pins ownership even if another tab changes the session cookie.
					const response = await fetch("/api/reading-log", {
						method: "POST",
						credentials: "omit",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${token}`,
						},
						body: JSON.stringify({ ...entry, evidence: "active_view" }),
						signal,
					});
					if (!response.ok)
						throw Object.assign(new Error("Reading could not be synced"), {
							status: response.status,
						});
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
		.catch(() =>
			reportError(
				"Reading could not be saved in this browser. Check available storage and try again.",
			),
		);
}
export function useReadingLogStatus() {
	return useSyncExternalStore(
		(f) => {
			listeners.add(f);
			return () => listeners.delete(f);
		},
		() => snapshot,
		() => empty,
	);
}
export async function recordBrowserReading(
	owner: string,
	input: Parameters<ReadingJournal["record"]>[0],
) {
	if (owner !== account || !journal) throw new Error("Reading account changed");
	await journal.record(input);
	schedule();
}
export function touchBrowserReading(owner: string) {
	if (owner === account) void journal?.touch(Date.now()).catch(() => {});
}
export default function ReadingLogSync() {
	const { userId, getToken } = useAuth();
	const auth = useRef({ userId, getToken });
	auth.current = { userId, getToken };
	useEffect(() => {
		cancel();
		account = userId ?? null;
		attempts = 0;
		if (!userId) {
			journal = null;
			accessToken = null;
			emit();
			return;
		}
		const owner = userId;
		accessToken = async () => {
			if (auth.current.userId !== owner) throw new Error("Account changed");
			const token = await auth.current.getToken();
			if (auth.current.userId !== owner) throw new Error("Account changed");
			return token;
		};
		journal = new ReadingJournal(
			{
				getItem: async (key) => localStorage.getItem(key),
				setItem: async (key, value) => localStorage.setItem(key, value),
				removeItem: async (key) => localStorage.removeItem(key),
				getAllKeys: async () => Object.keys(localStorage),
				exclusive: async (job) => {
					if (!navigator.locks)
						throw Object.assign(
							new Error(
								"This browser does not support safe reading sync. Update it to enable automatic reading logs.",
							),
							{ name: "ReadingStorageUnavailable" },
						);
					return navigator.locks.request(`sureword-reading:${owner}`, job);
				},
			},
			owner,
			() => crypto.randomUUID(),
			emit,
		);
		const target = journal;
		emit();
		void target
			.initialize()
			.then(() => {
				if (journal === target) schedule(0);
			})
			.catch((e) => {
				if (journal === target)
					reportError(
						e instanceof Error
							? e.message
							: "Reading history could not be opened in this browser.",
					);
			});
		return () => {
			cancel();
			account = null;
			journal = null;
			accessToken = null;
			emit();
		};
	}, [userId]);
	useEffect(() => {
		const changed = () => {
			if (foreground()) retryReadingSync();
			else cancel();
		};
		const online = () => retryReadingSync();
		const storage = (event: StorageEvent) => {
			if (event.key?.startsWith("sureword:reading:v1:") && foreground())
				schedule();
		};
		document.addEventListener("visibilitychange", changed);
		window.addEventListener("online", online);
		window.addEventListener("storage", storage);
		return () => {
			document.removeEventListener("visibilitychange", changed);
			window.removeEventListener("online", online);
			window.removeEventListener("storage", storage);
			cancel();
		};
	}, []);
	return null;
}
