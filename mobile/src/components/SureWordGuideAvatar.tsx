import React, { useEffect, useRef, useState } from "react";
import {
	AccessibilityInfo,
	Animated,
	Easing,
	StyleSheet,
	View,
	type StyleProp,
	type ViewStyle,
} from "react-native";
import { useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";

const HERO_BREATH_MS = 2_800;
const THINKING_PULSE_MS = 900;

export const SureWordGuideAvatar = React.memo(function SureWordGuideAvatar({
	variant = "message",
	size = variant === "hero" ? 154 : 32,
	active = false,
	style,
	accessibilityLabel =
		variant === "hero"
			? "SureWord AI guide, a golden day star held by folded pages"
			: "SureWord AI assistant",
}: {
	variant?: "hero" | "message";
	size?: number;
	active?: boolean;
	style?: StyleProp<ViewStyle>;
	accessibilityLabel?: string;
}) {
	const styles = useThemedStyles(createStyles);
	const motion = useRef(new Animated.Value(0)).current;
	// Start still until the platform preference is known. That avoids a flash
	// of movement for people who have Reduce Motion enabled.
	const [reduceMotion, setReduceMotion] = useState(true);

	useEffect(() => {
		// Settled transcript rows are static. Do not attach one native listener
		// per historical answer; only the hero and the currently active reply
		// need to know whether motion is allowed.
		if (variant !== "hero" && !active) return;

		let mounted = true;
		void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
			if (mounted) setReduceMotion(enabled);
		});
		const subscription = AccessibilityInfo.addEventListener(
			"reduceMotionChanged",
			setReduceMotion,
		);
		return () => {
			mounted = false;
			subscription.remove();
		};
	}, [active, variant]);

	useEffect(() => {
		const shouldAnimate = !reduceMotion && (variant === "hero" || active);
		if (!shouldAnimate) {
			motion.stopAnimation();
			motion.setValue(0);
			return;
		}

		const duration = variant === "hero" ? HERO_BREATH_MS : THINKING_PULSE_MS;
		const loop = Animated.loop(
			Animated.sequence([
				Animated.timing(motion, {
					toValue: 1,
					duration,
					easing: Easing.inOut(Easing.ease),
					useNativeDriver: true,
				}),
				Animated.timing(motion, {
					toValue: 0,
					duration,
					easing: Easing.inOut(Easing.ease),
					useNativeDriver: true,
				}),
			]),
		);
		loop.start();
		return () => loop.stop();
	}, [active, motion, reduceMotion, variant]);

	const imageSize = variant === "hero" ? size : size * 0.88;
	const scale = motion.interpolate({
		inputRange: [0, 1],
		outputRange: [1, variant === "hero" ? 1.025 : 1.055],
	});
	const translateY = motion.interpolate({
		inputRange: [0, 1],
		outputRange: [0, variant === "hero" ? -3 : -1],
	});
	const glowOpacity = motion.interpolate({
		inputRange: [0, 1],
		outputRange: [variant === "hero" ? 0.35 : 0.2, variant === "hero" ? 0.72 : 0.68],
	});

	return (
		<View
			accessible
			accessibilityRole="image"
			accessibilityLabel={accessibilityLabel}
			pointerEvents="none"
			style={[
				styles.root,
				variant === "message" && styles.messageFrame,
				{ width: size, height: size, borderRadius: size / 2 },
				style,
			]}
		>
			<Animated.View
				style={[
					styles.glow,
					{
						width: size * 0.58,
						height: size * 0.58,
						borderRadius: size,
						opacity: glowOpacity,
						transform: [{ scale }],
					},
				]}
			/>
			<Animated.Image
				accessible={false}
				accessibilityIgnoresInvertColors
				source={require("../../assets/sureword-guide.png")}
				resizeMode="contain"
				style={{
					width: imageSize,
					height: imageSize,
					transform: [{ translateY }, { scale }],
				}}
			/>
		</View>
	);
});

const createStyles = (c: Colors) =>
	StyleSheet.create({
		root: {
			alignItems: "center",
			justifyContent: "center",
			overflow: "visible",
		},
		messageFrame: {
			marginTop: 2,
			backgroundColor: c.glass,
			borderColor: c.accentBorder,
			borderWidth: StyleSheet.hairlineWidth,
			overflow: "hidden",
		},
		glow: {
			position: "absolute",
			backgroundColor: c.accentSoft,
		},
	});
