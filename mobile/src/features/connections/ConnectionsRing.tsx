import React, { memo, useMemo } from "react";
import { Pressable, StyleSheet, View, type GestureResponderEvent } from "react-native";
import Svg, { Circle, G, Path, Text as SvgText } from "react-native-svg";
import { AppText as Text } from "@/components/AppText";
import { fonts } from "@/theme";
import { useTheme } from "@/features/settings/settingsStore";
import {
	CONNECTION_SECTIONS,
	batchArcs,
	bookAtIndex,
	chordPath,
	connectionSectionOf,
	sectionInk,
	indexAtAngle,
	pointAt,
	ringArcPath,
	sectionSpan,
	angleOfIndex,
	type BaselineBook,
	type ChapterLink,
	type OverviewPair,
	type RingFrame,
} from "@/features/bible/connectionsMap";

interface ConnectionsRingProps {
	size: number;
	total: number;
	books: readonly BaselineBook[];
	overview: { bins: number; pairs: readonly OverviewPair[] } | null;
	links: readonly ChapterLink[];
	/** Global index of the chapter's first verse; null while it loads. */
	chapterStart: number | null;
	order: number;
	focusVerse: number | null;
	sectionFilter: string | null;
	title: string;
	subtitle: string;
	onBookPress: (order: number) => void;
	onCenterPress: () => void;
}

/**
 * Room outside the ring for the section labels. Side labels run outward
 * horizontally, so this must fit the widest ("REVELATION", "GOSPELS") or
 * they clip at the screen edge.
 */
const LABEL_ROOM = 64;
/** Labels closer than this (px) are stacked apart; General and Revelation share twelve o'clock. */
const LABEL_CLEARANCE = { x: 64, y: 11 };
const BAND = 7;
/** Chords stop this far inside the band so they read as leaving it. */
const CHORD_INSET = BAND / 2 + 2;

/**
 * The Connections ring: every book of the Bible around one circle, coloured by
 * section, with the chapter's cross-references drawn as chords across it and
 * the whole set ghosted behind. Arcs are batched into one path per colour, so
 * even Psalm 119's 1,573 links draw as a couple of dozen SVG paths.
 */
export const ConnectionsRing = memo(function ConnectionsRing({
	size,
	total,
	books,
	overview,
	links,
	chapterStart,
	order,
	focusVerse,
	sectionFilter,
	title,
	subtitle,
	onBookPress,
	onCenterPress,
}: ConnectionsRingProps) {
	const { colors, isDark } = useTheme();
	const frame: RingFrame = useMemo(
		() => ({ cx: size / 2, cy: size / 2, r: size / 2 - LABEL_ROOM, total }),
		[size, total]
	);

	const ghost = useMemo(() => {
		if (!overview || overview.pairs.length === 0) return [];
		const step = total / overview.bins;
		const weights = overview.pairs.map((p) => p[2]).sort((a, b) => a - b);
		const cut1 = weights[Math.floor(weights.length * 0.6)] ?? 0;
		const cut2 = weights[Math.floor(weights.length * 0.9)] ?? 0;
		const tiers = ["", "", ""];
		for (const [a, b, weight] of overview.pairs) {
			const d = chordPath(frame, (a + 0.5) * step, (b + 0.5) * step, CHORD_INSET);
			const tier = weight >= cut2 ? 2 : weight >= cut1 ? 1 : 0;
			tiers[tier] += d;
		}
		return tiers;
	}, [overview, total, frame]);

	const visible = useMemo(
		() => links.filter((link) => !sectionFilter || connectionSectionOf(link[1]).id === sectionFilter),
		[links, sectionFilter]
	);

	const { background, focused, endpoints } = useMemo(() => {
		const back: { color: string; d: string }[] = [];
		const front: { color: string; d: string }[] = [];
		const dots: { x: number; y: number; color: string; key: string }[] = [];
		if (chapterStart === null) return { background: [], focused: [], endpoints: dots };
		for (const link of visible) {
			const [verse, toOrder, , , toIndex] = link;
			const color = connectionSectionOf(toOrder).color;
			const d = chordPath(frame, chapterStart + verse - 1, toIndex, CHORD_INSET);
			if (focusVerse !== null && verse === focusVerse) {
				front.push({ color, d });
				const p = pointAt(frame, angleOfIndex(frame, toIndex), frame.r - CHORD_INSET);
				dots.push({ ...p, color, key: `${toIndex}` });
			} else {
				back.push({ color, d });
			}
		}
		return { background: batchArcs(back), focused: batchArcs(front), endpoints: dots };
	}, [visible, frame, chapterStart, focusVerse]);

	const segments = useMemo(
		() =>
			books.map(([bookOrder, start, verses]) => ({
				order: bookOrder,
				color: connectionSectionOf(bookOrder).color,
				d: ringArcPath(frame, start, start + verses, frame.r, 0.004),
			})),
		[books, frame]
	);

	const labels = useMemo(() => {
		// Without the books every span is [0, 0] and the labels would pile up at the top.
		if (books.length === 0) return [];
		const placed: { section: (typeof CONNECTION_SECTIONS)[number]; x: number; y: number; anchor: "start" | "end" | "middle" }[] = [];
		for (const section of CONNECTION_SECTIONS) {
			const [start, end] = sectionSpan(books, section);
			const angle = angleOfIndex(frame, (start + end) / 2);
			const p = pointAt(frame, angle, frame.r + BAND + 9);
			const cos = Math.cos(angle);
			const sin = Math.sin(angle);
			const anchor: "start" | "end" | "middle" = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
			let y = p.y + (sin > 0.3 ? 8 : sin < -0.3 ? -2 : 3);
			// Short neighbouring sections land on top of each other; step outward until clear.
			const outward = sin < 0 ? -1 : 1;
			while (placed.some((o) => Math.abs(o.x - p.x) < LABEL_CLEARANCE.x && Math.abs(o.y - y) < LABEL_CLEARANCE.y)) {
				y += outward * LABEL_CLEARANCE.y;
			}
			placed.push({ section, x: p.x, y, anchor });
		}
		return placed;
	}, [books, frame]);

	const source = useMemo(() => {
		if (books.length === 0 || chapterStart === null) return null;
		const at = focusVerse !== null ? chapterStart + focusVerse - 1 : chapterStart;
		return pointAt(frame, angleOfIndex(frame, at), frame.r - CHORD_INSET);
	}, [books.length, frame, chapterStart, focusVerse]);

	const onPress = (event: GestureResponderEvent) => {
		const { locationX, locationY } = event.nativeEvent;
		const dx = locationX - frame.cx;
		const dy = locationY - frame.cy;
		const distance = Math.hypot(dx, dy);
		if (distance < frame.r * 0.42) {
			onCenterPress();
			return;
		}
		if (Math.abs(distance - frame.r) > 26 || books.length === 0) return;
		const index = indexAtAngle(frame, Math.atan2(dy, dx));
		if (index !== null) onBookPress(bookAtIndex(books, index));
	};

	const dim = focusVerse !== null;
	const ghostColor = isDark ? "#ffffff" : "#000000";

	return (
		<Pressable
			onPress={onPress}
			accessibilityRole="button"
			accessibilityLabel={`${title}, ${subtitle}. Tap a book on the ring to filter by its section.`}
			style={{ width: size, height: size }}
		>
			<Svg width={size} height={size}>
				<G>
					{ghost.map((d, tier) =>
						d ? (
							<Path
								key={`ghost-${tier}`}
								d={d}
								stroke={ghostColor}
								strokeOpacity={[0.035, 0.06, 0.1][tier] * (isDark ? 1 : 0.8)}
								strokeWidth={0.6}
								fill="none"
							/>
						) : null
					)}
				</G>
				<G>
					{background.map((batch) => (
						<Path
							key={`bg-${batch.key}`}
							d={batch.d}
							stroke={batch.color}
							strokeOpacity={dim ? 0.14 : 0.5}
							strokeWidth={0.9}
							fill="none"
						/>
					))}
				</G>
				<G>
					{focused.map((batch) => (
						<Path
							key={`glow-${batch.key}`}
							d={batch.d}
							stroke={batch.color}
							strokeOpacity={0.28}
							strokeWidth={4}
							fill="none"
							strokeLinecap="round"
						/>
					))}
					{focused.map((batch) => (
						<Path
							key={`core-${batch.key}`}
							d={batch.d}
							stroke={batch.color}
							strokeOpacity={0.95}
							strokeWidth={1.4}
							fill="none"
							strokeLinecap="round"
						/>
					))}
				</G>
				<G>
					{segments.map((segment) =>
						segment.d ? (
							<Path
								key={`book-${segment.order}`}
								d={segment.d}
								stroke={segment.color}
								strokeOpacity={segment.order === order ? 1 : 0.78}
								strokeWidth={segment.order === order ? BAND + 4 : BAND}
								fill="none"
							/>
						) : null
					)}
				</G>
				{endpoints.map((dot) => (
					<Circle key={dot.key} cx={dot.x} cy={dot.y} r={2.6} fill={dot.color} />
				))}
				{source ? (
					<>
						<Circle cx={source.x} cy={source.y} r={7} fill={colors.accent} fillOpacity={0.25} />
						<Circle cx={source.x} cy={source.y} r={3.4} fill={colors.accent} />
					</>
				) : null}
				{labels.map(({ section, x, y, anchor }) => (
					<SvgText
						key={section.id}
						x={x}
						y={y}
						fill={sectionInk(section.color, isDark)}
						fillOpacity={sectionFilter && sectionFilter !== section.id ? 0.4 : 1}
						fontSize={9}
						fontFamily={fonts.bodyBold}
						letterSpacing={0.6}
						textAnchor={anchor}
					>
						{section.short.toUpperCase()}
					</SvgText>
				))}
			</Svg>
			<View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
				<Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
					{title}
				</Text>
				<Text style={[styles.subtitle, { color: colors.accent }]}>{subtitle}</Text>
			</View>
		</Pressable>
	);
});

const styles = StyleSheet.create({
	center: { alignItems: "center", justifyContent: "center", paddingHorizontal: 80 },
	title: { fontFamily: fonts.verse, fontSize: 28, lineHeight: 34, textAlign: "center" },
	subtitle: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, marginTop: 2 },
});
