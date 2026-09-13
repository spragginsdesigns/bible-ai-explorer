import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { useThemedStyles } from "@/features/settings/settingsStore";
import { fonts, radius, spacing, type Colors } from "@/theme";
import { verseWords, type LearnStage } from "./learn";
import {
	LEARN_MODES,
	LEARN_MODE_LABELS,
	firstLetterWords,
	learnModeHint,
	orderRound,
	scoreTypedVerse,
	tapOrderWord,
	type LearnMode,
	type TypedScore,
} from "./practice";

export interface VersePracticeProps {
	mode: LearnMode;
	text: string;
	stage: LearnStage;
	/** The card's revision, so the shuffle and the part of a long verse move with the card. */
	seed: number;
	disabled: boolean;
	onModeChange: (mode: LearnMode) => void;
	/** Type it out is the one mode that gates Continue, and only a word-for-word verse passes. */
	onTypedScore: (perfect: boolean) => void;
}

/**
 * One verse, one job, in whichever mode the card opened in. Every mode works
 * from the downloaded card, so practice keeps working with no connection.
 * The parent re-keys this component per card, review and mode, which is what
 * clears a round rather than an effect.
 */
export function VersePractice({ mode, text, stage, seed, disabled, onModeChange, onTypedScore }: VersePracticeProps) {
	const styles = useThemedStyles(createStyles);
	const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set());
	const [placed, setPlaced] = useState<number[]>([]);
	const [expected, setExpected] = useState<number | null>(null);
	const [draft, setDraft] = useState("");
	const [score, setScore] = useState<TypedScore | null>(null);
	const blanks = useMemo(() => verseWords(text, stage), [text, stage]);
	const letters = useMemo(() => firstLetterWords(text), [text]);
	const round = useMemo(() => orderRound(text, seed), [text, seed]);

	const reveal = (index: number) => setRevealed((old) => new Set(old).add(index));

	const tap = (choice: number) => {
		const result = tapOrderWord(round, placed, choice);
		setPlaced(result.placed);
		setExpected(result.expected);
	};

	const check = () => {
		const result = scoreTypedVerse(text, draft);
		setScore(result);
		onTypedScore(result.perfect);
	};

	const edit = (value: string) => {
		setDraft(value);
		if (score) {
			setScore(null);
			onTypedScore(false);
		}
	};

	const taken = new Set(placed);
	const done = placed.length === round.answer.length;

	return <View>
		{mode === "blanks" ? <Text style={styles.verse}>
			{blanks.map((word, index) => <Text key={index} style={styles.verse}>
				{index ? " " : ""}
				{word.hidden && !revealed.has(index)
					? <Text
						accessibilityRole="button"
						accessibilityLabel={`Reveal word ${index + 1}`}
						onPress={disabled ? undefined : () => reveal(index)}
						style={[styles.verse, styles.blank]}
					>{word.blank}</Text>
					: word.text}
			</Text>)}
		</Text> : null}

		{mode === "letters" ? <Text style={styles.verse}>
			{letters.map((word, index) => <Text key={index} style={styles.verse}>
				{index ? " " : ""}
				{revealed.has(index)
					? word.text
					: <Text
						accessibilityRole="button"
						accessibilityLabel={`See word ${index + 1}`}
						onPress={disabled ? undefined : () => reveal(index)}
						style={[styles.verse, styles.blank]}
					>{word.clue}</Text>}
			</Text>)}
		</Text> : null}

		{mode === "order" ? <View>
			<Text accessibilityLiveRegion="polite" style={[styles.verse, styles.placed]}>
				{placed.map((choice) => round.choices[choice]).join(" ")}
			</Text>
			{round.partial ? <Text style={styles.note}>This verse is long, so practice comes a part at a time.</Text> : null}
			{done ? <Text accessibilityLiveRegion="polite" style={styles.note}>That is the verse.</Text> : <View style={styles.choices}>
				{round.choices.map((word, index) => taken.has(index) ? null : <Pressable
					key={index}
					accessibilityRole="button"
					accessibilityLabel={`Place ${word}`}
					accessibilityState={{ disabled }}
					disabled={disabled}
					onPress={() => tap(index)}
					style={[styles.choice, index === expected && styles.choiceExpected, disabled && styles.dim]}
				><Text style={styles.choiceText}>{word}</Text></Pressable>)}
			</View>}
			{expected !== null && !done ? <Text accessibilityLiveRegion="polite" style={styles.note}>
				That word comes later. The next one is marked.
			</Text> : null}
		</View> : null}

		{mode === "typed" ? <View>
			<TextInput
				value={draft}
				editable={!disabled}
				multiline
				textAlignVertical="top"
				accessibilityLabel="Type the verse"
				onChangeText={edit}
				style={styles.input}
			/>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Check the verse"
				accessibilityState={{ disabled: disabled || !draft.trim() }}
				disabled={disabled || !draft.trim()}
				onPress={check}
				style={[styles.check, (disabled || !draft.trim()) && styles.dim]}
			><Text style={styles.checkText}>Check the verse</Text></Pressable>
			{score ? <View>
				<Text style={styles.scored}>
					{score.words.map((word, index) => <Text key={index} style={styles.scored}>
						{index ? " " : ""}
						{word.result === "match" ? word.expected : null}
						{word.result === "missed"
							? <Text style={[styles.scored, styles.missed]}>{word.expected}</Text>
							: null}
						{word.result === "extra"
							? <Text style={[styles.scored, styles.extra]}>{word.typed}</Text>
							: null}
					</Text>)}
				</Text>
				<Text accessibilityLiveRegion="polite" style={styles.note}>
					{score.perfect ? "Word for word." : "The marked words are the ones to mend."}
				</Text>
			</View> : null}
		</View> : null}

		<Text style={styles.note}>{learnModeHint(mode, stage)}</Text>

		<View style={styles.modes}>
			{LEARN_MODES.map((item) => <Pressable
				key={item}
				accessibilityRole="button"
				accessibilityLabel={`Practice mode: ${LEARN_MODE_LABELS[item]}`}
				accessibilityState={{ selected: item === mode }}
				onPress={() => onModeChange(item)}
				style={[styles.mode, item === mode && styles.modeActive]}
			><Text style={[styles.modeText, item === mode && styles.modeActiveText]}>{LEARN_MODE_LABELS[item]}</Text></Pressable>)}
		</View>
	</View>;
}

const createStyles = (colors: Colors) => StyleSheet.create({
	verse: { color: colors.text, fontFamily: fonts.verse, fontSize: 30, lineHeight: 44, textAlign: "center" },
	blank: { color: colors.accent, textDecorationLine: "underline" },
	// Holds the line before the first word is placed so the tiles do not jump.
	placed: { minHeight: 44 },
	note: { color: colors.textMuted, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: spacing.xl },
	choices: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm, marginTop: spacing.xl },
	choice: {
		minHeight: 44,
		justifyContent: "center",
		borderWidth: 1,
		borderColor: colors.borderStrong,
		borderRadius: radius.lg,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm,
	},
	choiceExpected: { borderColor: colors.accentBorder, backgroundColor: colors.accentSoft },
	choiceText: { color: colors.text, fontFamily: fonts.verse, fontSize: 20, lineHeight: 28 },
	input: {
		minHeight: 140,
		color: colors.text,
		fontFamily: fonts.verse,
		fontSize: 20,
		lineHeight: 30,
		borderWidth: 1,
		borderColor: colors.borderStrong,
		borderRadius: radius.lg,
		padding: spacing.md,
	},
	check: {
		minHeight: 48,
		alignSelf: "flex-start",
		justifyContent: "center",
		borderWidth: 1,
		borderColor: colors.borderStrong,
		borderRadius: radius.lg,
		paddingHorizontal: spacing.lg,
		marginTop: spacing.md,
	},
	checkText: { color: colors.text, fontFamily: fonts.bodyBold },
	scored: { color: colors.text, fontFamily: fonts.verse, fontSize: 20, lineHeight: 32, textAlign: "center", marginTop: spacing.xl },
	missed: { color: colors.accent, textDecorationLine: "underline" },
	extra: { color: colors.textMuted, textDecorationLine: "line-through" },
	modes: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm, marginTop: spacing.lg },
	mode: {
		minHeight: 44,
		justifyContent: "center",
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radius.lg,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm,
	},
	modeActive: { borderColor: colors.accentBorder, backgroundColor: colors.accentSoft },
	modeText: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
	modeActiveText: { color: colors.accent, fontFamily: fonts.bodyBold },
	dim: { opacity: 0.5 },
});
