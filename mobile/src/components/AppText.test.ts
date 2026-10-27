import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { TextProps } from "react-native";

// Expo provides this runtime; the mobile project doesn't need DOM declaration packages.
const { renderToStaticMarkup } = require("react-dom/server") as {
	renderToStaticMarkup(element: React.ReactNode): string;
};

vi.mock("react-native", () => {
	const flatten = (style: unknown): Record<string, unknown> => Array.isArray(style)
		? Object.assign({}, ...style.map(flatten))
		: style && typeof style === "object" ? style as Record<string, unknown> : {};
	const NativeText = ({ style, children }: TextProps) => React.createElement("span", { "data-style": JSON.stringify(style) }, children);
	return { Text: NativeText, TextInput: NativeText, StyleSheet: { flatten } };
});
vi.mock("@/features/settings/settingsStore", () => ({ useTextScaleFactor: () => 1.3 }));
vi.mock("react-native-markdown-display", () => ({ renderRules: {} }));

import { AppScriptText, AppText, AppTextInput } from "./AppText";
import { Text as NativeText } from "react-native";
import { convertMarkdownTextRuns } from "@/features/chat/markdownText";

function stylesOf(element: React.ReactElement): Record<string, unknown>[] {
	const html = renderToStaticMarkup(element);
	return [...html.matchAll(/data-style="([^"]+)"/g)].map(match => JSON.parse(match[1].replace(/&quot;/g, '"')) as Record<string, unknown>);
}

describe("AppText nested sizing", () => {
	it("keeps inherited emphasis unchanged and scales explicit child runs once", () => {
		const styles = stylesOf(React.createElement(AppText, { style: { fontSize: 20, lineHeight: 30 } },
			React.createElement(AppText, { style: { fontWeight: "700" } }, "inherited"),
			React.createElement(AppText, { style: { fontSize: 12, lineHeight: 18 } }, "explicit"),
		));
		expect(styles[0]).toMatchObject({ fontSize: 26, lineHeight: 39 });
		expect(styles[1]).not.toHaveProperty("fontSize");
		expect(styles[1]).not.toHaveProperty("lineHeight");
		expect(styles[2]).toMatchObject({ fontSize: expect.closeTo(15.6), lineHeight: expect.closeTo(23.4) });
	});

	it("preserves native script font inheritance and independently scales verse numbers", () => {
		const styles = stylesOf(React.createElement(AppScriptText, { style: { fontSize: 28, lineHeight: 50, fontFamily: "Scripture" } },
			React.createElement(AppScriptText, { style: { fontSize: 12 } }, "1"),
			React.createElement(AppScriptText, { style: { color: "red" } }, "λόγος"),
		));
		expect(styles[0]).toMatchObject({ fontSize: 36.4, lineHeight: 65, fontFamily: "Scripture" });
		expect(styles[1]).toEqual({ fontSize: expect.closeTo(15.6) });
		expect(styles[2]).toEqual({ color: "red" });
	});

	it("scales an explicit input size and line height without changing height limits", () => {
		const [style] = stylesOf(React.createElement(AppTextInput, { style: { fontSize: 16, lineHeight: 22, maxHeight: 140 } }));
		expect(style).toMatchObject({ fontSize: 20.8, lineHeight: 28.6, maxHeight: 140 });
	});

	it("adapts markdown native leaves and preserves link actions and inherited emphasis", () => {
		const onPress = vi.fn();
		const native = React.createElement(NativeText, { style: { fontSize: 17, lineHeight: 28 }, onPress },
			React.createElement(NativeText, { style: { fontWeight: "700" } }, "bold link"));
		const adapted = convertMarkdownTextRuns(native) as React.ReactElement<TextProps>;
		expect(adapted.type).toBe(AppText);
		expect(adapted.props.onPress).toBe(onPress);
		expect(adapted.props.allowFontScaling).toBeUndefined();
		expect(adapted.props.maxFontSizeMultiplier).toBeUndefined();
		const styles = stylesOf(adapted);
		expect(styles[0]).toMatchObject({ fontSize: expect.closeTo(22.1), lineHeight: expect.closeTo(36.4) });
		expect(styles[1]).not.toHaveProperty("fontSize");
		expect(styles[1]).not.toHaveProperty("lineHeight");
	});
});
