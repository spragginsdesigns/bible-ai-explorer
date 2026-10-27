import React from "react";
import { Text as NativeText } from "react-native";
import { renderRules, type RenderFunction, type RenderRules } from "react-native-markdown-display";
import { AppText } from "@/components/AppText";

/**
 * The markdown library supplies native Text for leaves, emphasis, links, code
 * and list markers. Keep its rendering and link behavior, but route every text
 * run through the same sizing primitive. Style bags remain unscaled, so an
 * explicit nested size is multiplied once and inherited runs stay inherited.
 */
export function convertMarkdownTextRuns(node: React.ReactNode): React.ReactNode {
	if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return node;
	const children = React.Children.map(node.props.children, convertMarkdownTextRuns);
	if (node.type === NativeText) return React.createElement(AppText, { ...node.props, key: node.key }, children);
	if (children == null) return node;
	return React.cloneElement(node, undefined, children);
}

export const appMarkdownRules: RenderRules = Object.fromEntries(
	Object.entries(renderRules).map(([name, render]) => [
		name,
		render ? ((...args) => convertMarkdownTextRuns(render(...args))) as RenderFunction : render,
	]),
);
