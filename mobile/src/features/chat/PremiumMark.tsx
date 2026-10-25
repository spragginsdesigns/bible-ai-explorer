import React from "react";
import { Image } from "react-native";
import { useTheme } from "@/features/settings/settingsStore";

/**
 * SureWord Pro's premium mark: the gold day star from the app's own logo,
 * beside "SureWord AI" wherever Pro's AI is named (Austin, 2026-10-25). Free
 * and Pro share the name, so the mark (and the "Pro" the surrounding
 * accessibility label speaks) is the difference. Decorative on its own.
 */
export function PremiumMark({ size = 18 }: { size?: number }) {
	const { colors } = useTheme();
	return (
		<Image
			accessible={false}
			importantForAccessibility="no"
			source={require("../../../assets/chat-home/sureword-mark.png")}
			resizeMode="contain"
			style={{ width: size, height: size, tintColor: colors.accent, flexShrink: 0 }}
		/>
	);
}
