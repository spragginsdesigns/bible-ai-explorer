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

function textStyle(style: TextProps["style"], variant?: TypographyVariant, root = false): TextStyle {
	const flattened = flattenStyle(style);
	const token = variant ? typography[variant] : root ? typography.body : undefined;
	if (
		!token &&
		!flattened.fontFamily &&
		!flattened.fontWeight &&
		!flattened.fontStyle
	) {
		return flattened;
	}
	const italic = flattened.fontStyle === "italic";
	return {
		...(token ?? {}),
		...flattened,
		fontFamily: fontFor({ ...(token ?? {}), ...flattened }, italic),
	};
}

export const AppText = React.forwardRef<React.ElementRef<typeof NativeText>, AppTextProps>(
	function AppText({ variant, style, ...props }, ref) {
		const nested = useContext(NestedTextContext);
		// A root text gets the body token. Descendant spans inherit their native
		// parent size/line height unless they explicitly opt into a variant.
		return (
			<NestedTextContext.Provider value>
				<NativeText ref={ref} {...props} style={textStyle(style, variant, !nested)} />
			</NestedTextContext.Provider>
		);
	}
);

export const AppTextInput = React.forwardRef<
	React.ElementRef<typeof NativeTextInput>,
	AppTextInputProps
>(function AppTextInput({ variant = "control", style, ...props }, ref) {
	return <NativeTextInput ref={ref} {...props} style={textStyle(style, variant)} />;
});
