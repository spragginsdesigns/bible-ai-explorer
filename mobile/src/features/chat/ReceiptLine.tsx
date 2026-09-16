import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { useRouter } from "expo-router";
import type { ChatReceipt } from "@/lib/receipts";
import { receiptDestinationLabel, receiptNavigation } from "@/lib/receiptRoutes";
import { ApiError } from "@/lib/api";
import { deleteMemory } from "@/features/memories/api";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { radius, spacing, typography } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";

/**
 * One line for everything the assistant saved on this turn: every receipt of
 * the message as a tappable fragment, joined by " · ", in the accent colour,
 * under the answer. The contract is docs/FEATURES.md ("Receipts: one line for
 * everything the assistant saves"); the fragments and their targets come from
 * `buildReceipts` (@/lib/receipts), the routes from
 * `receiptNavigation` (@/lib/receiptRoutes).
 *
 * The line is a wrapping flex row rather than nested Text, because the contract
 * requires each fragment to be a 44pt touch target and inline text spans cannot
 * carry a height. Each fragment keeps its separator in the same unbreakable
 * row, so a wrap never leaves a lone " · " at the start of a line.
 */

/** Undo is one-shot: fired once per receipt per session, never re-fired. */
type UndoState = "idle" | "pending" | "forgotten";

interface ReceiptLineProps {
	receipts: readonly ChatReceipt[];
}

function errorMessage(err: unknown, fallback: string): string {
	return err instanceof Error && err.message ? err.message : fallback;
}

export function ReceiptLine({ receipts }: ReceiptLineProps) {
	const styles = useThemedStyles(createStyles);
	const router = useRouter();
	const getToken = useStableGetToken();
	const [undoStates, setUndoStates] = useState<Record<string, UndoState>>({});
	// The authority on "already fired": two taps in one frame both pass a state
	// check, because the re-render has not happened yet.
	const fired = useRef<Set<string>>(new Set());
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const open = useCallback(
		(receipt: ChatReceipt) => {
			const { href, withAnchor } = receiptNavigation(receipt.target);
			router.push(href, withAnchor ? { withAnchor: true } : undefined);
		},
		[router],
	);

	const forget = useCallback(
		(receiptId: string, memoryId: string) => {
			if (fired.current.has(receiptId)) return;
			fired.current.add(receiptId);
			setUndoStates((current) => ({ ...current, [receiptId]: "pending" }));
			void (async () => {
				try {
					await deleteMemory(getToken, memoryId);
					if (!mounted.current) return;
					setUndoStates((current) => ({ ...current, [receiptId]: "forgotten" }));
				} catch (err) {
					// 404 means the row is already gone, which is what the tap asked
					// for: an old conversation replays a receipt whose memory was
					// forgotten in an earlier session. The user wants the outcome, not
					// an error about how it was reached.
					if (err instanceof ApiError && err.status === 404) {
						if (!mounted.current) return;
						setUndoStates((current) => ({ ...current, [receiptId]: "forgotten" }));
						return;
					}
					// Any other failure leaves the memory saved, so the fragment must go
					// back to being tappable rather than claiming it is forgotten.
					fired.current.delete(receiptId);
					if (!mounted.current) return;
					setUndoStates((current) => ({ ...current, [receiptId]: "idle" }));
					Alert.alert(
						"Could not forget that memory",
						errorMessage(err, "Try again in a moment."),
					);
				}
			})();
		},
		[getToken],
	);

	if (receipts.length === 0) return null;

	const fragments: { key: string; node: React.ReactNode }[] = [];
	for (const receipt of receipts) {
		const undo = receipt.undo;
		const state = undo ? undoStates[receipt.id] ?? "idle" : "idle";

		// An undone memory replaces its own receipt: "Remembered · Forgotten"
		// would still claim the memory was kept, and there is nothing left to
		// open, so the fragment stops being a link and the Undo goes away.
		if (state === "forgotten") {
			fragments.push({
				key: receipt.id,
				node: (
					<View accessible accessibilityLabel="Forgotten." style={styles.fragment}>
						<Text style={styles.spent}>Forgotten</Text>
					</View>
				),
			});
			continue;
		}

		fragments.push({
			key: receipt.id,
			node: (
				<Pressable
					accessibilityRole="link"
					accessibilityLabel={`${receipt.label}. ${receiptDestinationLabel(receipt.target)}`}
					onPress={() => open(receipt)}
					style={({ pressed }) => [styles.fragment, pressed && styles.fragmentPressed]}
				>
					<Text style={styles.label}>{receipt.label}</Text>
				</Pressable>
			),
		});

		if (!undo) continue;
		fragments.push({
			key: `${receipt.id}:undo`,
			node: (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Undo. Forgets what was just remembered."
					accessibilityState={{ disabled: state === "pending" }}
					disabled={state === "pending"}
					onPress={() => forget(receipt.id, undo.memoryId)}
					style={({ pressed }) => [
						styles.fragment,
						pressed && styles.fragmentPressed,
						state === "pending" && styles.fragmentPending,
					]}
				>
					<Text style={styles.label}>Undo</Text>
				</Pressable>
			),
		});
	}

	return (
		<View style={styles.line}>
			{fragments.map((fragment, index) => (
				<View key={fragment.key} style={styles.item}>
					{index > 0 && <Text style={styles.separator}>·</Text>}
					{fragment.node}
				</View>
			))}
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		line: {
			flexDirection: "row",
			flexWrap: "wrap",
			alignItems: "center",
			columnGap: 6,
			marginTop: spacing.sm,
		},
		item: {
			flexDirection: "row",
			alignItems: "center",
			gap: 6,
			flexShrink: 1,
		},
		fragment: {
			minHeight: 44,
			justifyContent: "center",
			flexShrink: 1,
			paddingHorizontal: 2,
			borderRadius: radius.sm,
		},
		fragmentPressed: { backgroundColor: c.surfacePressed },
		fragmentPending: { opacity: 0.5 },
		label: { ...typography.meta, color: c.accent },
		spent: { ...typography.meta, color: c.textFaint },
		separator: { ...typography.meta, color: c.accentDim },
	});
