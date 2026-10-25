import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { AddLearnButton } from "@/features/learn/AddLearnButton";
import { createNote, deleteNote, patchNote } from "@/features/notes/api";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { GetToken } from "@/lib/api";
import { fonts, radius, spacing, typography, type Colors } from "@/theme";
import type { ChapterQuiz, QuizQuestion, QuizReflection } from "./quizContract";
import { OutlineButton } from "./QuizParts";
import {
	missedQuestions,
	primaryVerse,
	reflectionNote,
	resultsHeadline,
	resultsSubline,
	type MissedQuestion,
} from "./quizView";

/**
 * The end of a quiz: how many were remembered, one card per miss with its
 * verse, and the "Carry it with you" reflection that saves as a note.
 */
export function QuizResults({
	quiz,
	answers,
	getToken,
	onAsk,
	onOpenNote,
}: {
	quiz: ChapterQuiz;
	answers: readonly (number | null)[];
	getToken: GetToken;
	onAsk: (question: QuizQuestion) => void;
	onOpenNote: (id: string) => void;
}) {
	const styles = useThemedStyles(createStyles);
	const missed = missedQuestions(quiz, answers);
	const total = quiz.questions.length;
	return (
		<View style={styles.root}>
			<View style={styles.hero}>
				<Text accessible={false} style={styles.star}>
					{"✦"}
				</Text>
				<Text accessibilityRole="header" style={styles.headline}>
					{resultsHeadline(total - missed.length, total)}
				</Text>
				<Text style={styles.subline}>{resultsSubline(missed.length)}</Text>
			</View>
			{missed.map((item) => (
				<MissedCard key={item.question.id} quiz={quiz} item={item} onAsk={onAsk} />
			))}
			{quiz.reflection ? (
				<ReflectionCard
					title={quiz.title}
					reflection={quiz.reflection}
					getToken={getToken}
					onOpenNote={onOpenNote}
				/>
			) : null}
		</View>
	);
}

function MissedCard({
	quiz,
	item,
	onAsk,
}: {
	quiz: ChapterQuiz;
	item: MissedQuestion;
	onAsk: (question: QuizQuestion) => void;
}) {
	const styles = useThemedStyles(createStyles);
	const { question, chosen } = item;
	const verse = primaryVerse(question);
	return (
		<View style={styles.card}>
			<View style={styles.chip}>
				<Text style={styles.chipLabel}>Missed</Text>
			</View>
			<Text style={styles.question}>{question.prompt}</Text>
			<View style={styles.answerBlock}>
				<Text style={styles.answerCaption}>Your answer</Text>
				<Text style={styles.yourAnswer}>{chosen !== null ? question.options[chosen] : "No answer"}</Text>
			</View>
			<View style={styles.answerBlock}>
				<Text style={styles.correctCaption}>Correct answer</Text>
				<Text style={styles.correctAnswer}>{question.options[question.answerIndex]}</Text>
			</View>
			<View style={styles.divider} />
			<Text style={styles.scripture}>{question.verseText}</Text>
			<Text style={styles.reference}>{question.reference}</Text>
			<View style={styles.actions}>
				<View style={styles.action}>
					{verse !== null ? (
						<AddLearnButton
							book={quiz.book}
							chapter={quiz.chapter}
							verse={verse}
							translation="KJV"
							source="quiz"
							accessibilityLabel={`Learn this verse, ${quiz.title}:${verse}`}
						/>
					) : null}
				</View>
				<View style={styles.action}>
					<OutlineButton
						label="Ask about it"
						accessibilityLabel={`Ask about ${question.reference}`}
						onPress={() => onAsk(question)}
						style={styles.askButton}
					/>
				</View>
			</View>
		</View>
	);
}

type SaveState = { status: "idle" } | { status: "saving" } | { status: "saved"; id: string } | { status: "error" };

function ReflectionCard({
	title,
	reflection,
	getToken,
	onOpenNote,
}: {
	title: string;
	reflection: QuizReflection;
	getToken: GetToken;
	onOpenNote: (id: string) => void;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const [words, setWords] = useState("");
	const [save, setSave] = useState<SaveState>({ status: "idle" });
	const mounted = useRef(true);
	useEffect(
		() => () => {
			mounted.current = false;
		},
		[],
	);

	// Create, then patch the HTML, then delete on failure: the same pattern as
	// saving a verse to notes, so a failed patch never leaves an empty note.
	const onSave = useCallback(async () => {
		if (!words.trim() || save.status === "saving") return;
		setSave({ status: "saving" });
		const note = reflectionNote(title, reflection, words);
		try {
			const created = await createNote(getToken, { title: note.title, folderId: null });
			try {
				await patchNote(getToken, created.id, {
					htmlContent: note.htmlContent,
					plainText: note.plainText,
					wordCount: note.wordCount,
				});
			} catch (error) {
				try {
					await deleteNote(getToken, created.id);
				} catch {
					// Keep the original failure.
				}
				throw error;
			}
			if (mounted.current) setSave({ status: "saved", id: created.id });
		} catch {
			if (mounted.current) setSave({ status: "error" });
		}
	}, [words, save.status, title, reflection, getToken]);

	const canSave = words.trim().length > 0 && save.status !== "saving";
	return (
		<View style={styles.card}>
			<Text accessibilityRole="header" style={styles.reflectionTitle}>
				Carry it with you
			</Text>
			<Text style={styles.prompt}>{reflection.prompt}</Text>
			<Text style={styles.scripture}>{reflection.verseText}</Text>
			<Text style={styles.reference}>{reflection.reference}</Text>
			{save.status === "saved" ? (
				<View style={styles.savedRow}>
					<Text accessibilityLiveRegion="polite" style={styles.savedLabel}>
						Saved to your notes
					</Text>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Open the note"
						onPress={() => onOpenNote(save.id)}
						hitSlop={8}
						style={styles.openButton}
					>
						<Text style={styles.openLabel}>Open</Text>
					</Pressable>
				</View>
			) : (
				<>
					<TextInput
						value={words}
						onChangeText={setWords}
						placeholder="Write a few words..."
						placeholderTextColor={colors.textFaint}
						accessibilityLabel={`Your reflection on ${reflection.reference}`}
						multiline
						textAlignVertical="top"
						style={styles.input}
					/>
					<View style={styles.saveRow}>
						<OutlineButton
							label={save.status === "saving" ? "Saving..." : "Save as a note"}
							onPress={() => void onSave()}
							disabled={!canSave}
							style={styles.saveButton}
						/>
					</View>
					{save.status === "error" ? (
						<Text accessibilityRole="alert" style={styles.error}>
							Could not save the note. Check your connection and try again.
						</Text>
					) : null}
				</>
			)}
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		root: { gap: spacing.lg },
		hero: { alignItems: "center", gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.sm },
		star: { color: c.accent, fontSize: 44, lineHeight: 52 },
		headline: { color: c.text, fontFamily: fonts.verse, fontSize: 36, lineHeight: 42, textAlign: "center" },
		subline: { color: c.textMuted, ...typography.body, textAlign: "center" },
		card: {
			borderRadius: radius.xl,
			borderWidth: 1,
			borderColor: c.border,
			backgroundColor: c.surface,
			padding: spacing.lg,
			gap: spacing.md,
		},
		chip: {
			alignSelf: "flex-start",
			borderRadius: radius.sm,
			backgroundColor: c.accentSoft,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.xs,
		},
		chipLabel: { color: c.accent, ...typography.support, fontWeight: "600" },
		question: { color: c.text, ...typography.body, fontSize: 17, fontWeight: "700" },
		answerBlock: { gap: 2 },
		answerCaption: { color: c.textMuted, ...typography.meta },
		yourAnswer: {
			color: c.textMuted,
			fontFamily: fonts.verse,
			fontSize: 20,
			lineHeight: 26,
			textDecorationLine: "line-through",
		},
		correctCaption: { color: c.accent, ...typography.meta },
		correctAnswer: { color: c.accent, fontFamily: fonts.verse, fontSize: 22, lineHeight: 28 },
		divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.borderStrong },
		scripture: { color: c.text, fontFamily: fonts.verse, fontSize: 21, lineHeight: 29 },
		reference: { color: c.textMuted, ...typography.micro, letterSpacing: 2.5, textTransform: "uppercase" },
		actions: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
		action: { flex: 1 },
		askButton: { flex: 0, marginVertical: spacing.sm },
		reflectionTitle: { color: c.text, ...typography.screenTitle, fontWeight: "700" },
		prompt: { color: c.textMuted, ...typography.body },
		input: {
			minHeight: 96,
			borderRadius: radius.md,
			borderWidth: 1,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
			color: c.text,
			padding: spacing.md,
		},
		saveRow: { flexDirection: "row", justifyContent: "flex-end" },
		saveButton: { flex: 0, paddingHorizontal: spacing.lg },
		savedRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
		savedLabel: { color: c.textSecondary, ...typography.control },
		openButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md },
		openLabel: { color: c.accent, ...typography.control, fontWeight: "600" },
		error: { color: c.danger, ...typography.meta },
	});
