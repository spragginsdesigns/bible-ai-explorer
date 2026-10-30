import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth } from "@clerk/expo";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { AppText as Text } from "@/components/AppText";
import { API_URL, makeAuthedFetch, boundedToken, type GetToken } from "@/lib/api";
import { checkedHistoryState, historyPath, matchesHistoryLocator, type HistoryLocator, type HistoryVerification, type SafeHistoryRow } from "@/lib/historyReview";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { useTheme } from "@/features/settings/settingsStore";

export function HistoryReviewCard({ review, locator, renderVerified }: {
	review: HistoryVerification;
	locator: HistoryLocator;
	renderVerified: (row: SafeHistoryRow) => React.ReactNode;
}) {
	const { userId, sessionId } = useAuth();
	const getToken = useStableGetToken();
	const { colors } = useTheme();
	const reviewVersion = useRef({ review, generation: 0 });
	if (reviewVersion.current.review !== review) reviewVersion.current = { review, generation: reviewVersion.current.generation + 1 };
	const key = JSON.stringify([userId, sessionId, locator.surface, locator.parentId, locator.messageId, review.sourceDigest, review.state, review.code, reviewVersion.current.generation]);
	const owner = useRef(key); owner.current = key;
	const mounted = useRef(true);
	const pending = useRef<symbol | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<{ key: string; message: string } | null>(null);
	const [checked, setChecked] = useState<{ key: string; state: "verified" | "notice"; row: SafeHistoryRow } | null>(null);
	const requests = useRef(new Set<AbortController>());
	useEffect(() => {
		mounted.current = true; owner.current = key;
		return () => { mounted.current = false; owner.current = "unmounted"; for (const request of requests.current) request.abort(); };
	}, []);
	useEffect(() => { for (const request of requests.current) request.abort(); pending.current = null; setBusy(null); }, [key]);
	const valid = !!userId && !!sessionId && matchesHistoryLocator(review, locator);
	const isCurrent = () => mounted.current && owner.current === key;
	const token: GetToken = async flags => {
		if (!valid || !isCurrent()) throw new Error("The reading account changed.");
		const value = await getToken(flags);
		if (!isCurrent()) throw new Error("The reading account changed.");
		return value;
	};
	const run = async (action: "check" | "download") => {
		if (!valid || pending.current) return;
		const claim = Symbol(action); pending.current = claim;
		const request = new AbortController(); requests.current.add(request);
		setBusy(action); setError(null);
		let file: File | null = null;
		try {
			if (action === "check") {
				const post = await makeAuthedFetch(token)(`${API_URL}/api/ai/history/recheck`, {
					method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...locator, expectedSourceDigest: review.sourceDigest }), signal: request.signal,
				});
				if (!post.ok) throw new Error(post.status === 429 ? "Please wait before checking this saved answer again." : "The saved answer could not be checked. Reload the conversation and try again.");
				if (!isCurrent()) return;
				const response = await makeAuthedFetch(token)(`${API_URL}${historyPath("state", locator)}`, { signal: request.signal });
				if (!response.ok) throw new Error("The saved answer could not be loaded.");
				const result = checkedHistoryState(await response.json(), review);
				if (isCurrent()) setChecked({ key, ...result });
			} else {
				if (!await Sharing.isAvailableAsync()) throw new Error("File sharing is unavailable on this device.");
				const credential = await boundedToken(token, false, "/api/ai/history/original");
				if (!credential) throw new Error("Sign in again to download this answer.");
				if (!isCurrent()) return;
				file = await File.downloadFileAsync(`${API_URL}${historyPath("original", locator)}`, new File(Paths.cache, `sureword-answer-original-${Date.now()}.json`), {
					headers: { Authorization: `Bearer ${credential}` }, signal: request.signal,
				});
				if (!isCurrent()) return;
				await Sharing.shareAsync(file.uri, { mimeType: "application/json", UTI: "public.json", dialogTitle: "Save original answer" });
			}
		} catch (failure) {
			if (isCurrent()) setError({ key, message: failure instanceof Error ? failure.message : "The saved answer could not be checked." });
		} finally {
			requests.current.delete(request);
			try { file?.delete(); } catch { /* The OS may already have removed its cache file. */ }
			if (pending.current === claim) { pending.current = null; if (isCurrent()) setBusy(null); }
		}
	};
	if (checked?.key === key && checked.state === "verified") return <>{renderVerified(checked.row)}</>;
	return (
		<View accessibilityLiveRegion="polite" style={{ padding: 14, gap: 10, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 12 }}>
			<Text>{checked?.key === key ? checked.row.content : "This saved answer needs a check before it can be shown."}</Text>
			{!valid ? <Text>Reload the conversation to check this saved answer.</Text> : <>
				<Pressable accessibilityRole="button" disabled={busy !== null} onPress={() => void run("check")}><Text>Check saved answer</Text></Pressable>
				<Pressable accessibilityRole="button" disabled={busy !== null} onPress={() => void run("download")}><Text>Download original as a file</Text></Pressable>
			</>}
			{busy ? <ActivityIndicator accessibilityLabel={busy === "check" ? "Checking saved answer" : "Preparing original file"} color={colors.accent} /> : null}
			{error?.key === key ? <Text>{error.message}</Text> : null}
		</View>
	);
}
