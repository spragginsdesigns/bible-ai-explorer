import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text } from "@/components/AppText";
import type { ChoiceCardView } from "@/lib/chatView";
import { radius, spacing, typography, type Colors } from "@/theme";
import { useTextScaleFactor, useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { useSettingsData } from "@/features/settings/settingsData";
import { ChurchSection } from "@/features/church/ChurchSection";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { TEXT_SCALE_FACTORS, textScaleForLabel } from "@/features/settings/textScale";
import { useOnboardingChat } from "./OnboardingChatContext";
import { hourLabel } from "./dailyTime";
import { GlossarySheet } from "./GlossarySheet";
import { questionSegments, type GlossaryTerm } from "./onboardingRules";
import { useVoiceControls } from "@/features/voice/VoiceControlProvider";
import { useIsFocused } from "expo-router";

/** Big enough for any thumb and any eyes (docs/onboarding/PLAN.md: at least 56dp). */
const MIN_TAP_HEIGHT = 56;

/** "Pick a time" opens these, morning first. */
const PICKABLE_HOURS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

/**
 * Walk with me's tap-to-answer card, under SureWord's message: the scripted
 * question, full-width answers, "Type my own", and a quiet way past it.
 * Only the newest card is live; an answered one stays as a record of the
 * question and cannot be tapped again.
 */
export function ChoiceCard({ card, live }: { card: ChoiceCardView; live: boolean }) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const actions = useOnboardingChat();
	const voice = useVoiceControls();
	const focused = useIsFocused();
	const registerCard = voice?.registerCard;
	const speak = voice?.speak;
	// Answered stays answered: a second tap before the reply appears would
	// repeat the step's device action and its analytics.
	const [answered, setAnswered] = useState(false);
	const interactive = live && actions !== null && !answered;
	const [pickingHour, setPickingHour] = useState(false);
	const [speakHint, setSpeakHint] = useState(false);
	const [openTerm, setOpenTerm] = useState<GlossaryTerm | null>(null);
	// The church search can be unavailable (no Places key), so typing the name is always offered.
	const allowOther = card.allowOther || card.step === "church";

	const answeredRef = useRef(false);
	const answer = useCallback((label: string) => {
		if (!interactive || answeredRef.current) return;
		answeredRef.current = true;
		setAnswered(true);
		return actions.answer(card, label);
	}, [interactive, actions, card]);
	const choose = useCallback(async (label: string) => {
		if (label === "Pick a time") {
			setPickingHour(true);
			await speak?.(`Choose a time. ${PICKABLE_HOURS.map((hour, index) => `Option ${index + 1}. ${hourLabel(hour)}.`).join(" ")} Or say ${card.skipLabel}.`);
			return;
		}
		return answer(label);
	}, [answer, speak, card.skipLabel]);
	const voiceOptions = useMemo(() => pickingHour ? [...PICKABLE_HOURS.map(hourLabel), card.skipLabel] : [...card.options, card.skipLabel], [pickingHour, card.options, card.skipLabel]);
	useEffect(() => {
		if (!interactive || !focused || !registerCard) return;
		return registerCard({ question: card.question, options: voiceOptions, allowOther, choose, ask: actions ? (text) => actions.ask(card, text) : undefined });
	}, [interactive, focused, registerCard, card, actions, voiceOptions, choose, allowOther]);

	return (
		<View style={styles.card} accessibilityRole="none">
			<Text style={styles.question}>
				{questionSegments(card.question, card.terms).map((segment, index) =>
					segment.term ? (
						<Text
							key={index}
							accessibilityRole="link"
							accessibilityHint="Explains what this means from Scripture"
							onPress={() => setOpenTerm(segment.term ?? null)}
							suppressHighlighting={false}
							style={styles.term}
						>
							{segment.text}
						</Text>
					) : (
						segment.text
					)
				)}
			</Text>
			{/* Only a card with a tappable word carries the sheet. */}
			{card.terms.length > 0 ? (
				<GlossarySheet
					term={openTerm}
					onClose={() => setOpenTerm(null)}
					onAsk={
						interactive
							? (question) => {
									setOpenTerm(null);
									setAnswered(true);
									actions.ask(card, question);
								}
							: undefined
					}
				/>
			) : null}

			{card.step === "church" && interactive ? <ChurchStep onSaved={(name) => answer(`I saved ${name} as my home church.`)} /> : null}

			<View style={styles.options}>
				{card.options.map((option) => {
					if (option === "Pick a time") {
						return (
							<OptionButton
								key={option}
								label={option}
								disabled={!interactive}
									onPress={() => choose(option)}
							/>
						);
					}
					const scale = card.step === "textScale" ? textScaleForLabel(option) : null;
					return (
						<OptionButton
							key={option}
							label={option}
							disabled={!interactive}
							// Each size previews itself, so the choice is made by looking.
							fontScale={scale ? TEXT_SCALE_FACTORS[scale] : undefined}
								onPress={() => choose(option)}
						/>
					);
				})}
			</View>

			{pickingHour && interactive ? (
				<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hours}>
					{PICKABLE_HOURS.map((hour) => (
						<Pressable
							key={hour}
							accessibilityRole="button"
							onPress={() => answer(hourLabel(hour))}
							style={({ pressed }) => [styles.hourChip, pressed && styles.pressed]}
						>
							<Text style={styles.hourText}>{hourLabel(hour)}</Text>
						</Pressable>
					))}
				</ScrollView>
			) : null}

			{interactive ? (
				<View style={styles.footer}>
					{allowOther ? (
						<>
							<Pressable
								accessibilityRole="button"
								onPress={() => {
									setSpeakHint(false);
									actions.typeOwn(card);
								}}
								style={({ pressed }) => [styles.footerButton, pressed && styles.pressed]}
							>
								<Ionicons name="create-outline" size={18} color={colors.accent} />
								<Text style={styles.footerText}>Type my own</Text>
							</Pressable>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel="Answer by speaking"
								onPress={() => {
									setSpeakHint(true);
									actions.typeOwn(card);
								}}
								style={({ pressed }) => [styles.footerButton, pressed && styles.pressed]}
							>
								<Ionicons name="mic-outline" size={18} color={colors.accent} />
								<Text style={styles.footerText}>Speak</Text>
							</Pressable>
						</>
					) : null}
					<Pressable
						accessibilityRole="button"
						onPress={() => answer(card.skipLabel)}
						style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
					>
						<Text style={styles.skipText}>{card.skipLabel}</Text>
					</Pressable>
				</View>
			) : null}
			{speakHint && interactive ? (
				<Text style={styles.hint}>Tap the microphone on your keyboard and say your answer.</Text>
			) : null}
		</View>
	);
}

function OptionButton({
	label,
	disabled,
	fontScale,
	onPress,
}: {
	label: string;
	disabled: boolean;
	fontScale?: number;
	onPress: () => void;
}) {
	const styles = useThemedStyles(createStyles);
	// AppText already applies the current size, so a preview divides it back out.
	const current = useTextScaleFactor();
	const preview = fontScale ? fontScale / current : null;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ disabled }}
			disabled={disabled}
			onPress={onPress}
			style={({ pressed }) => [styles.option, disabled && styles.optionDisabled, pressed && styles.pressed]}
		>
			<Text style={[styles.optionText, preview ? { fontSize: 17 * preview, lineHeight: 24 * preview } : null]}>
				{label}
			</Text>
		</Pressable>
	);
}

/**
 * The church step searches inline with the same section Settings uses, and
 * answers for the reader as soon as a church is saved.
 */
function ChurchStep({ onSaved }: { onSaved: (name: string) => void }) {
	const getToken = useStableGetToken();
	const church = useSettingsData().church.data;
	const saved = church?.status === "ok" ? church.church : null;
	// The church they had before this card, read once the data has loaded, so
	// a saved church arriving late is not mistaken for one chosen here.
	const initial = useRef<string | null | undefined>(undefined);
	if (initial.current === undefined && church) initial.current = saved?.placeId ?? null;
	const sent = useRef(false);
	useEffect(() => {
		if (!saved || sent.current || initial.current === undefined || saved.placeId === initial.current) return;
		sent.current = true;
		onSaved(saved.name);
	}, [saved, onSaved]);
	return <ChurchSection getToken={getToken} hideHeading />;
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		card: {
			gap: spacing.md,
			marginTop: spacing.md,
			padding: spacing.lg,
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
			borderRadius: radius.lg,
		},
		question: { ...typography.body, color: c.text, fontWeight: "600" },
		term: { color: c.accent, textDecorationLine: "underline" },
		options: { gap: spacing.sm },
		option: {
			minHeight: MIN_TAP_HEIGHT,
			justifyContent: "center",
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
			borderRadius: radius.md,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.surface,
		},
		optionDisabled: { opacity: 0.55 },
		optionText: { fontSize: 17, lineHeight: 24, color: c.text },
		pressed: { backgroundColor: c.accentPressed },
		hours: { gap: spacing.sm, paddingVertical: spacing.xs },
		hourChip: {
			minHeight: MIN_TAP_HEIGHT,
			minWidth: 76,
			alignItems: "center",
			justifyContent: "center",
			paddingHorizontal: spacing.md,
			borderRadius: radius.md,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.surface,
		},
		hourText: { fontSize: 16, color: c.text },
		footer: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
		footerButton: {
			flexDirection: "row",
			alignItems: "center",
			gap: 6,
			minHeight: 48,
			paddingHorizontal: spacing.md,
			borderRadius: radius.md,
		},
		footerText: { fontSize: 15, color: c.accent },
		skip: { marginLeft: "auto", minHeight: 48, justifyContent: "center", paddingHorizontal: spacing.md },
		skipText: { ...typography.meta, color: c.textSecondary },
		hint: { ...typography.meta, color: c.textSecondary },
	});
