import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { spacing, radius, typography, type Colors } from "@/theme";
import { setTextScale, useSettingsSelector, useThemedStyles } from "./settingsStore";
import { DEFAULT_TEXT_SCALE, TEXT_SCALE_LABELS, TEXT_SCALES, stepTextScale } from "./textScale";

export function TextSizeControl() {
	const scale = useSettingsSelector(settings => settings.textScale);
	const styles = useThemedStyles(createStyles);
	return <View style={styles.wrap}>
		<Text style={styles.value} accessibilityLiveRegion="polite" accessibilityLabel={`Text size: ${TEXT_SCALE_LABELS[scale]}`}>
			{TEXT_SCALE_LABELS[scale]}
		</Text>
		<View style={styles.controls}>
			{([-1, 1] as const).map(direction => {
				const disabled = scale === TEXT_SCALES[direction === -1 ? 0 : TEXT_SCALES.length - 1];
				return <Pressable key={direction} accessibilityRole="button" accessibilityLabel={direction === -1 ? "Decrease text size" : "Increase text size"}
					accessibilityState={{ disabled }} disabled={disabled}
					onPress={() => setTextScale(stepTextScale(scale, direction))}
					style={({ pressed }) => [styles.button, disabled && styles.disabled, pressed && styles.pressed]}>
					<Text style={styles.buttonText}>{direction === -1 ? "A−" : "A+"}</Text>
				</Pressable>;
			})}
			<Pressable accessibilityRole="button" accessibilityLabel="Reset text size to Standard"
				accessibilityState={{ disabled: scale === DEFAULT_TEXT_SCALE }} disabled={scale === DEFAULT_TEXT_SCALE}
				onPress={() => setTextScale(DEFAULT_TEXT_SCALE)}
				style={({ pressed }) => [styles.button, scale === DEFAULT_TEXT_SCALE && styles.disabled, pressed && styles.pressed]}>
				<Text style={styles.reset}>Reset</Text>
			</Pressable>
		</View>
		<View style={styles.preview} accessibilityLabel="Text size preview">
			<Text variant="sectionTitle" style={styles.previewText}>Read with understanding</Text>
			<Text variant="body" style={styles.previewText}>Thy word is a lamp unto my feet, and a light unto my path.</Text>
			<Text variant="support" style={styles.hint}>Psalm 119:105 · KJV</Text>
		</View>
		<Text style={styles.hint}>Adjusts text throughout SureWord, on top of your phone&apos;s accessibility text size. Saved to your account. The Bible reader keeps its own size adjustment.</Text>
	</View>;
}

const createStyles = (c: Colors) => StyleSheet.create({
	wrap: { gap: spacing.md },
	hint: { ...typography.support, color: c.textMuted },
	value: { ...typography.body, color: c.text, fontWeight: "700" },
	controls: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
	button: { minWidth: 64, minHeight: 48, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, justifyContent: "center", alignItems: "center", borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: c.accentBorder, backgroundColor: c.accentSoft },
	buttonText: { ...typography.sectionTitle, fontWeight: "700", color: c.accent },
	reset: { ...typography.control, fontWeight: "700", color: c.accent },
	disabled: { opacity: 0.4 },
	pressed: { backgroundColor: c.surfacePressed },
	preview: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surfaceStrong },
	previewText: { color: c.text },
});
