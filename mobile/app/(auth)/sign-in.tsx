import React, { useCallback, useEffect, useState } from "react";
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";
import { Redirect, useRouter } from "expo-router";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { useAuth, useSSO } from "@clerk/expo";
// @clerk/expo 3.x reshaped the root useSignIn into the signal-based API
// (SignInFutureResource). The email-code flow below is written against the
// original resource API, which the package still ships under /legacy.
import { useSignIn } from "@clerk/expo/legacy";
import { AccentButton, BrandTitle, GhostButton, GlassCard, Screen } from "@/components/ui";
import { fonts, radius, spacing, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";

WebBrowser.maybeCompleteAuthSession();

function clerkErrorMessage(err: unknown, fallback: string): string {
	if (err && typeof err === "object" && "errors" in err) {
		const first = (err as { errors?: { longMessage?: string; message?: string }[] }).errors?.[0];
		return first?.longMessage ?? first?.message ?? fallback;
	}
	return err instanceof Error ? err.message : fallback;
}

export default function SignInScreen() {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const { isSignedIn, isLoaded: authLoaded } = useAuth();
	const { signIn, setActive, isLoaded } = useSignIn();
	const { startSSOFlow } = useSSO();
	const router = useRouter();

	const [email, setEmail] = useState("");
	const [code, setCode] = useState("");
	const [step, setStep] = useState<"email" | "code">("email");
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
				// Native MUST pass an explicit scheme. Without redirectUrl, clerk-expo
				// falls back to makeRedirectUri() with no scheme, which does not
				// resolve to versemind:// in a standalone build. Clerk then finds the
				// requested redirect is not in the instance allowlist and silently
				// omits external_verification_redirect_url, which surfaces only as
				// "Missing external verification redirect URL for SSO flow".
				// This URL must stay in sync with Clerk's allowed redirect URLs.
				redirectUrl: AuthSession.makeRedirectUri({
					scheme: "versemind",
					path: "sso-callback",
				}),
			});
			if (createdSessionId && setActiveSSO) {
				await setActiveSSO({ session: createdSessionId });
				router.replace("/");
			}
		} catch (err) {
			setError(clerkErrorMessage(err, "Google sign-in failed."));
		} finally {
			setPending(false);
		}
	}, [startSSOFlow, router]);

	// The Clerk instance signs in with an emailed one-time code (plus Google).
	const onSendCode = useCallback(async () => {
		if (!isLoaded || !email.trim()) return;
		setError(null);
		setPending(true);
		try {
			const attempt = await signIn.create({ identifier: email.trim() });
			const factor = attempt.supportedFirstFactors?.find(
				(f) => f.strategy === "email_code"
			);
			if (!factor || !("emailAddressId" in factor)) {
				setError("This account cannot sign in with an email code. Try Google instead.");
				return;
			}
			await signIn.prepareFirstFactor({
				strategy: "email_code",
				emailAddressId: factor.emailAddressId,
			});
			setStep("code");
		} catch (err) {
			setError(clerkErrorMessage(err, "We couldn't find that account."));
		} finally {
			setPending(false);
		}
	}, [isLoaded, email, signIn]);

	const onVerifyCode = useCallback(async () => {
		if (!isLoaded || code.trim().length < 6) return;
		setError(null);
		setPending(true);
		try {
			const attempt = await signIn.attemptFirstFactor({
				strategy: "email_code",
				code: code.trim(),
			});
			if (attempt.status === "complete") {
				await setActive({ session: attempt.createdSessionId });
				router.replace("/");
			} else {
				setError("That code didn't complete the sign-in. Request a new one and try again.");
			}
		} catch (err) {
			setError(clerkErrorMessage(err, "That code is incorrect or has expired."));
		} finally {
			setPending(false);
		}
	}, [isLoaded, code, signIn, setActive, router]);

	const onBackToEmail = useCallback(() => {
		setStep("email");
		setCode("");
		setError(null);
	}, []);

	if (authLoaded && isSignedIn) return <Redirect href="/" />;

	return (
		<Screen edges={["top", "bottom"]}>
			<KeyboardAvoidingView behavior="padding" style={styles.container}>
				<View style={styles.hero}>
					<BrandTitle size={52} />
					<Text style={styles.tagline}>
						Study the Scriptures with a companion that believes them.
					</Text>
				</View>

				<GlassCard style={styles.card}>
					{step === "email" ? (
						<>
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
								onSubmitEditing={onSendCode}
							/>

							{error && <Text style={styles.error}>{error}</Text>}

							{pending ? (
								<ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} />
							) : (
								<>
									<AccentButton
										label="Email me a sign-in code"
										onPress={onSendCode}
										style={{ marginTop: spacing.lg }}
									/>
									<View style={styles.dividerRow}>
										<View style={styles.divider} />
										<Text style={styles.dividerLabel}>or</Text>
										<View style={styles.divider} />
									</View>
									<GhostButton label="Continue with Google" onPress={onGoogle} />
								</>
							)}
						</>
					) : (
						<>
							<Text style={styles.codeHint}>
								We sent a 6-digit code to{" "}
								<Text style={{ color: colors.textSecondary }}>{email.trim()}</Text>
							</Text>
							<Text style={styles.label}>Code</Text>
							<TextInput
								value={code}
								onChangeText={setCode}
								autoCapitalize="none"
								keyboardType="number-pad"
								maxLength={6}
								placeholder="••••••"
								placeholderTextColor={colors.textGhost}
								style={[styles.input, styles.codeInput]}
								onSubmitEditing={onVerifyCode}
								autoFocus
							/>

							{error && <Text style={styles.error}>{error}</Text>}

							{pending ? (
								<ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} />
							) : (
								<>
									<AccentButton
										label="Sign in"
										onPress={onVerifyCode}
										style={{ marginTop: spacing.lg }}
									/>
									<GhostButton
										label="Use a different email"
										onPress={onBackToEmail}
										style={{ marginTop: spacing.md }}
									/>
								</>
							)}
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

const createStyles = (c: Colors) =>
	StyleSheet.create({
		container: {
			flex: 1,
			justifyContent: "center",
			paddingHorizontal: spacing.xl,
		},
		hero: { alignItems: "center", marginBottom: spacing.xxl },
		tagline: {
			color: c.textMuted,
			fontSize: 14,
			marginTop: spacing.sm,
			textAlign: "center",
		},
		card: { padding: spacing.xl },
		label: {
			color: c.textFaint,
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
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			color: c.text,
			paddingHorizontal: spacing.lg,
			fontSize: 15,
		},
		codeInput: {
			fontSize: 22,
			letterSpacing: 12,
			textAlign: "center",
		},
		codeHint: {
			color: c.textMuted,
			fontSize: 13,
			lineHeight: 19,
		},
		error: {
			color: c.danger,
			fontSize: 13,
			marginTop: spacing.md,
		},
		dividerRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			marginVertical: spacing.lg,
		},
		divider: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.borderStrong },
		dividerLabel: { color: c.textGhost, fontSize: 12 },
		verse: {
			fontFamily: fonts.verseItalic,
			color: c.textMuted,
			fontSize: 19,
			textAlign: "center",
			marginTop: spacing.xxl,
			paddingHorizontal: spacing.xl,
		},
		verseRef: {
			color: c.textGhost,
			fontSize: 12,
			textAlign: "center",
			marginTop: spacing.xs,
		},
	});
