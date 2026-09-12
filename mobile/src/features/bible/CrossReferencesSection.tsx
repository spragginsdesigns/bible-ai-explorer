import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { useThemedStyles } from "@/features/settings/settingsStore";
import { API_URL } from "@/lib/api";
import { radius, spacing, typography, type Colors } from "@/theme";
import { resolveReference } from "./books";
import type { TranslationId } from "./translations";
import { bibleVersePlainText } from "./verseMarkup";

interface CrossReferenceItem {
	reference: string;
	text?: string;
}

interface CrossReferencesResponse {
	reference: string;
	translation: TranslationId;
	crossReferences: CrossReferenceItem[];
}

interface CrossReferencesSectionProps {
	reference: string;
	translation: TranslationId;
	enabled: boolean;
	onNavigate: (target: CrossReferenceTarget) => void;
}

export interface CrossReferenceTarget {
	order: number;
	chapter: number;
	verse?: number;
}

type LoadState =
	| { status: "loading"; items: CrossReferenceItem[] }
	| { status: "ready"; items: CrossReferenceItem[] }
	| { status: "error"; items: CrossReferenceItem[] };

const REQUEST_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** Ranges open at their first verse. Invalid provider labels stay plain text. */
function referenceTarget(reference: string): CrossReferenceTarget | null {
	const start = reference.split(/[-\u2013\u2014]/, 1)[0];
	return resolveReference(start);
}

function parseResponse(value: unknown, translation: TranslationId): CrossReferencesResponse | null {
	if (!isRecord(value) || value.translation !== translation || typeof value.reference !== "string") {
		return null;
	}
	if (!Array.isArray(value.crossReferences)) return null;

	const crossReferences: CrossReferenceItem[] = [];
	for (const candidate of value.crossReferences) {
		if (!isRecord(candidate) || typeof candidate.reference !== "string") return null;
		if (candidate.text !== undefined && typeof candidate.text !== "string") return null;
		crossReferences.push({
			reference: candidate.reference,
			...(candidate.text ? { text: bibleVersePlainText(candidate.text) } : {}),
		});
	}
	return { reference: value.reference, translation, crossReferences: crossReferences.slice(0, 5) };
}

/** Collapsed top-five Scripture links for the verse sheet. */
export function CrossReferencesSection({
	reference,
	translation,
	enabled,
	onNavigate,
}: CrossReferencesSectionProps) {
	const styles = useThemedStyles(createStyles);
	const [expanded, setExpanded] = useState(false);
	const [state, setState] = useState<LoadState>({ status: "loading", items: [] });
	const requestId = useRef(0);
	const controllerRef = useRef<AbortController | null>(null);

	const load = useCallback(async () => {
		if (!enabled) return;
		const id = ++requestId.current;
		controllerRef.current?.abort();
		setState({ status: "loading", items: [] });
		const controller = new AbortController();
		controllerRef.current = controller;
		const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const query = new URLSearchParams({ reference, translation, limit: "5" });
			const response = await fetch(`${API_URL}/api/bible/crossrefs?${query.toString()}`, {
				signal: controller.signal,
			});
			if (!response.ok) throw new Error(`Cross-reference request failed: ${response.status}`);
			const parsed = parseResponse(await response.json(), translation);
			if (!parsed) throw new Error("Unexpected cross-reference response");
			if (requestId.current === id) {
				setState({ status: "ready", items: parsed.crossReferences });
			}
		} catch {
			if (requestId.current === id) setState({ status: "error", items: [] });
		} finally {
			clearTimeout(timer);
			if (controllerRef.current === controller) controllerRef.current = null;
		}
	}, [enabled, reference, translation]);

	useEffect(() => {
		setExpanded(false);
		if (enabled) void load();
		return () => {
			requestId.current += 1;
			controllerRef.current?.abort();
			controllerRef.current = null;
		};
	}, [enabled, load]);

	if (!enabled || (state.status === "ready" && state.items.length === 0)) return null;

	return (
		<View style={styles.container}>
			<Pressable
				accessibilityRole="button"
				accessibilityState={{ expanded }}
				onPress={() => setExpanded((current) => !current)}
				style={({ pressed }) => [styles.header, pressed && styles.pressed]}
			>
				<Text style={styles.caption}>SEE ALSO</Text>
				<Text style={styles.status}>
					{state.status === "loading"
						? "Loading"
						: state.status === "error"
							? "Unavailable"
							: `${state.items.length} ${state.items.length === 1 ? "passage" : "passages"}`}
				</Text>
				<Text style={styles.chevron}>{expanded ? "▴" : "▾"}</Text>
			</Pressable>

			{expanded ? (
				<View style={styles.body}>
					{state.status === "loading" ? (
						<Text accessibilityRole="text" style={styles.message}>
							Loading related passages…
						</Text>
					) : state.status === "error" ? (
						<View style={styles.errorRow}>
							<Text style={styles.message}>Related passages could not be loaded.</Text>
							<Pressable accessibilityRole="button" onPress={() => void load()} hitSlop={8}>
								<Text style={styles.retry}>Try again</Text>
							</Pressable>
						</View>
					) : (
						<View style={styles.list}>
							{state.items.map((item) => {
								const target = referenceTarget(item.reference);
								return (
									<View key={item.reference} style={styles.item}>
										{target ? (
											<Pressable
												accessibilityRole="link"
												accessibilityLabel={`Open ${item.reference}`}
												onPress={() => onNavigate(target)}
												hitSlop={4}
											>
												<Text style={styles.reference}>{item.reference}</Text>
											</Pressable>
										) : (
											<Text style={styles.reference}>{item.reference}</Text>
										)}
										{item.text ? <Text style={styles.verse}>{item.text}</Text> : null}
									</View>
								);
							})}
						</View>
					)}
				</View>
			) : null}
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		container: {
			marginBottom: spacing.sm,
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
			overflow: "hidden",
		},
		header: {
			minHeight: 44,
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
		},
		pressed: { backgroundColor: c.surfacePressed },
		caption: {
			flex: 1,
			color: c.textMuted,
			...typography.support,
			fontWeight: "700",
			letterSpacing: 0.8,
		},
		status: { color: c.textFaint, ...typography.meta },
		chevron: { color: c.textFaint, ...typography.support },
		body: {
			borderTopWidth: StyleSheet.hairlineWidth,
			borderTopColor: c.border,
			padding: spacing.md,
		},
		message: { flex: 1, color: c.textMuted, ...typography.support },
		errorRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
		retry: { color: c.accent, ...typography.support, fontWeight: "700" },
		list: { gap: spacing.md },
		item: { gap: 4 },
		reference: { color: c.accent, ...typography.support, fontWeight: "700" },
		verse: { color: c.textSecondary, ...typography.body },
	});
