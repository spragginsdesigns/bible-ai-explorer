import { loadFont } from "@remotion/fonts";
import {
	AbsoluteFill,
	CanvasImage,
	Easing,
	Interactive,
	interpolate,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";

await Promise.all([
	loadFont({
		family: "Pirata One",
		url: staticFile("PirataOne-Regular.ttf"),
		weight: "400",
	}),
	loadFont({
		family: "Cormorant Garamond",
		url: staticFile("CormorantGaramond-Medium.ttf"),
		weight: "500",
	}),
]);

const GOLD = "#fbbf24";
const CREAM = "#e6d7ae";

export const SureWordSplash = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	return (
		<AbsoluteFill style={{ backgroundColor: "#000000", overflow: "hidden" }}>
			<CanvasImage
				name="Stained glass manuscript"
				src={staticFile("sureword-welcome-stained-glass.webp")}
				style={{
					position: "absolute",
					left: -110,
					top: 145,
					width: 1300,
					height: 930,
					opacity: interpolate(frame, [0, 0.7 * fps], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
					}),
					scale: interpolate(frame, [0, 1.15 * fps], [1.08, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.spring({ damping: 180 }),
						output: "perceptual-scale",
					}),
				}}
			/>

			<CanvasImage
				name="SureWord day star"
				src={staticFile("sureword-icon.png")}
				style={{
					position: "absolute",
					left: 350,
					top: 390,
					width: 380,
					height: 380,
					borderRadius: 190,
					opacity: interpolate(frame, [0.2 * fps, 1.1 * fps], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
					}),
					scale: interpolate(frame, [0.2 * fps, 1.25 * fps], [0.78, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.spring({ damping: 140 }),
						output: "perceptual-scale",
					}),
					filter: `drop-shadow(0 0 ${interpolate(frame, [0.2 * fps, 1.5 * fps], [0, 34], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
					})}px rgba(251, 191, 36, 0.3))`,
				}}
			/>

			<Interactive.Div
				name="SureWord wordmark"
				style={{
					position: "absolute",
					left: 80,
					right: 80,
					top: 1220,
					textAlign: "center",
					fontFamily: "Pirata One",
					fontSize: 150,
					lineHeight: 1,
					color: GOLD,
					opacity: interpolate(frame, [0.95 * fps, 1.65 * fps], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
					}),
					translate: interpolate(frame, [0.95 * fps, 1.65 * fps], ["0px 36px", "0px 0px"], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
					}),
				}}
			>
				SureWord
			</Interactive.Div>

			<Interactive.Div
				name="Scripture"
				style={{
					position: "absolute",
					left: 110,
					right: 110,
					top: 1488,
					textAlign: "center",
					fontFamily: "Cormorant Garamond",
					fontSize: 68,
					lineHeight: 1.16,
					color: CREAM,
					opacity: interpolate(frame, [1.3 * fps, 2.05 * fps], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
					}),
				}}
			>
				A light that shineth in a dark place.
			</Interactive.Div>

			<Interactive.Div
				name="Citation"
				style={{
					position: "absolute",
					left: 110,
					right: 110,
					top: 1712,
					textAlign: "center",
					fontFamily: "Arial, sans-serif",
					fontSize: 30,
					fontWeight: 700,
					letterSpacing: 9,
					color: GOLD,
					opacity: interpolate(frame, [1.55 * fps, 2.2 * fps], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
					}),
				}}
			>
				2 PETER 1:19
			</Interactive.Div>
		</AbsoluteFill>
	);
};
