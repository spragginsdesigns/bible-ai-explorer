import React, { useEffect, useRef, useState } from "react";
import {
	AccessibilityInfo, Animated, AppState, Easing, View,
	type StyleProp, type ViewStyle,
} from "react-native";
import type { GuidePhase } from "./guideMotion";

const POSES = {
	idle: require("../../assets/chat-home/sureword-companion-idle.png"),
	thinking: require("../../assets/chat-home/sureword-companion-thinking.png"),
	answering: require("../../assets/chat-home/sureword-companion-answering.png"),
};
const LABELS: Record<GuidePhase, string> = {
	idle: "SureWord study companion",
	thinking: "SureWord companion reaching upward in prayer while thinking",
	answering: "SureWord companion raising its page arms in praise while answering",
};

export const SureWordGuideAvatar = React.memo(function SureWordGuideAvatar({
	variant = "message",
	size = variant === "hero" ? 192 : 40,
	active = false,
	phase = active ? "thinking" : "idle",
	style,
	accessibilityLabel = LABELS[phase],
}: {
	variant?: "hero" | "message";
	size?: number;
	active?: boolean;
	phase?: GuidePhase;
	style?: StyleProp<ViewStyle>;
	accessibilityLabel?: string;
}) {
	const motion = useRef(new Animated.Value(0)).current;
	const [reduceMotion, setReduceMotion] = useState(true);
	const [screenReader, setScreenReader] = useState(true);
	const [foreground, setForeground] = useState(AppState.currentState === "active");
	const eligible = variant === "hero" || phase !== "idle";

	useEffect(() => {
		if (!eligible) return;
		let mounted = true;
		setForeground(AppState.currentState === "active");
		void AccessibilityInfo.isReduceMotionEnabled().then(value => {
			if (mounted) setReduceMotion(value);
		});
		void AccessibilityInfo.isScreenReaderEnabled().then(value => {
			if (mounted) setScreenReader(value);
		});
		const reduce = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
		const reader = AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReader);
		const app = AppState.addEventListener("change", state => setForeground(state === "active"));
		return () => {
			mounted = false;
			reduce.remove();
			reader.remove();
			app.remove();
		};
	}, [eligible]);

	useEffect(() => {
		motion.stopAnimation();
		motion.setValue(0);
		if (!eligible || reduceMotion || screenReader || !foreground) return;
		const duration = phase === "thinking" ? 2200 : phase === "answering" ? 2600 : 3200;
		const loop = Animated.loop(Animated.sequence([
			Animated.timing(motion, {
				toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true,
			}),
			Animated.timing(motion, {
				toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true,
			}),
		]));
		loop.start();
		return () => loop.stop();
	}, [eligible, foreground, motion, phase, reduceMotion, screenReader]);

	const translateY = motion.interpolate({
		inputRange: [0, 1], outputRange: [0, variant === "hero" ? -3 : -1.2],
	});
	const rotate = motion.interpolate({
		inputRange: [0, 1],
		outputRange: phase === "thinking" ? ["-2deg", "1deg"] : ["-1deg", "1deg"],
	});

	return (
		<View
			accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}
			pointerEvents="none"
			style={[{ width: size, height: size * 1.2, alignItems: "center", justifyContent: "center" }, style]}
		>
			<Animated.Image
				accessible={false} accessibilityIgnoresInvertColors
				source={POSES[phase]} resizeMode="contain" resizeMethod="resize" fadeDuration={0}
				style={{ width: size, height: size * 1.2, transform: [{ translateY }, { rotate }] }}
			/>
		</View>
	);
});
