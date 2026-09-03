import React, { useCallback, useEffect, useRef, useState } from "react";
import {
	Animated,
	Easing,
	Modal,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
} from "react-native";
import { AppText as Text } from "@/components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { formatRelativeDate } from "./format";
import type { Conversation } from "./useSureWordChat";

interface HistoryModalProps {
	visible: boolean;
	conversations: Conversation[];
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
	const [mounted, setMounted] = useState(visible);
	const [confirmClear, setConfirmClear] = useState(false);
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
		if (!visible) setConfirmClear(false);
	}, [visible]);

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

	if (!mounted) return null;

	const translateY = anim.interpolate({
		inputRange: [0, 1],
		outputRange: [SHEET_TRAVEL, 0],
	});

	return (
		<Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
			<View style={styles.root}>
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

					<ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
						{loading && conversations.length === 0 && (
							<Text style={styles.empty}>Loading your conversations...</Text>
						)}
						{!loading && conversations.length === 0 && (
							<Text style={styles.empty}>
								No conversations yet. Ask your first question to start one.
							</Text>
						)}
						{conversations.map((conversation) => {
							const active = conversation.id === activeConversationId;
							return (
								<View key={conversation.id} style={[styles.row, active && styles.rowActive]}>
									<Pressable
										accessibilityRole="button"
										onPress={() => select(conversation.id)}
										style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
									>
										<Text style={[styles.rowTitle, active && { color: colors.accent }]} numberOfLines={1}>
											{conversation.title || "Untitled conversation"}
										</Text>
										<Text style={styles.rowDate}>{formatRelativeDate(conversation.createdAt)}</Text>
									</Pressable>
									<Pressable
										accessibilityRole="button"
										accessibilityLabel={`Delete ${conversation.title}`}
										onPress={() => onDelete(conversation.id)}
										style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
									>
										<Ionicons name="trash-outline" size={15} color={colors.textFaint} />
									</Pressable>
								</View>
							);
						})}
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
			</View>
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
		list: { marginTop: spacing.lg },
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
