import React, { useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, View } from "react-native";
import { useAuth, useUser } from "@clerk/expo";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { GlassCard } from "@/components/ui";
import { radius, spacing, typography, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import {
	SettingsAvatar,
	SettingsSubScreen,
	useSettingsStyles,
} from "@/features/settings/SettingsChrome";
import { clearUserCaches } from "@/features/settings/cacheOwner";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import {
	CONFIRMATION_WORD,
	DELETE_CONFIRM_MESSAGE,
	DELETE_CONFIRM_TITLE,
	DELETE_ERROR_TITLE,
	DELETE_TYPE_MESSAGE,
	DELETE_TYPE_TITLE,
	initialDeletionState,
	isConfirmationTyped,
	reduceDeletion,
	requestAccountDeletion,
	type DeletionState,
} from "@/features/settings/accountDeletion";

/** The first card carries no label, so it needs the label's own top offset. */
const contentStyle = { paddingTop: spacing.xl };

/** Who is signed in, the way out, and the way to leave for good. */
export default function AccountSettingsScreen() {
	const { signOut } = useAuth();
	const { user } = useUser();
	const getToken = useStableGetToken();
	const styles = useSettingsStyles();
	const local = useThemedStyles(createStyles);
	const { colors } = useTheme();

	const email = user?.primaryEmailAddress?.emailAddress ?? "";
	const name = user?.fullName ?? user?.username ?? "";

	// The reducer's state lives in a ref too, so a "Try again" from the error
	// alert reads the latest `mayHaveDeleted` rather than a stale closure.
	const deletionRef = useRef<DeletionState>(initialDeletionState);
	const [deletion, setDeletion] = useState<DeletionState>(initialDeletionState);
	const [typing, setTyping] = useState(false);
	const [typed, setTyped] = useState("");

	const deleting = deletion.phase.kind === "deleting";
	const deleted = deletion.phase.kind === "deleted";

	const update = (next: DeletionState) => {
		deletionRef.current = next;
		setDeletion(next);
	};

	const confirmSignOut = () => {
		Alert.alert("Sign out?", "You can sign back in at any time.", [
			{ text: "Cancel", style: "cancel" },
			{ text: "Sign out", style: "destructive", onPress: () => void signOut() },
		]);
	};

	const runDeletion = async (): Promise<void> => {
		const current = deletionRef.current;
		if (current.phase.kind === "deleting" || current.phase.kind === "deleted") return;
		update({ ...current, phase: { kind: "deleting" } });
		const outcome = await requestAccountDeletion(getToken);
		const next = reduceDeletion(deletionRef.current, outcome);
		update(next);
		if (next.phase.kind === "deleted") {
			// The same per-account wipe the sign-out path runs, done first so
			// nothing from the deleted account survives a slow Clerk sign-out.
			await clearUserCaches();
			await signOut().catch(() => undefined);
			return;
		}
		if (next.phase.kind === "failed") {
			Alert.alert(DELETE_ERROR_TITLE, next.phase.message, [
				{ text: "Cancel", style: "cancel", onPress: () => update({ ...deletionRef.current, phase: { kind: "idle" } }) },
				{
					text: "Try again",
					style: "destructive",
					onPress: () => {
						update({ ...deletionRef.current, phase: { kind: "idle" } });
						void runDeletion();
					},
				},
			]);
		}
	};

	const confirmDelete = () => {
		Alert.alert(DELETE_CONFIRM_TITLE, DELETE_CONFIRM_MESSAGE, [
			{ text: "Cancel", style: "cancel" },
			{
				text: "Continue",
				style: "destructive",
				onPress: () => {
					setTyped("");
					setTyping(true);
				},
			},
		]);
	};

	const confirmed = isConfirmationTyped(typed);

	return (
		<SettingsSubScreen title="Account" contentStyle={contentStyle}>
			<GlassCard style={styles.card}>
				<View style={local.accountRow}>
					<SettingsAvatar initial={(name || email || "✝").trim().charAt(0).toUpperCase()} />
					<View style={local.accountText}>
						{name ? (
							<Text style={local.accountName} numberOfLines={1}>
								{name}
							</Text>
						) : null}
						<Text style={local.accountEmail} numberOfLines={1}>
							{email || "Signed in"}
						</Text>
					</View>
				</View>
				<Pressable
					accessibilityRole="button"
					onPress={confirmSignOut}
					style={({ pressed }) => [
						local.signOutButton,
						pressed && { backgroundColor: "rgba(248, 113, 113, 0.18)" },
					]}
				>
					<Text style={local.signOutLabel}>Sign out</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					accessibilityHint="Permanently deletes your SureWord account and data"
					accessibilityState={{ disabled: deleting || deleted, busy: deleting }}
					disabled={deleting || deleted}
					onPress={confirmDelete}
					style={({ pressed }) => [local.deleteButton, pressed && { opacity: 0.6 }]}
				>
					{deleting ? (
						<View style={local.deletingRow}>
							<ActivityIndicator size="small" color={colors.danger} />
							<Text style={local.deleteLabel}>Deleting account…</Text>
						</View>
					) : (
						<Text style={local.deleteLabel}>Delete account</Text>
					)}
				</Pressable>
			</GlassCard>

			<Modal
				transparent
				visible={typing}
				animationType="fade"
				onRequestClose={() => setTyping(false)}
				statusBarTranslucent
			>
				<View style={local.backdrop}>
					<View style={local.dialog} accessibilityViewIsModal>
						<Text style={local.dialogTitle} accessibilityRole="header">
							{DELETE_TYPE_TITLE}
						</Text>
						<Text style={local.dialogMessage}>{DELETE_TYPE_MESSAGE}</Text>
						<TextInput
							value={typed}
							onChangeText={setTyped}
							placeholder={CONFIRMATION_WORD}
							placeholderTextColor={colors.textFaint}
							selectionColor={colors.danger}
							autoCapitalize="characters"
							autoCorrect={false}
							autoFocus
							accessibilityLabel="Type DELETE to confirm"
							style={local.input}
						/>
						<View style={local.dialogActions}>
							<Pressable
								accessibilityRole="button"
								onPress={() => setTyping(false)}
								style={({ pressed }) => [local.dialogButton, pressed && { opacity: 0.6 }]}
							>
								<Text style={local.cancelLabel}>Cancel</Text>
							</Pressable>
							<Pressable
								accessibilityRole="button"
								accessibilityState={{ disabled: !confirmed }}
								disabled={!confirmed}
								onPress={() => {
									setTyping(false);
									void runDeletion();
								}}
								style={({ pressed }) => [
									local.dialogButton,
									!confirmed && { opacity: 0.4 },
									pressed && { opacity: 0.6 },
								]}
							>
								<Text style={local.deleteLabel}>Delete account</Text>
							</Pressable>
						</View>
					</View>
				</View>
			</Modal>
		</SettingsSubScreen>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		accountRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
		accountText: { flex: 1, minWidth: 0 },
		accountName: { color: c.text, ...typography.control, fontWeight: "600" },
		accountEmail: { color: c.textFaint, ...typography.meta, marginTop: 1 },
		signOutButton: {
			minHeight: 44,
			borderRadius: radius.lg,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.dangerSoft,
			borderColor: c.dangerBorder,
			borderWidth: 1,
		},
		signOutLabel: { color: c.danger, ...typography.control, fontWeight: "700" },
		deleteButton: {
			minHeight: 44,
			borderRadius: radius.lg,
			alignItems: "center",
			justifyContent: "center",
		},
		deletingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
		deleteLabel: { color: c.danger, ...typography.control, fontWeight: "600" },
		backdrop: {
			flex: 1,
			backgroundColor: "rgba(0, 0, 0, 0.6)",
			alignItems: "center",
			justifyContent: "center",
			padding: spacing.xl,
		},
		dialog: {
			width: "100%",
			maxWidth: 420,
			borderRadius: radius.xl,
			backgroundColor: c.bgElevated,
			borderColor: c.borderStrong,
			borderWidth: 1,
			padding: spacing.xl,
			gap: spacing.md,
		},
		dialogTitle: { color: c.text, ...typography.sectionTitle, fontWeight: "700" },
		dialogMessage: { color: c.textMuted, ...typography.support },
		input: {
			minHeight: 44,
			borderRadius: radius.md,
			borderColor: c.borderStrong,
			borderWidth: 1,
			backgroundColor: c.surface,
			color: c.text,
			paddingHorizontal: spacing.md,
			...typography.control,
		},
		dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
		dialogButton: {
			minHeight: 44,
			paddingHorizontal: spacing.lg,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: radius.md,
		},
		cancelLabel: { color: c.textSecondary, ...typography.control, fontWeight: "600" },
	});
