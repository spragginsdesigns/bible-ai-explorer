import React, { useCallback, useState } from "react";
import {
	ActivityIndicator,
	Linking,
	Pressable,
	StyleSheet,
	View,
} from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { GlassCard } from "@/components/ui";
import { radius, spacing, typography, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import {
	fetchProviders,
	removeProviderKey,
	saveProviderKey,
	type ProvidersResponse,
} from "./aiApi";
import type { GetToken } from "@/lib/api";

/**
 * Settings → AI Providers (parity with the web settings page): add, replace,
 * or remove per-provider API keys. A saved key unlocks that provider's models
 * in the chat model picker. Keys are validated server-side before storage and
 * only ever shown as their last four characters afterwards.
 */
export function ProviderSettingsSection({ getToken }: { getToken: GetToken }) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const [data, setData] = useState<ProvidersResponse | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [editing, setEditing] = useState<string | null>(null);
	const [keyInput, setKeyInput] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoadFailed(false);
		try {
			setData(await fetchProviders(getToken));
		} catch {
			setLoadFailed(true);
		}
	}, [getToken]);

	useFocusEffect(
		useCallback(() => {
			void load();
		}, [load])
	);

	const save = (provider: string) => {
		if (pending || keyInput.trim().length === 0) return;
		setPending(true);
		setError(null);
		void (async () => {
			try {
				await saveProviderKey(getToken, provider, keyInput.trim());
				setEditing(null);
				setKeyInput("");
				await load();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Could not save the key.");
			} finally {
				setPending(false);
			}
		})();
	};

	const remove = (provider: string) => {
		if (pending) return;
		setPending(true);
		setError(null);
		void (async () => {
			try {
				await removeProviderKey(getToken, provider);
				await load();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Could not remove the key.");
			} finally {
				setPending(false);
			}
		})();
	};

	if (loadFailed) {
		return (
			<GlassCard style={styles.card}>
				<View style={styles.retryRow}>
					<Text style={styles.hint}>Couldn&apos;t load provider settings.</Text>
					<Pressable accessibilityRole="button" onPress={() => void load()} hitSlop={8}>
						<Text style={styles.retry}>Retry</Text>
					</Pressable>
				</View>
			</GlassCard>
		);
	}

	if (!data) {
		return (
			<GlassCard style={[styles.card, styles.loadingCard]}>
				<ActivityIndicator color={colors.accent} />
			</GlassCard>
		);
	}

	return (
		<GlassCard style={styles.card}>
			<Text style={styles.hint}>
				Bring your own API keys to unlock each provider&apos;s models in the chat
				model picker. Keys are validated, stored encrypted, and used only for
				your own conversations.
			</Text>
			{data.serverCredentials && (
				<Text style={styles.serverNote}>
					Your account also has access to SureWord&apos;s built-in keys; adding
					your own overrides them per provider.
				</Text>
			)}
			{data.providers.map((provider) => (
				<View key={provider.id} style={styles.providerBox}>
					<View style={styles.providerRow}>
						<View style={styles.providerIcon}>
							<Ionicons name="key-outline" size={17} color={colors.accent} />
						</View>
						<View style={styles.providerCopy}>
							<Text style={styles.providerName}>{provider.label}</Text>
							<Text style={styles.providerStatus}>
								{provider.connected ? `Key ending in ${provider.last4}` : "Not connected"}
							</Text>
						</View>
						{editing !== provider.id && (
							<View style={styles.actions}>
								<Pressable
									accessibilityRole="button"
									disabled={pending}
									onPress={() => {
										setEditing(provider.id);
										setKeyInput("");
										setError(null);
									}}
									style={({ pressed }) => [
										styles.actionButton,
										pressed && { backgroundColor: colors.surfacePressed },
									]}
								>
									<Text style={styles.actionLabel}>
										{provider.connected ? "Replace" : "Add key"}
									</Text>
								</Pressable>
								{provider.connected && (
									<Pressable
										accessibilityRole="button"
										accessibilityLabel={`Remove ${provider.label} key`}
										disabled={pending}
										onPress={() => remove(provider.id)}
										hitSlop={8}
										style={({ pressed }) => pressed && { opacity: 0.6 }}
									>
										<Ionicons name="trash-outline" size={17} color={colors.textFaint} />
									</Pressable>
								)}
							</View>
						)}
					</View>
					{editing === provider.id && (
						<View style={styles.editBox}>
							<TextInput
								value={keyInput}
								onChangeText={setKeyInput}
								placeholder={`Paste your ${provider.label} API key`}
								placeholderTextColor={colors.textGhost}
								autoCapitalize="none"
								autoCorrect={false}
								secureTextEntry
								autoFocus
								style={styles.keyInput}
							/>
							<View style={styles.editActions}>
								<Pressable
									accessibilityRole="button"
									disabled={pending || keyInput.trim().length === 0}
									onPress={() => save(provider.id)}
									style={({ pressed }) => [
										styles.saveButton,
										pressed && { backgroundColor: colors.surfacePressed },
										(pending || keyInput.trim().length === 0) && { opacity: 0.4 },
									]}
								>
									{pending && <ActivityIndicator size="small" color={colors.accent} />}
									<Text style={styles.saveLabel}>Validate &amp; save</Text>
								</Pressable>
								<Pressable
									accessibilityRole="button"
									disabled={pending}
									onPress={() => {
										setEditing(null);
										setKeyInput("");
										setError(null);
									}}
									hitSlop={8}
								>
									<Text style={styles.cancelLabel}>Cancel</Text>
								</Pressable>
								<Pressable
									accessibilityRole="button"
									onPress={() => void Linking.openURL(provider.keyUrl)}
									hitSlop={8}
									style={styles.keyUrlButton}
								>
									<Text style={styles.keyUrlLabel}>Get a key</Text>
									<Ionicons name="open-outline" size={12} color={colors.textFaint} />
								</Pressable>
							</View>
						</View>
					)}
				</View>
			))}
			{error && <Text style={styles.error}>{error}</Text>}
		</GlassCard>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		card: { padding: spacing.lg, gap: spacing.md },
		loadingCard: { minHeight: 80, alignItems: "center", justifyContent: "center" },
		hint: { ...typography.support, color: c.textFaint },
		serverNote: { ...typography.support, color: c.accent },
		retryRow: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			gap: spacing.md,
		},
		retry: { color: c.accent, fontSize: 13, fontWeight: "700" },
		providerBox: {
			borderRadius: radius.lg,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
			padding: spacing.md,
			gap: spacing.md,
		},
		providerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
		providerIcon: {
			width: 36,
			height: 36,
			borderRadius: radius.full,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: StyleSheet.hairlineWidth,
		},
		providerCopy: { flex: 1, minWidth: 0 },
		providerName: { color: c.text, fontSize: 14.5, fontWeight: "600" },
		providerStatus: { ...typography.meta, color: c.textFaint, marginTop: 1 },
		actions: { flexDirection: "row", alignItems: "center", gap: spacing.md },
		actionButton: {
			minHeight: 34,
			paddingHorizontal: spacing.md,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
		},
		actionLabel: { ...typography.support, color: c.textSecondary, fontWeight: "700" },
		editBox: { gap: spacing.sm },
		keyInput: {
			minHeight: 44,
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.bgElevated,
			paddingHorizontal: spacing.md,
			color: c.text,
			fontSize: 14,
		},
		editActions: { flexDirection: "row", alignItems: "center", gap: spacing.md },
		saveButton: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.xs,
			minHeight: 36,
			paddingHorizontal: spacing.md,
			borderRadius: radius.md,
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: StyleSheet.hairlineWidth,
		},
		saveLabel: { ...typography.support, color: c.accent, fontWeight: "700" },
		cancelLabel: { ...typography.support, color: c.textMuted, fontWeight: "700" },
		keyUrlButton: {
			marginLeft: "auto",
			flexDirection: "row",
			alignItems: "center",
			gap: 3,
		},
		keyUrlLabel: { ...typography.support, color: c.textFaint, fontWeight: "600" },
		error: { ...typography.support, color: c.danger },
	});
