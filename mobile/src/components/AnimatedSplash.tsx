import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, BackHandler, Easing, Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";

const HOLD_MS = 1_650;
const FADE_MS = 220;

/** Local artwork and native-driver motion: no network or video surface at launch. */
export function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
	const opacity = useRef(new Animated.Value(1)).current;
	const dawn = useRef(new Animated.Value(0)).current;
	const [imageReady, setImageReady] = useState(false);
	const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
	const finishing = useRef(false);
	const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const latestFinish = useRef(onFinish);
	latestFinish.current = onFinish;

	const finish = useCallback(() => {
		if (finishing.current) return;
		finishing.current = true;
		Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start();
		// Cleanup must not depend on an animation callback surviving backgrounding.
		finishTimer.current = setTimeout(() => latestFinish.current(), FADE_MS);
	}, [opacity]);

	useEffect(() => {
		let mounted = true;
		void Promise.all([AccessibilityInfo.isReduceMotionEnabled(), AccessibilityInfo.isScreenReaderEnabled()])
			.then(([reduced, reader]) => { if (mounted) setReduceMotion(reduced || reader); })
			.catch(() => { if (mounted) setReduceMotion(true); });
		const failsafe = setTimeout(finish, 3_000);
		const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
		const back = BackHandler.addEventListener("hardwareBackPress", () => { finish(); return true; });
		const state = AppState.addEventListener("change", (next) => { if (next === "background") finish(); });
		return () => {
			mounted = false;
			clearTimeout(failsafe);
			if (finishTimer.current) clearTimeout(finishTimer.current);
			motion.remove(); back.remove(); state.remove();
			opacity.stopAnimation(); dawn.stopAnimation();
		};
	}, [dawn, finish, opacity]);

	useEffect(() => {
		if (reduceMotion === null || !imageReady || finishing.current) return;
		if (reduceMotion) { latestFinish.current(); return; }
		Animated.timing(dawn, {
			toValue: 1, duration: HOLD_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true,
		}).start();
		const hold = setTimeout(finish, HOLD_MS);
		return () => clearTimeout(hold);
	}, [dawn, finish, imageReady, reduceMotion]);

	return (
		<Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
			style={[StyleSheet.absoluteFill, styles.overlay, { opacity }]}>
			<StatusBar style="light" />
			<Pressable onPress={finish} style={styles.fill}>
				<Animated.Image source={require("../../assets/splash/sureword-dawn.jpg")}
					onLoad={() => setImageReady(true)} onError={finish} resizeMode="cover"
					style={[styles.fill, { transform: [{ scale: dawn.interpolate({ inputRange: [0, 1], outputRange: [1.035, 1] }) }] }]} />
				<LinearGradient colors={["rgba(6,20,27,0.58)", "transparent", "rgba(6,20,27,0.84)"]}
					locations={[0, 0.48, 1]} style={StyleSheet.absoluteFill} />
				<Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dawnVeil,
					{ opacity: dawn.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 0.12, 0] }) }]} />
				<View pointerEvents="none" style={styles.brand}>
					<Text maxFontSizeMultiplier={1.3} style={styles.wordmark}>SureWord</Text>
				</View>
				<View pointerEvents="none" style={styles.message}>
					<Text maxFontSizeMultiplier={1.3} style={styles.headline}>Your walk with God.</Text>
					<Text maxFontSizeMultiplier={1.3} style={styles.subtitle}>One step at a time.</Text>
				</View>
			</Pressable>
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	overlay: { backgroundColor: "#06141b", zIndex: 1000 },
	fill: { position: "absolute", width: "100%", height: "100%", top: 0, right: 0, bottom: 0, left: 0 },
	dawnVeil: { backgroundColor: "#06141b" },
	brand: { position: "absolute", top: "15%", left: 24, right: 24, alignItems: "center" },
	wordmark: { fontFamily: "PirataOne_400Regular", fontSize: 58, lineHeight: 73, color: "#fff8e8", textAlign: "center" },
	message: { position: "absolute", bottom: "16%", left: 24, right: 24, alignItems: "center" },
	headline: { fontFamily: "AtkinsonHyperlegible_400Regular", fontSize: 26, lineHeight: 34, color: "#fff8e8", textAlign: "center" },
	subtitle: { fontFamily: "AtkinsonHyperlegible_400Regular", fontSize: 17, lineHeight: 25, color: "#efdec0", marginTop: 10, textAlign: "center" },
});
