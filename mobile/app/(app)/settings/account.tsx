import React from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { useAuth, useUser } from "@clerk/expo";
import { AppText as Text } from "@/components/AppText";
import { GlassCard } from "@/components/ui";
import { radius, spacing, typography, type Colors } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";
import {
	SettingsAvatar,
	SettingsSubScreen,
	useSettingsStyles,
} from "@/features/settings/SettingsChrome";

/** The first card carries no label, so it needs the label's own top offset. */
const contentStyle = { paddingTop: spacing.xl };

/** Who is signed in, and the way out. */
export default function AccountSettingsScreen() {
	const { signOut } = useAuth();
	const { user } = useUser();
	const styles = useSettingsStyles();
	const local = useThemedStyles(createStyles);

	const email = user?.primaryEmailAddress?.emailAddress ?? "";
	const name = user?.fullName ?? user?.username ?? "";

	const confirmSignOut = () => {
		Alert.alert("Sign out?", "You can sign back in at any time.", [
			{ text: "Cancel", style: "cancel" },
			{ text: "Sign out", style: "destructive", onPress: () => void signOut() },
		]);
	};

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
			</GlassCard>
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
	});
