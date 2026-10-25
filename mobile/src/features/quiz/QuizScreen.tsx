import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, useSegments } from "expo-router";
import { AppText as Text } from "@/components/AppText";
import { Screen } from "@/components/ui";
import { bookByOrder } from "@/features/bible/books";
import { useTabBarSpace } from "@/features/chat/layout";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { apiJson } from "@/lib/api";
import { radius, spacing, typography, type Colors } from "@/theme";
import type { ChapterQuiz, QuizQuestion } from "./quizContract";
import { DepthSwitch, GoldButton, OptionRow, OutlineButton, ProgressSegments, QuietButton, VerseCard, type OptionState } from "./QuizParts";
import { QuizResults } from "./QuizResults";
import { useChapterQuiz } from "./useChapterQuiz";
import {
	LOADING_HINT,
	LOADING_HINT_MS,
	askAboutPrompt,
	buildAttempt,
	continueLabel,
	isCorrect,
	loadingLine,
	nextChapterAfter,
	primaryVerse,
	progressAccessibilityLabel,
	progressLabel,
	quizHeaderTitle,
	verseLabel,
} from "./quizView";

/** Where the quiz is in one run. Reset whenever a new quiz (or depth) arrives. */
interface RunState {
	index: number;
	/** The row tapped but not yet checked. */
	choice: number | null;
	checked: boolean;
	/** "Show me the verse first" opened the verse card before answering. */
	revealed: boolean;
	answers: (number | null)[];
	finished: boolean;
}

const FRESH_RUN: RunState = { index: 0, choice: null, checked: false, revealed: false, answers: [], finished: false };

/**
 * "Quiz me" (docs/quiz/PLAN.md): five questions on the chapter just read,
 * each answered with its KJV verse, then a results page with the misses and a
 * reflection to keep as a note. Pushed onto the stack that opened the reader
 * (Bible, Today or Study), so closing it returns to that reader.
 */
export default function QuizScreen() {
	const router = useRouter();
	const segments: readonly string[] = useSegments();
	const chapterPath = segments.includes("today")
		? "/today/chapter"
		: segments.includes("study")
			? "/study/chapter"
			: "/bible/chapter";
	const params = useLocalSearchParams<{ book?: string; chapter?: string; translation?: string }>();
	const order = Number.parseInt(typeof params.book === "string" ? params.book : "", 10);
	const chapterNumber = Number.parseInt(typeof params.chapter === "string" ? params.chapter : "", 10);
	const readerTranslation = typeof params.translation === "string" && params.translation ? params.translation : null;
	const book = bookByOrder(order);
	const fallbackTitle = book ? `${book.name} ${chapterNumber}` : "Quiz";

	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const tabBarSpace = useTabBarSpace();
	const getToken = useStableGetToken();
	const { state, load, retry } = useChapterQuiz(order, chapterNumber);
	const quiz = state.status === "ready" ? state.quiz : null;
	const [run, setRun] = useState<RunState>(FRESH_RUN);
	const scrollRef = useRef<ScrollView>(null);
	const verseCardY = useRef<number | null>(null);
	const reduceMotion = useRef(false);

	useEffect(() => {
		let active = true;
		void AccessibilityInfo.isReduceMotionEnabled()
			.then((value) => {
				if (active) reduceMotion.current = value;
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, []);

	// A new quiz (first load or a depth switch) starts a fresh run.
	useEffect(() => {
		setRun(FRESH_RUN);
	}, [quiz]);

	const scrollTop = useCallback(() => {
		scrollRef.current?.scrollTo({ y: 0, animated: !reduceMotion.current });
	}, []);

	// The verse card is the reason for the question: bring it into view once it
	// opens. It is the last thing in the column, so scrolling to the end reveals
	// it with the least movement and keeps as much of the question in view as fits
	// (pinning the card to the top pushed the question off screen).
	const verseShown = run.checked || run.revealed;
	useEffect(() => {
		if (!verseShown) return;
		const timer = setTimeout(() => {
			if (verseCardY.current !== null) scrollRef.current?.scrollToEnd({ animated: !reduceMotion.current });
		}, 60);
		return () => clearTimeout(timer);
	}, [verseShown, run.index]);

	// One attempt record per finished run; a failure is silent by contract.
	const recorded = useRef<ChapterQuiz | null>(null);
	useEffect(() => {
		if (!quiz || !run.finished || recorded.current === quiz) return;
		recorded.current = quiz;
		apiJson(getToken, "/api/quiz/attempt", { method: "POST", body: buildAttempt(quiz, run.answers) }).catch(() => {
			// The results already show; apiJson reports the failure to telemetry.
		});
	}, [quiz, run.finished, run.answers, getToken]);

	const close = useCallback(() => {
		if (router.canGoBack()) router.back();
		else router.replace({ pathname: chapterPath, params: { book: String(order), chapter: String(chapterNumber) } });
	}, [router, chapterPath, order, chapterNumber]);

	const readInContext = useCallback(
		(question: QuizQuestion) => {
			const verse = primaryVerse(question);
			router.push({
				pathname: chapterPath,
				params: {
					book: String(order),
					chapter: String(chapterNumber),
					...(verse !== null ? { verse: String(verse) } : {}),
					...(readerTranslation ? { translation: readerTranslation } : {}),
				},
			});
		},
		[router, chapterPath, order, chapterNumber, readerTranslation],
	);

	// The same handoff as the reader's Ask: the composer is prefilled and the
	// verse pinned, and the reader sends it. The quiz text is always the KJV.
	const ask = useCallback(
		(question: QuizQuestion) => {
			router.push({
				pathname: "/",
				params: {
					prompt: askAboutPrompt(question.reference, question.prompt),
					attachRef: question.reference,
					attachText: question.verseText,
					attachTranslation: "KJV",
					handoffId: String(Date.now()),
				},
			});
		},
		[router],
	);

	const next = useMemo(() => nextChapterAfter(order, chapterNumber), [order, chapterNumber]);
	// Back to the reader below this screen, on the next chapter, rather than a
	// second reader stacked on the first.
	const continueReading = useCallback(() => {
		if (!next) return;
		router.dismissTo({
			pathname: chapterPath,
			params: {
				book: String(next.book),
				chapter: String(next.chapter),
				verse: "",
				...(readerTranslation ? { translation: readerTranslation } : {}),
			},
		});
	}, [router, next, chapterPath, readerTranslation]);

	const openNote = useCallback(
		(id: string) => router.push({ pathname: "/study/notes/[id]", params: { id } }),
		[router],
	);

	const question = quiz && !run.finished ? quiz.questions[run.index] : null;
	const count = quiz?.questions.length ?? 0;
	const lastQuestion = quiz ? run.index >= quiz.questions.length - 1 : false;

	const check = () => {
		if (run.choice === null) return;
		const answers = [...run.answers];
		answers[run.index] = run.choice;
		setRun({ ...run, checked: true, answers });
		AccessibilityInfo.announceForAccessibility(
			question && isCorrect(question, run.choice) ? "Right" : "Not quite",
		);
	};
	const advance = () => {
		if (lastQuestion) setRun({ ...run, finished: true });
		else setRun({ ...run, index: run.index + 1, choice: null, checked: false, revealed: false });
		verseCardY.current = null;
		scrollTop();
	};

	const optionState = (q: QuizQuestion, index: number): OptionState => {
		if (!run.checked) return run.choice === index ? "selected" : "idle";
		const chosen = run.answers[run.index] ?? null;
		if (index === chosen) return index === q.answerIndex ? "right" : "wrong";
		if (index === q.answerIndex) return "answer";
		return "dimmed";
	};

	const title = quiz?.title ?? fallbackTitle;
	const showDepth = quiz !== null && question !== null && run.index === 0 && !run.checked && run.answers.length === 0;

	return (
		<Screen>
			<View style={styles.header}>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Close the quiz"
					onPress={close}
					hitSlop={8}
					style={styles.headerButton}
				>
					<Ionicons name="close" size={26} color={colors.text} />
				</Pressable>
				<Text accessibilityRole="header" numberOfLines={1} style={[styles.headerTitle, run.finished && styles.headerTitleLeft]}>
					{run.finished ? title : quizHeaderTitle(title)}
				</Text>
				<Text style={styles.headerCount} accessibilityElementsHidden importantForAccessibility="no">
					{question ? progressLabel(run.index, count) : ""}
				</Text>
			</View>
			{question ? (
				<View style={styles.progress}>
					<ProgressSegments index={run.index} count={count} label={progressAccessibilityLabel(run.index, count)} />
				</View>
			) : null}

			{state.status === "loading" ? (
				<LoadingState title={title} />
			) : state.status === "error" ? (
				<View style={styles.center}>
					<View style={styles.errorCard}>
						<Text accessibilityRole="alert" style={styles.errorText}>
							{state.message}
						</Text>
						<GoldButton label="Retry" onPress={retry} />
					</View>
				</View>
			) : quiz && run.finished ? (
				<ScrollView
					ref={scrollRef}
					keyboardShouldPersistTaps="handled"
					contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace + spacing.xl }]}
				>
					<QuizResults quiz={quiz} answers={run.answers} getToken={getToken} onAsk={ask} onOpenNote={openNote} />
					<View style={styles.resultsFooter}>
						{next ? <GoldButton label={continueLabel(next)} onPress={continueReading} /> : null}
						<QuietButton label="Done" onPress={close} />
					</View>
				</ScrollView>
			) : quiz && question ? (
				<View style={styles.body}>
					<ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
						{showDepth ? (
							<DepthSwitch value={quiz.depth} onChange={(depth) => load(depth)} />
						) : null}
						<Text style={styles.verseLabel}>{verseLabel(question)}</Text>
						<Text style={styles.prompt}>{question.prompt}</Text>
						<View style={styles.options}>
							{question.options.map((option, index) => (
								<OptionRow
									key={`${question.id}:${index}`}
									index={index}
									text={option}
									state={optionState(question, index)}
									onPress={run.checked ? undefined : () => setRun({ ...run, choice: index })}
								/>
							))}
						</View>
						{verseShown ? (
							<View
								onLayout={(event) => {
									verseCardY.current = event.nativeEvent.layout.y;
								}}
							>
								<VerseCard question={question}>
									<View style={styles.verseActions}>
										<OutlineButton label="Read in context" icon="book-outline" onPress={() => readInContext(question)} />
										<OutlineButton label="Ask about this" icon="chatbubble-outline" onPress={() => ask(question)} />
									</View>
								</VerseCard>
							</View>
						) : null}
					</ScrollView>
					<View style={[styles.footer, { paddingBottom: tabBarSpace + spacing.md }]}>
						{run.checked ? (
							<GoldButton label={lastQuestion ? "See how you did" : "Next question"} onPress={advance} />
						) : (
							<>
								<GoldButton label="Check answer" onPress={check} disabled={run.choice === null} />
								{run.revealed ? null : (
									<QuietButton label="Show me the verse first" onPress={() => setRun({ ...run, revealed: true })} />
								)}
							</>
						)}
					</View>
				</View>
			) : null}
		</Screen>
	);
}

function LoadingState({ title }: { title: string }) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const [hint, setHint] = useState(false);
	useEffect(() => {
		const timer = setTimeout(() => setHint(true), LOADING_HINT_MS);
		return () => clearTimeout(timer);
	}, []);
	return (
		<View style={styles.center} accessibilityLiveRegion="polite">
			<ActivityIndicator size="large" color={colors.accent} />
			<Text style={styles.loadingLine}>{loadingLine(title)}</Text>
			{hint ? <Text style={styles.loadingHint}>{LOADING_HINT}</Text> : null}
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		header: {
			flexDirection: "row",
			alignItems: "center",
			paddingHorizontal: spacing.lg,
			paddingTop: spacing.sm,
			paddingBottom: spacing.md,
			gap: spacing.sm,
		},
		headerButton: { width: 44, height: 44, alignItems: "flex-start", justifyContent: "center" },
		headerTitle: { flex: 1, textAlign: "center", color: c.text, ...typography.sectionTitle, fontSize: 20, fontWeight: "700" },
		headerTitleLeft: { textAlign: "left" },
		headerCount: { minWidth: 44, textAlign: "right", color: c.textMuted, ...typography.control },
		progress: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
		body: { flex: 1 },
		content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
		verseLabel: { color: c.accent, ...typography.meta, letterSpacing: 2, textTransform: "uppercase", fontWeight: "600", marginTop: spacing.sm },
		prompt: { color: c.text, fontSize: 26, lineHeight: 34, fontWeight: "700", marginTop: -spacing.sm },
		options: { gap: spacing.md },
		verseActions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
		footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.xs },
		resultsFooter: { gap: spacing.xs, marginTop: spacing.sm },
		center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
		loadingLine: { color: c.text, ...typography.body, textAlign: "center", marginTop: spacing.sm },
		loadingHint: { color: c.textMuted, ...typography.support, textAlign: "center" },
		errorCard: {
			alignSelf: "stretch",
			borderRadius: radius.xl,
			borderWidth: 1,
			borderColor: c.border,
			backgroundColor: c.surface,
			padding: spacing.xl,
			gap: spacing.lg,
		},
		errorText: { color: c.text, ...typography.body, textAlign: "center" },
	});
