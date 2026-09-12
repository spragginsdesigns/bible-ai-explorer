import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Animated,
	Easing,
	Modal,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { apiJson, type GetToken } from "@/lib/api";
import { formatRelativeDate } from "./format";
import type { Conversation } from "./useSureWordChat";

/**
 * The server list payload already carries updatedAt (ordered by it), but the
 * hook maps it down to createdAt for now; read it when present so the stamp
 * tracks last activity once the mapping lands.
 */
type HistoryConversation = Conversation & { updatedAt?: string };

interface HistoryModalProps {
	visible: boolean;
	conversations: HistoryConversation[];
	activeConversationId: string | null;
	loading: boolean;
	onClose: () => void;
	onSelect: (id: string) => void;
	onDelete: (id: string) => void;
	onNewChat: () => void;
	onClearAll: () => void;
}

const SHEET_TRAVEL = 480;

export function HistoryModal({
	visible,
	conversations,
	activeConversationId,
	loading,
	onClose,
	onSelect,
	onDelete,
	onNewChat,
	onClearAll,
}: HistoryModalProps) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const insets = useSafeAreaInsets();
	const { getToken } = useAuth();
	// `{ fresh: true }` maps to Clerk's cache skip (the API layer's 401 retry).
	const getApiToken = useCallback<GetToken>(
		(opts) => getToken(opts?.fresh ? { skipCache: true } : undefined),
		[getToken]
	);
	const [mounted, setMounted] = useState(visible);
	const [confirmClear, setConfirmClear] = useState(false);
	const [query, setQuery] = useState("");
	// Titles renamed this session, until the next server fetch confirms them.
	const [renames, setRenames] = useState<Record<string, string>>({});
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");
	// A swipe plus one tap must not destroy a conversation: web asks "Sure?"
	// on the first press, and a destructive action has to match across clients.
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const anim = useRef(new Animated.Value(0)).current;

	useEffect(() => {
		if (visible) {
			setMounted(true);
			Animated.timing(anim, {
				toValue: 1,
				duration: 240,
				easing: Easing.out(Easing.cubic),
				useNativeDriver: true,
			}).start();
			return;
		}
		Animated.timing(anim, {
			toValue: 0,
			duration: 180,
			easing: Easing.in(Easing.cubic),
			useNativeDriver: true,
		}).start(({ finished }) => {
			if (finished) setMounted(false);
		});
	}, [anim, visible]);

	useEffect(() => {
		if (!visible) {
			setConfirmClear(false);
			setQuery("");
			setRenamingId(null);
			setActionError(null);
		}
	}, [visible]);

	const titleOf = useCallback(
		(conversation: HistoryConversation) => renames[conversation.id] ?? conversation.title,
		[renames]
	);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return conversations;
		return conversations.filter((conversation) =>
			(conversation.title || "Untitled conversation").toLowerCase().includes(q) ||
			titleOf(conversation).toLowerCase().includes(q)
		);
	}, [conversations, query, titleOf]);

	const select = useCallback(
		(id: string) => {
			onSelect(id);
			onClose();
		},
		[onClose, onSelect]
	);

	const startNewChat = useCallback(() => {
		onNewChat();
		onClose();
	}, [onClose, onNewChat]);

	const clearAll = useCallback(() => {
		if (!confirmClear) {
			setConfirmClear(true);
			return;
		}
		onClearAll();
		onClose();
	}, [confirmClear, onClearAll, onClose]);

	const startRename = useCallback(
		(conversation: HistoryConversation) => {
			setActionError(null);
			setRenamingId(conversation.id);
			setRenameValue(titleOf(conversation));
		},
		[titleOf]
	);

	const commitRename = useCallback(
		async (conversation: HistoryConversation) => {
			// The route collapses runs of whitespace; match it so the optimistic
			// title is the one the server stores.
			const title = renameValue.replace(/\s+/g, " ").trim();
			setRenamingId(null);
			if (!title || title === titleOf(conversation)) return;
			try {
				await apiJson(getApiToken, `/api/conversations/${conversation.id}`, {
					method: "PATCH",
					body: { title },
				});
				setRenames((prev) => ({ ...prev, [conversation.id]: title }));
			} catch {
				setActionError("Couldn't rename. Try again.");
			}
		},
		[getApiToken, renameValue, titleOf]
	);

	if (!mounted) return null;

	const translateY = anim.interpolate({
		inputRange: [0, 1],
		outputRange: [SHEET_TRAVEL, 0],
	});

	const renderRow = (conversation: HistoryConversation) => {
		const active = conversation.id === activeConversationId;
		const renaming = renamingId === conversation.id;
		return (
			<ReanimatedSwipeable
				key={conversation.id}
				friction={2}
				rightThreshold={40}
				leftThreshold={40}
				renderRightActions={() => (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={`Delete ${titleOf(conversation)}`}
						onPress={() => {
							if (confirmDeleteId !== conversation.id) {
								setConfirmDeleteId(conversation.id);
								return;
							}
							setConfirmDeleteId(null);
							onDelete(conversation.id);
						}}
						style={[styles.swipeAction, styles.swipeDelete]}
					>
						<Ionicons name="trash-outline" size={16} color="#fff" />
						<Text style={styles.swipeActionLabel}>
							{confirmDeleteId === conversation.id ? "Sure?" : "Delete"}
						</Text>
					</Pressable>
				)}
				renderLeftActions={() => (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={`Rename ${titleOf(conversation)}`}
						onPress={() => startRename(conversation)}
						style={[styles.swipeAction, styles.swipeRename]}
					>
						<Ionicons name="pencil-outline" size={16} color={colors.accent} />
						<Text style={[styles.swipeActionLabel, { color: colors.accent }]}>Rename</Text>
					</Pressable>
				)}
			>
				<View style={[styles.row, active && styles.rowActive]}>
					{renaming ? (
						<View style={styles.renameRow}>
							<TextInput
								value={renameValue}
								onChangeText={setRenameValue}
								autoFocus
								selectTextOnFocus
								returnKeyType="done"
								onSubmitEditing={() => void commitRename(conversation)}
								// The route rejects anything longer (400).
								maxLength={120}
								accessibilityLabel="Rename conversation"
								style={styles.renameInput}
							/>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel="Save name"
								onPress={() => void commitRename(conversation)}
								style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
							>
								<Ionicons name="checkmark" size={15} color={colors.accent} />
							</Pressable>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel="Cancel rename"
								onPress={() => setRenamingId(null)}
								style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
							>
								<Ionicons name="close" size={15} color={colors.textMuted} />
							</Pressable>
						</View>
					) : (
						<Pressable
							accessibilityRole="button"
							onPress={() => select(conversation.id)}
							style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
						>
							<Text style={[styles.rowTitle, active && { color: colors.accent }]} numberOfLines={1}>
								{titleOf(conversation) || "Untitled conversation"}
							</Text>
							<Text style={styles.rowDate}>
								{formatRelativeDate(conversation.updatedAt ?? conversation.createdAt)}
							</Text>
						</Pressable>
					)}
				</View>
			</ReanimatedSwipeable>
		);
	};

	return (
		<Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
			{/* Modal content sits in its own native view hierarchy on Android, so
			    swipe gestures need their own handler root inside it. */}
			<GestureHandlerRootView style={styles.root}>
				<Animated.View style={[styles.backdrop, { opacity: anim }]}>
					<Pressable accessibilityLabel="Close history" onPress={onClose} style={styles.backdropFill} />
				</Animated.View>

				<Animated.View
					style={[
						styles.sheet,
						{ paddingBottom: Math.max(insets.bottom, spacing.lg), transform: [{ translateY }] },
					]}
				>
					<View style={styles.grabber} />

					<View style={styles.header}>
						<Text style={styles.heading}>Conversations</Text>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Close"
							onPress={onClose}
							style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
						>
							<Text style={styles.iconGlyph}>✕</Text>
						</Pressable>
					</View>

					<Pressable
						accessibilityRole="button"
						onPress={startNewChat}
						style={({ pressed }) => [styles.newChat, pressed && { backgroundColor: colors.accentPressed }]}
					>
						<Text style={styles.newChatGlyph}>✦</Text>
						<Text style={styles.newChatLabel}>New chat</Text>
					</Pressable>

					{conversations.length > 0 && (
						<View style={styles.searchBox}>
							<Ionicons name="search" size={14} color={colors.textFaint} />
							<TextInput
								value={query}
								onChangeText={setQuery}
								placeholder="Search conversations"
								placeholderTextColor={colors.textGhost}
								accessibilityLabel="Search conversations"
								style={styles.searchInput}
								autoCorrect={false}
							/>
							{query.length > 0 && (
								<Pressable
									accessibilityRole="button"
									accessibilityLabel="Clear search"
									onPress={() => setQuery("")}
									hitSlop={8}
								>
									<Ionicons name="close-circle" size={14} color={colors.textFaint} />
								</Pressable>
							)}
						</View>
					)}

					{actionError && <Text style={styles.error}>{actionError}</Text>}

					<ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
						{loading && conversations.length === 0 && (
							<Text style={styles.empty}>Loading your conversations...</Text>
						)}
						{!loading && conversations.length === 0 && (
							<Text style={styles.empty}>
								No conversations yet. Ask your first question to start one.
							</Text>
						)}
						{filtered.length === 0 && conversations.length > 0 && (
							<Text style={styles.empty}>No conversations match “{query.trim()}”.</Text>
						)}
						{filtered.map(renderRow)}
					</ScrollView>

					{conversations.length > 0 && (
						<Pressable
							accessibilityRole="button"
							onPress={clearAll}
							style={({ pressed }) => [styles.clearAll, pressed && styles.pressed]}
						>
							<Text style={styles.clearAllLabel}>
								{confirmClear ? "Tap again to delete every conversation" : "Clear all"}
							</Text>
						</Pressable>
					)}
				</Animated.View>
			</GestureHandlerRootView>
		</Modal>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		root: { flex: 1, justifyContent: "flex-end" },
		backdrop: {
			position: "absolute",
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			backgroundColor: "rgba(0, 0, 0, 0.65)",
		},
		backdropFill: { flex: 1 },
		sheet: {
			maxHeight: "80%",
			backgroundColor: c.bgElevated,
			borderTopLeftRadius: 28,
			borderTopRightRadius: 28,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
			paddingHorizontal: spacing.xl,
			paddingTop: spacing.md,
		},
		grabber: {
			alignSelf: "center",
			width: 36,
			height: 4,
			borderRadius: radius.full,
			backgroundColor: c.surfacePressed,
			marginBottom: spacing.lg,
		},
		header: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			marginBottom: spacing.lg,
		},
		heading: { color: c.text, fontSize: 17, fontWeight: "700" },
		iconButton: {
			width: 34,
			height: 34,
			borderRadius: radius.full,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
		},
		pressed: { backgroundColor: c.surfacePressed },
		iconGlyph: { color: c.textMuted, fontSize: 13 },
		newChat: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: spacing.sm,
			paddingVertical: spacing.md,
			borderRadius: radius.lg,
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
		},
		newChatGlyph: { color: c.accent, fontSize: 14 },
		newChatLabel: { color: c.accent, fontSize: 14, fontWeight: "600" },
		searchBox: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			marginTop: spacing.md,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
		},
		searchInput: {
			flex: 1,
			color: c.text,
			fontSize: 14,
			paddingVertical: 2,
		},
		error: {
			...typography.meta,
			color: c.danger,
			marginTop: spacing.sm,
		},
		list: { marginTop: spacing.md },
		listContent: { gap: spacing.sm, paddingBottom: spacing.sm },
		empty: {
			color: c.textFaint,
			fontSize: 13,
			lineHeight: 20,
			paddingVertical: spacing.xl,
			textAlign: "center",
		},
		row: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			paddingLeft: spacing.md,
			paddingRight: spacing.sm,
			paddingVertical: spacing.sm,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
		},
		rowActive: { borderColor: c.accentBorder, backgroundColor: c.accentSoft },
		rowMain: { flex: 1, paddingVertical: spacing.xs, borderRadius: radius.md },
		rowTitle: { color: c.textSecondary, fontSize: 14, fontWeight: "500" },
		rowDate: { ...typography.meta, marginTop: 2, color: c.textGhost },
		renameRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
		renameInput: {
			flex: 1,
			color: c.text,
			fontSize: 14,
			fontWeight: "500",
			paddingVertical: spacing.xs,
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: c.accentBorder,
		},
		swipeAction: {
			justifyContent: "center",
			alignItems: "center",
			gap: 2,
			width: 84,
			borderRadius: radius.lg,
		},
		swipeDelete: { backgroundColor: c.danger, marginLeft: spacing.sm },
		swipeRename: {
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
			marginRight: spacing.sm,
		},
		swipeActionLabel: { color: "#fff", fontSize: 11, fontWeight: "600" },
		clearAll: {
			marginTop: spacing.md,
			paddingVertical: spacing.md,
			borderRadius: radius.lg,
			alignItems: "center",
			// A hairline above the footer so the list's scroll edge reads as a
			// boundary rather than a row that happens to be cut in half.
			borderTopWidth: StyleSheet.hairlineWidth,
			borderTopColor: c.border,
		},
		clearAllLabel: { color: c.danger, fontSize: 13, fontWeight: "500" },
	});
