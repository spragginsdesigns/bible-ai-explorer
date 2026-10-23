import React, { useCallback, useEffect, useState } from "react";
import {
	ActivityIndicator,
	BackHandler,
	KeyboardAvoidingView,
	ScrollView,
	StyleSheet,
	View,
} from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { typography } from "@/theme";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { useAuth, useSSO } from "@clerk/expo";
// @clerk/expo 3.x reshaped the root useSignIn/useSignUp into the signal-based
// API (SignInFutureResource). The flows below are written against the original
// resource API, which the package still ships under /legacy.
import { useSignIn, useSignUp } from "@clerk/expo/legacy";
import { AccentButton, BrandTitle, GhostButton, GlassCard, Screen } from "@/components/ui";
import { fonts, radius, spacing, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { ANALYTICS_EVENTS, track } from "@/lib/analytics";
import {
	type AuthStep,
	clerkErrorCode,
	clerkErrorMessage,
	googleIncompleteMessage,
	MIN_PASSWORD_LENGTH,
	previousAuthStep,
	singleFlight,
} from "@/features/auth/authErrors";

WebBrowser.maybeCompleteAuthSession();

/**
 * The screens of the signed-out flow.
 *
 * `welcome` is the first page and offers the two doors separately, Create an
 * account and Sign in, with Continue with Google under both (closed-testing
 * feedback, 2026-10-22). Before 1.99.0 the first page was a bare email field
 * that could only sign in: a tester new to SureWord typed their address, was
 * told "Couldn't find your account", and had no way to make one except
 * guessing that Google would do it. PostHog showed 7 of the first tester
 * cohort hitting exactly that.
 */
type Step = AuthStep;

export default function SignInScreen() {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const { isSignedIn, isLoaded: authLoaded } = useAuth();
	const { signIn, setActive, isLoaded } = useSignIn();
	const { signUp, setActive: setActiveSignUp, isLoaded: signUpLoaded } = useSignUp();
	const { startSSOFlow } = useSSO();
	const router = useRouter();

	const [email, setEmail] = useState("");
	const [code, setCode] = useState("");
	const [password, setPassword] = useState("");
	const [step, setStep] = useState<Step>("welcome");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Set when an email sign-in finds no account, so the card can offer to
	// create one with the address already typed.
	const [offerSignUp, setOfferSignUp] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	// Every submit (button, keyboard Enter, Google, resend) runs through this,
	// so a second one while the first is in flight is dropped. See singleFlight.
	const [runOnce] = useState(singleFlight);

	// Any new message replaces the last one, whichever kind it was.
	useEffect(() => {
		if (error) setNotice(null);
	}, [error]);

	useEffect(() => {
		WebBrowser.warmUpAsync().catch(() => {});
		return () => {
			WebBrowser.coolDownAsync().catch(() => {});
		};
	}, []);

	const goTo = useCallback((next: Step) => {
		setStep(next);
		setCode("");
		setError(null);
		setNotice(null);
		setOfferSignUp(false);
		// Leaving for the email step means a different address, so the old
		// password must not ride along with it.
		if (next === "welcome" || next === "signInEmail") setPassword("");
	}, []);

	// Android's hardware Back steps back through the card instead of leaving
	// the app from the middle of a sign-in. On the first step it is not
	// handled, so Back behaves as it does anywhere else. While a request is in
	// flight it is swallowed, because the request would land on the wrong step.
	useFocusEffect(
		useCallback(() => {
			const sub = BackHandler.addEventListener("hardwareBackPress", () => {
				const previous = previousAuthStep(step);
				if (!previous) return false;
				if (!pending) goTo(previous);
				return true;
			});
			return () => sub.remove();
		}, [step, pending, goTo])
	);

	/**
	 * Clerk refuses to start a sign-in or sign-up while a session already
	 * exists on this device. That only happens when the person is in fact
	 * signed in and this screen is stale, so the right answer is to go in,
	 * not to show "session_exists" as an error (5 Android failures in the
	 * 2026-10-20 tester run were exactly this).
	 */
	const enterIfSessionExists = useCallback(
		(err: unknown) => {
			if (clerkErrorCode(err) !== "session_exists") return false;
			router.replace("/");
			return true;
		},
		[router]
	);

	const onGoogle = useCallback(() => runOnce(async () => {
		setError(null);
		setOfferSignUp(false);
		setPending(true);
		track(ANALYTICS_EVENTS.signInStarted, { method: "google" });
		try {
			const {
				createdSessionId,
				setActive: setActiveSSO,
				authSessionResult,
				signIn: ssoSignIn,
				signUp: ssoSignUp,
			} = await startSSOFlow({
				strategy: "oauth_google",
				// Native MUST pass an explicit scheme. Without redirectUrl, clerk-expo
				// falls back to makeRedirectUri() with no scheme, which does not
				// resolve to sureword:// in a standalone build. Clerk then finds the
				// requested redirect is not in the instance allowlist and silently
				// omits external_verification_redirect_url, which surfaces only as
				// "Missing external verification redirect URL for SSO flow".
				// This URL must stay in sync with Clerk's allowed redirect URLs.
				redirectUrl: AuthSession.makeRedirectUri({
					scheme: "sureword",
					path: "sso-callback",
				}),
			});
			if (createdSessionId && setActiveSSO) {
				await setActiveSSO({ session: createdSessionId });
				track(ANALYTICS_EVENTS.signInCompleted, { method: "google" });
				router.replace("/");
				return;
			}
			// No session. Until 1.99.0 every one of these was recorded as the
			// person closing the browser and nothing was shown, which is how a
			// tester could tap Google, pick an account, land back here and see
			// nothing at all. Three different things end up here, and only the
			// first one is really silent.
			if (authSessionResult && authSessionResult.type !== "success") {
				track(ANALYTICS_EVENTS.signInFailed, { method: "google", reason: "abandoned" });
				return;
			}
			if (!authSessionResult) {
				// useSSO returns early, before opening any browser, while the
				// Clerk sign-in/sign-up resources are still loading.
				track(ANALYTICS_EVENTS.signInFailed, { method: "google", reason: "not_loaded" });
				setError("SureWord is still connecting. Give it a moment and tap Continue with Google again.");
				return;
			}
			// Google came back, but Clerk wants one more step before it will
			// make a session (an account that needs a field Google did not
			// share, or a second factor).
			const status = ssoSignUp?.status ?? ssoSignIn?.status ?? "unknown";
			track(ANALYTICS_EVENTS.signInFailed, {
				method: "google",
				reason: `incomplete_${status}`,
			});
			setError(googleIncompleteMessage(ssoSignUp?.missingFields ?? []));
		} catch (err) {
			if (enterIfSessionExists(err)) return;
			track(ANALYTICS_EVENTS.signInFailed, {
				method: "google",
				reason: clerkErrorCode(err),
			});
			setError(clerkErrorMessage(err, "Google sign-in failed. Please try again."));
		} finally {
			setPending(false);
		}
	}), [runOnce, startSSOFlow, router, enterIfSessionExists]);

	// Sends the emailed one-time code for the account already looked up by
	// onContinue. Also the fallback for password accounts ("email me a code").
	const sendEmailCode = useCallback(async () => {
		if (!signIn) return false;
		const factor = signIn.supportedFirstFactors?.find((f) => f.strategy === "email_code");
		if (!factor || !("emailAddressId" in factor)) {
			setError("This account cannot sign in with an email code. Try Google instead.");
			return false;
		}
		await signIn.prepareFirstFactor({
			strategy: "email_code",
			emailAddressId: factor.emailAddressId,
		});
		return true;
	}, [signIn]);

	// Sign in: an account with a password (every account made with Create an
	// account, and the Play review demo account) is asked for it; one made
	// through Google without a password gets an emailed one-time code.
	const onContinue = useCallback(() => runOnce(async () => {
		if (!isLoaded || !email.trim()) return;
		setError(null);
		setOfferSignUp(false);
		setPending(true);
		track(ANALYTICS_EVENTS.signInStarted, { method: "email" });
		try {
			const attempt = await signIn.create({ identifier: email.trim() });
			const hasPassword = attempt.supportedFirstFactors?.some(
				(f) => f.strategy === "password"
			);
			if (hasPassword) {
				setStep("signInPassword");
			} else if (await sendEmailCode()) {
				setStep("signInCode");
			}
		} catch (err) {
			if (enterIfSessionExists(err)) return;
			const reason = clerkErrorCode(err);
			track(ANALYTICS_EVENTS.signInFailed, {
				method: "email",
				reason,
				step: "lookup",
			});
			if (reason === "form_identifier_not_found") {
				setOfferSignUp(true);
				setError("There's no SureWord account with that email yet.");
			} else {
				setError(clerkErrorMessage(err, "We couldn't find that account."));
			}
		} finally {
			setPending(false);
		}
	}), [runOnce, isLoaded, email, signIn, sendEmailCode, enterIfSessionExists]);

	const onVerifyPassword = useCallback(() => runOnce(async () => {
		if (!isLoaded || !password) return;
		setError(null);
		setPending(true);
		try {
			const attempt = await signIn.attemptFirstFactor({
				strategy: "password",
				password,
			});
			if (attempt.status === "complete") {
				await setActive({ session: attempt.createdSessionId });
				track(ANALYTICS_EVENTS.signInCompleted, { method: "password" });
				router.replace("/");
			} else {
				track(ANALYTICS_EVENTS.signInFailed, {
					method: "password",
					reason: `incomplete_${attempt.status ?? "unknown"}`,
				});
				setError("That password didn't complete the sign-in. Try again.");
			}
		} catch (err) {
			if (enterIfSessionExists(err)) return;
			track(ANALYTICS_EVENTS.signInFailed, {
				method: "password",
				reason: clerkErrorCode(err),
			});
			setError(clerkErrorMessage(err, "That password is incorrect."));
		} finally {
			setPending(false);
		}
	}), [runOnce, isLoaded, password, signIn, setActive, router, enterIfSessionExists]);

	const onCodeInstead = useCallback(() => runOnce(async () => {
		setError(null);
		setPending(true);
		try {
			if (await sendEmailCode()) setStep("signInCode");
		} catch (err) {
			setError(clerkErrorMessage(err, "We couldn't send a code to that account."));
		} finally {
			setPending(false);
		}
	}), [runOnce, sendEmailCode]);

	const onVerifyCode = useCallback(() => runOnce(async () => {
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
				track(ANALYTICS_EVENTS.signInCompleted, { method: "email_code" });
				router.replace("/");
			} else {
				track(ANALYTICS_EVENTS.signInFailed, {
					method: "email_code",
					reason: `incomplete_${attempt.status ?? "unknown"}`,
				});
				setError("That code didn't complete the sign-in. Request a new one and try again.");
			}
		} catch (err) {
			if (enterIfSessionExists(err)) return;
			track(ANALYTICS_EVENTS.signInFailed, {
				method: "email_code",
				reason: clerkErrorCode(err),
			});
			setError(clerkErrorMessage(err, "That code is incorrect or has expired."));
		} finally {
			setPending(false);
		}
	}), [runOnce, isLoaded, code, signIn, setActive, router, enterIfSessionExists]);

	// Create an account: email + password (the Clerk instance requires a
	// password for email sign-ups), then the emailed 6-digit code proves the
	// address. Same instance and allowlists as web's /sign-up.
	const onCreateAccount = useCallback(() => runOnce(async () => {
		if (!signUpLoaded || !email.trim()) return;
		if (password.length < MIN_PASSWORD_LENGTH) {
			setError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
			return;
		}
		setError(null);
		setPending(true);
		track(ANALYTICS_EVENTS.signInStarted, { method: "email_signup" });
		try {
			await signUp.create({ emailAddress: email.trim(), password });
			await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
			setStep("signUpCode");
		} catch (err) {
			if (enterIfSessionExists(err)) return;
			const reason = clerkErrorCode(err);
			track(ANALYTICS_EVENTS.signInFailed, {
				method: "email_signup",
				reason,
				step: "create",
			});
			if (reason === "form_identifier_exists") {
				// They already have an account. Send them to Sign in with the
				// address kept rather than leaving them stuck on a dead end.
				setStep("signInEmail");
				setPassword("");
				setError("You already have an account with that email. Sign in below.");
			} else {
				setError(clerkErrorMessage(err, "We couldn't create that account."));
			}
		} finally {
			setPending(false);
		}
	}), [runOnce, signUpLoaded, email, password, signUp, enterIfSessionExists]);

	const onVerifySignUpCode = useCallback(() => runOnce(async () => {
		if (!signUpLoaded || code.trim().length < 6) return;
		setError(null);
		setPending(true);
		try {
			const attempt = await signUp.attemptEmailAddressVerification({ code: code.trim() });
			if (attempt.status === "complete" && attempt.createdSessionId) {
				await setActiveSignUp({ session: attempt.createdSessionId });
				track(ANALYTICS_EVENTS.signInCompleted, { method: "email_signup" });
				router.replace("/");
			} else {
				track(ANALYTICS_EVENTS.signInFailed, {
					method: "email_signup",
					reason: `incomplete_${attempt.status ?? "unknown"}`,
					step: "verify",
				});
				setError(
					attempt.missingFields.length > 0
						? `Your account still needs: ${attempt.missingFields.join(", ").replace(/_/g, " ")}.`
						: "That code didn't finish creating your account. Request a new one and try again."
				);
			}
		} catch (err) {
			if (enterIfSessionExists(err)) return;
			track(ANALYTICS_EVENTS.signInFailed, {
				method: "email_signup",
				reason: clerkErrorCode(err),
				step: "verify",
			});
			setError(clerkErrorMessage(err, "That code is incorrect or has expired."));
		} finally {
			setPending(false);
		}
	}), [runOnce, signUpLoaded, code, signUp, setActiveSignUp, router, enterIfSessionExists]);

	const onResendSignUpCode = useCallback(() => runOnce(async () => {
		setError(null);
		setPending(true);
		try {
			await signUp?.prepareEmailAddressVerification({ strategy: "email_code" });
			setCode("");
			setNotice("We sent a new code.");
		} catch (err) {
			setError(clerkErrorMessage(err, "We couldn't send a new code."));
		} finally {
			setPending(false);
		}
	}), [runOnce, signUp]);

	if (authLoaded && isSignedIn) return <Redirect href="/" />;

	const spinner = (
		<ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} />
	);
	const errorText = error ? (
		<Text style={styles.error}>{error}</Text>
	) : notice ? (
		<Text style={[styles.error, { color: colors.textSecondary }]}>{notice}</Text>
	) : null;
	const googleBlock = (
		<>
			<View style={styles.dividerRow}>
				<View style={styles.divider} />
				<Text style={styles.dividerLabel}>or</Text>
				<View style={styles.divider} />
			</View>
			<GhostButton label="Continue with Google" onPress={onGoogle} />
		</>
	);
	const emailField = (onSubmit: () => void) => (
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
				onSubmitEditing={onSubmit}
				testID="auth-email"
			/>
		</>
	);
	const codeField = (onSubmit: () => void) => (
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
				onSubmitEditing={onSubmit}
				autoFocus
				testID="auth-code"
			/>
		</>
	);

	let card: React.ReactNode;
	if (step === "welcome") {
		card = (
			<>
				<Text style={styles.cardTitle}>Welcome to SureWord</Text>
				<Text style={styles.codeHint}>New here? Create a free account. Already have one? Sign in.</Text>
				{errorText}
				{pending ? (
					spinner
				) : (
					<>
						<AccentButton
							label="Create an account"
							onPress={() => goTo("signUp")}
							style={{ marginTop: spacing.lg }}
							testID="auth-create-account"
						/>
						<GhostButton
							label="Sign in"
							onPress={() => goTo("signInEmail")}
							style={{ marginTop: spacing.md }}
							testID="auth-sign-in"
						/>
						{googleBlock}
						<Text style={styles.footnote}>
							Google works for new and existing accounts.
						</Text>
					</>
				)}
			</>
		);
	} else if (step === "signInEmail") {
		card = (
			<>
				<Text style={styles.cardTitle}>Sign in</Text>
				{emailField(onContinue)}
				{errorText}
				{pending ? (
					spinner
				) : (
					<>
						{offerSignUp ? (
							<AccentButton
								label="Create an account with this email"
								onPress={() => {
									setStep("signUp");
									setError(null);
									setOfferSignUp(false);
								}}
								style={{ marginTop: spacing.lg }}
							/>
						) : (
							<AccentButton
								label="Continue"
								onPress={onContinue}
								style={{ marginTop: spacing.lg }}
							/>
						)}
						{offerSignUp && (
							<GhostButton
								label="Try a different email"
								onPress={() => {
									setEmail("");
									setError(null);
									setOfferSignUp(false);
								}}
								style={{ marginTop: spacing.md }}
							/>
						)}
						{googleBlock}
						<GhostButton
							label="Back"
							onPress={() => goTo("welcome")}
							style={styles.backButton}
						/>
					</>
				)}
			</>
		);
	} else if (step === "signInPassword") {
		card = (
			<>
				<Text style={styles.codeHint}>
					Enter the password for{" "}
					<Text style={{ color: colors.textSecondary }}>{email.trim()}</Text>
				</Text>
				<Text style={styles.label}>Password</Text>
				<TextInput
					value={password}
					onChangeText={setPassword}
					autoCapitalize="none"
					autoComplete="current-password"
					secureTextEntry
					placeholder="••••••••"
					placeholderTextColor={colors.textGhost}
					style={styles.input}
					onSubmitEditing={onVerifyPassword}
					autoFocus
				/>
				{errorText}
				{pending ? (
					spinner
				) : (
					<>
						<AccentButton
							label="Sign in"
							onPress={onVerifyPassword}
							style={{ marginTop: spacing.lg }}
						/>
						<GhostButton
							label="Email me a code instead"
							onPress={onCodeInstead}
							style={{ marginTop: spacing.md }}
						/>
						<GhostButton
							label="Use a different email"
							onPress={() => goTo("signInEmail")}
							style={{ marginTop: spacing.md }}
						/>
					</>
				)}
			</>
		);
	} else if (step === "signInCode") {
		card = (
			<>
				{codeField(onVerifyCode)}
				{errorText}
				{pending ? (
					spinner
				) : (
					<>
						<AccentButton
							label="Sign in"
							onPress={onVerifyCode}
							style={{ marginTop: spacing.lg }}
						/>
						<GhostButton
							label="Use a different email"
							onPress={() => goTo("signInEmail")}
							style={{ marginTop: spacing.md }}
						/>
					</>
				)}
			</>
		);
	} else if (step === "signUp") {
		card = (
			<>
				<Text style={styles.cardTitle}>Create your account</Text>
				{emailField(onCreateAccount)}
				<Text style={styles.label}>Password</Text>
				<TextInput
					value={password}
					onChangeText={setPassword}
					autoCapitalize="none"
					autoComplete="new-password"
					secureTextEntry
					placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
					placeholderTextColor={colors.textGhost}
					style={styles.input}
					onSubmitEditing={onCreateAccount}
					testID="auth-new-password"
				/>
				{errorText}
				{pending ? (
					spinner
				) : (
					<>
						<AccentButton
							label="Create account"
							onPress={onCreateAccount}
							style={{ marginTop: spacing.lg }}
							testID="auth-create-submit"
						/>
						<Text style={styles.footnote}>
							We'll email you a 6-digit code to confirm it's you.
						</Text>
						{googleBlock}
						<GhostButton
							label="Back"
							onPress={() => goTo("welcome")}
							style={styles.backButton}
						/>
					</>
				)}
			</>
		);
	} else {
		card = (
			<>
				{codeField(onVerifySignUpCode)}
				{errorText}
				{pending ? (
					spinner
				) : (
					<>
						<AccentButton
							label="Confirm and continue"
							onPress={onVerifySignUpCode}
							style={{ marginTop: spacing.lg }}
						/>
						<GhostButton
							label="Send a new code"
							onPress={onResendSignUpCode}
							style={{ marginTop: spacing.md }}
						/>
						<GhostButton
							label="Use a different email"
							onPress={() => goTo("signUp")}
							style={{ marginTop: spacing.md }}
						/>
					</>
				)}
			</>
		);
	}

	return (
		<Screen edges={["top", "bottom"]}>
			<KeyboardAvoidingView behavior="padding" style={styles.fill}>
				{/* Centred while it fits, scrollable once the keyboard squeezes it: the
				    hero used to be pushed up under the status bar on the password step
				    rather than moving out of the way. */}
				<ScrollView
					contentContainerStyle={styles.container}
					keyboardShouldPersistTaps="handled"
					showsVerticalScrollIndicator={false}
				>
					<View style={styles.hero}>
						<BrandTitle size={52} />
						<Text style={styles.tagline}>
							Study the Scriptures with a companion that believes them.
						</Text>
					</View>

					<GlassCard style={styles.card}>{card}</GlassCard>

					<Text style={styles.verse}>
						{"“"}Thy word is a lamp unto my feet, and a light unto my path.{"”"}
					</Text>
					<Text style={styles.verseRef}>Psalm 119:105</Text>
				</ScrollView>
			</KeyboardAvoidingView>
		</Screen>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		fill: { flex: 1 },
		container: {
			flexGrow: 1,
			justifyContent: "center",
			paddingHorizontal: spacing.xl,
			paddingVertical: spacing.lg,
		},
		hero: { alignItems: "center", marginBottom: spacing.xl },
		tagline: {
			color: c.textMuted,
			...typography.support,
			marginTop: spacing.sm,
			textAlign: "center",
		},
		card: { padding: spacing.xl },
		cardTitle: {
			color: c.text,
			...typography.control,
			fontWeight: "700",
			fontSize: 18,
			marginBottom: spacing.xs,
		},
		label: {
			color: c.textFaint,
			...typography.control,
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
			...typography.control,
		},
		codeInput: {
			...typography.control,
			fontFamily: fonts.mono,
			letterSpacing: 12,
			textAlign: "center",
		},
		codeHint: {
			color: c.textMuted,
			...typography.support,
		},
		footnote: {
			color: c.textGhost,
			...typography.meta,
			textAlign: "center",
			marginTop: spacing.md,
		},
		error: {
			color: c.danger,
			...typography.support,
			marginTop: spacing.md,
		},
		backButton: { marginTop: spacing.lg },
		dividerRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			marginVertical: spacing.lg,
		},
		divider: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.borderStrong },
		dividerLabel: { color: c.textGhost, ...typography.micro },
		verse: {
			fontFamily: fonts.verseItalic,
			color: c.textMuted,
			...typography.chat,
			textAlign: "center",
			marginTop: spacing.xxl,
			paddingHorizontal: spacing.xl,
		},
		verseRef: {
			color: c.textGhost,
			...typography.meta,
			textAlign: "center",
			marginTop: spacing.xs,
		},
	});
