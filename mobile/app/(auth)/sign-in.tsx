import React, { useCallback, useEffect, useState } from "react";
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Platform,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";
import { Redirect, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useAuth, useSignIn, useSSO } from "@clerk/clerk-expo";
import { AccentButton, BrandTitle, GhostButton, GlassCard, Screen } from "@/components/ui";
import { colors, fonts, radius, spacing } from "@/theme";

WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
	const { isSignedIn, isLoaded: authLoaded } = useAuth();
	const { signIn, setActive, isLoaded } = useSignIn();
	const { startSSOFlow } = useSSO();
	const router = useRouter();

	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		WebBrowser.warmUpAsync().catch(() => {});
		return () => {
			WebBrowser.coolDownAsync().catch(() => {});
		};
	}, []);

	const onGoogle = useCallback(async () => {
		setError(null);
		setPending(true);
		try {
			const { createdSessionId, setActive: setActiveSSO } = await startSSOFlow({
				strategy: "oauth_google",
			});
			if (createdSessionId && setActiveSSO) {
				await setActiveSSO({ session: createdSessionId });
				router.replace("/");
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Google sign-in failed.");
		} finally {
			setPending(false);
		}
	}, [startSSOFlow, router]);

	const onEmailSignIn = useCallback(async () => {
		if (!isLoaded || !email.trim() || !password) return;
		setError(null);
		setPending(true);
		try {
			const attempt = await signIn.create({ identifier: email.trim(), password });
			if (attempt.status === "complete") {
				await setActive({ session: attempt.createdSessionId });
				router.replace("/");
			} else {
				setError("Additional verification is required. Please sign in on the web once, or use Google.");
			}
		} catch (err) {
			const message =
				err && typeof err === "object" && "errors" in err
					? ((err as { errors?: { message?: string }[] }).errors?.[0]?.message ?? "Sign-in failed.")
					: "Sign-in failed.";
			setError(message);
		} finally {
			setPending(false);
		}
	}, [isLoaded, email, password, signIn, setActive, router]);

	if (authLoaded && isSignedIn) return <Redirect href="/" />;

	return (
		<Screen edges={["top", "bottom"]}>
			<KeyboardAvoidingView
				behavior={Platform.OS === "ios" ? "padding" : undefined}
				style={styles.container}
			>
				<View style={styles.hero}>
					<BrandTitle size={52} />
					<Text style={styles.tagline}>
						Study the Scriptures with a companion that believes them.
					</Text>
				</View>

				<GlassCard style={styles.card}>
					<Text style={styles.label}>Email</Text>
					<TextInput
						value={email}
						onChangeText={setEmail}
						autoCapitalize="none"
						autoComplete="email"
						keyboardType="email-address"
						placeholder="you@example.com"
						placeholderTextColor={colors.textGhost}
						style={styles.input}
					/>
					<Text style={styles.label}>Password</Text>
					<TextInput
						value={password}
						onChangeText={setPassword}
						secureTextEntry
						autoComplete="password"
						placeholder="••••••••"
						placeholderTextColor={colors.textGhost}
						style={styles.input}
						onSubmitEditing={onEmailSignIn}
					/>

					{error && <Text style={styles.error}>{error}</Text>}

					{pending ? (
						<ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} />
					) : (
						<>
							<AccentButton label="Sign in" onPress={onEmailSignIn} style={{ marginTop: spacing.md }} />
							<View style={styles.dividerRow}>
								<View style={styles.divider} />
								<Text style={styles.dividerLabel}>or</Text>
								<View style={styles.divider} />
							</View>
							<GhostButton label="Continue with Google" onPress={onGoogle} />
						</>
					)}
				</GlassCard>

				<Text style={styles.verse}>
					{"“"}Thy word is a lamp unto my feet, and a light unto my path.{"”"}
				</Text>
				<Text style={styles.verseRef}>Psalm 119:105</Text>
			</KeyboardAvoidingView>
		</Screen>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		justifyContent: "center",
		paddingHorizontal: spacing.xl,
	},
	hero: { alignItems: "center", marginBottom: spacing.xxl },
	tagline: {
		color: colors.textMuted,
		fontSize: 14,
		marginTop: spacing.sm,
		textAlign: "center",
	},
	card: { padding: spacing.xl },
	label: {
		color: colors.textFaint,
		fontSize: 12,
		fontWeight: "600",
		textTransform: "uppercase",
		letterSpacing: 0.8,
		marginBottom: spacing.xs,
		marginTop: spacing.md,
	},
	input: {
		minHeight: 48,
		borderRadius: radius.md,
		backgroundColor: colors.surface,
		borderColor: colors.border,
		borderWidth: StyleSheet.hairlineWidth,
		color: colors.text,
		paddingHorizontal: spacing.lg,
		fontSize: 15,
	},
	error: {
		color: colors.danger,
		fontSize: 13,
		marginTop: spacing.md,
	},
	dividerRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: spacing.md,
		marginVertical: spacing.lg,
	},
	divider: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
	dividerLabel: { color: colors.textGhost, fontSize: 12 },
	verse: {
		fontFamily: fonts.verseItalic,
		color: colors.textMuted,
		fontSize: 19,
		textAlign: "center",
		marginTop: spacing.xxl,
		paddingHorizontal: spacing.xl,
	},
	verseRef: {
		color: colors.textGhost,
		fontSize: 12,
		textAlign: "center",
		marginTop: spacing.xs,
	},
});
