import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { useThemedStyles } from "@/features/settings/settingsStore";
import { radius, spacing, typography, type Colors } from "@/theme";

export interface StudyTab {
	key: string;
	label: string;
	badge?: string;
}

export interface StudyTabsProps {
	tabs: StudyTab[];
	value: string;
	onChange: (key: string) => void;
}

/** Segmented control across the study panes of the expanded verse sheet. */
export function StudyTabs({ tabs, value, onChange }: StudyTabsProps): React.JSX.Element {
	const styles = useThemedStyles(createStyles);
	return (
		<View accessibilityRole="tablist" style={styles.container}>
			{tabs.map((tab) => {
				const selected = tab.key === value;
				return (
					<Pressable
						key={tab.key}
						accessibilityRole="tab"
						accessibilityState={{ selected }}
						onPress={() => onChange(tab.key)}
						style={[styles.segment, selected && styles.segmentActive]}
					>
						<Text
							numberOfLines={1}
							style={[styles.label, selected && styles.labelActive]}
						>
							{tab.label}
						</Text>
						{tab.badge ? <Text style={styles.badge}>{tab.badge}</Text> : null}
					</Pressable>
				);
			})}
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		container: {
			flexDirection: "row",
			alignItems: "center",
			marginHorizontal: spacing.lg,
			padding: 3,
			borderRadius: radius.full,
			backgroundColor: c.surfacePressed,
		},
		segment: {
			flex: 1,
			minHeight: 36,
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: spacing.xs,
			paddingHorizontal: spacing.sm,
			borderRadius: radius.full,
		},
		segmentActive: {
			backgroundColor: c.bgElevated,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
		},
		label: { color: c.textMuted, ...typography.support, fontWeight: "700" },
		labelActive: { color: c.accent },
		badge: { color: c.textFaint, ...typography.meta },
	});
