import React, { createContext, useContext } from "react";
import {
	StyleSheet,
	Text as NativeText,
	TextInput as NativeTextInput,
	type TextInputProps,
	type TextProps,
	type TextStyle,
} from "react-native";
import { fonts, typography, type TypographyVariant } from "@/theme";
import { useTextScaleFactor } from "@/features/settings/settingsStore";
import { scaleTextDimensions } from "@/features/settings/textScale";

/**
 * Shared text primitives. Native text remains the implementation so callers
 * keep the complete React Native Text/TextInput prop surface and accessibility
 * behavior. The only default is the bundled, offline-readable body family.
 */
export interface AppTextProps extends TextProps {
	variant?: TypographyVariant;
}

export interface AppTextInputProps extends TextInputProps {
	variant?: TypographyVariant;
}

const NestedTextContext = createContext(false);

function flattenStyle(style: TextProps["style"] | TextInputProps["style"]): TextStyle {
	return (StyleSheet.flatten(style) ?? {}) as TextStyle;
}

function isBodyFamily(fontFamily: TextStyle["fontFamily"]): boolean {
	return !fontFamily || fontFamily === fonts.sans;
}

function isMonoFamily(fontFamily: TextStyle["fontFamily"]): boolean {
	return fontFamily === fonts.mono;
}

function isBoldWeight(weight: TextStyle["fontWeight"]): boolean {
	return weight === "bold" || (weight != null && Number(weight) >= 600);
}

function fontFor(style: TextStyle, italic: boolean): string | undefined {
	const bold = isBoldWeight(style.fontWeight);
	if (isMonoFamily(style.fontFamily)) {
		if (italic) return bold ? fonts.monoBoldItalic : fonts.monoItalic;
		return bold ? fonts.monoBold : fonts.mono;
	}
	if (!isBodyFamily(style.fontFamily)) return style.fontFamily;
	if (italic) return bold ? fonts.bodyBoldItalic : fonts.bodyItalic;
	return bold ? fonts.bodyBold : fonts.body;
}

/**
 * The account's text size (Settings > Appearance, Walk with me) grows the
 * explicit sizes; the system font scale still applies on top through
 * allowFontScaling, so this never replaces the reader's accessibility setting.
 */
function textStyle(style: TextProps["style"], variant?: TypographyVariant, root = false, factor = 1): TextStyle {
	const flattened = flattenStyle(style);
	const token = variant ? typography[variant] : root ? typography.body : undefined;
	if (
		!token &&
		!flattened.fontFamily &&
		!flattened.fontWeight &&
		!flattened.fontStyle
	) {
		return scaleTextDimensions(flattened, factor);
	}
	const italic = flattened.fontStyle === "italic";
	return scaleTextDimensions({
		...(token ?? {}),
		...flattened,
		fontFamily: fontFor({ ...(token ?? {}), ...flattened }, italic),
	}, factor);
}

export const AppText = React.forwardRef<React.ElementRef<typeof NativeText>, AppTextProps>(
	function AppText({ variant, style, ...props }, ref) {
		const nested = useContext(NestedTextContext);
		const factor = useTextScaleFactor();
		// A root text gets the body token. Descendant spans inherit their native
		// parent size/line height unless they explicitly opt into a variant.
		return (
			<NestedTextContext.Provider value>
				<NativeText ref={ref} {...props} style={textStyle(style, variant, !nested, factor)} />
			</NestedTextContext.Provider>
		);
	}
);

export const AppTextInput = React.forwardRef<
	React.ElementRef<typeof NativeTextInput>,
	AppTextInputProps
>(function AppTextInput({ variant = "control", style, ...props }, ref) {
	const factor = useTextScaleFactor();
	return <NativeTextInput ref={ref} {...props} style={textStyle(style, variant, false, factor)} />;
});

/** Preserve native script and Scripture font inheritance while scaling explicit runs. */
export const AppScriptText = React.forwardRef<React.ElementRef<typeof NativeText>, TextProps>(
	function AppScriptText({ style, ...props }, ref) {
		const factor = useTextScaleFactor();
		return <NativeText ref={ref} {...props} style={scaleTextDimensions(flattenStyle(style), factor)} />;
	},
);
