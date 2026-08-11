import React, { useCallback, useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@clerk/expo";
import { useThemedStyles } from "@/features/settings/settingsStore";
import { radius, spacing, type Colors } from "@/theme";
import type { GetToken } from "@/lib/api";
import {
	type ChatAttachmentDescriptor,
	refreshChatAttachment,
} from "./fileAttachments";

interface FileAttachmentCardsProps {
	attachments: ChatAttachmentDescriptor[];
	onRemove?: (id: string) => void;
}

function formatBytes(bytes: number): string {
	if (bytes <= 0) return "";
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileAttachmentCards({ attachments, onRemove }: FileAttachmentCardsProps) {
	const styles = useThemedStyles(createStyles);
	const { getToken } = useAuth();
	const [urls, setUrls] = useState<Record<string, string>>({});
	const authToken = useCallback<GetToken>(
		(options) => getToken(options?.fresh ? { skipCache: true } : undefined),
		[getToken],
	);

	const refresh = useCallback(async (attachment: ChatAttachmentDescriptor) => {
		try {
			const result = await refreshChatAttachment(authToken, attachment.id);
			if (!result) return null;
			setUrls((current) => ({ ...current, [attachment.id]: result.previewUrl }));
			return result.previewUrl;
		} catch {
			return null;
		}
	}, [authToken]);

	const open = useCallback(async (attachment: ChatAttachmentDescriptor) => {
		const fresh = await refresh(attachment);
		await Linking.openURL(fresh ?? urls[attachment.id] ?? attachment.previewUrl);
	}, [refresh, urls]);

	return (
		<View style={styles.list}>
			{attachments.map((attachment) => {
				const isImage = attachment.mediaType.startsWith("image/");
				return (
					<View key={attachment.id} style={styles.card}>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={`Open ${attachment.filename}`}
							onPress={() => void open(attachment)}
							style={({ pressed }) => [styles.open, pressed && styles.pressed]}
						>
							{isImage ? (
								<Image
									source={{ uri: urls[attachment.id] ?? attachment.previewUrl }}
									onError={() => void refresh(attachment)}
									style={styles.preview}
								/>
							) : (
								<View style={styles.fileIcon}>
									<Text style={styles.fileGlyph}>{attachment.mediaType === "application/pdf" ? "PDF" : "TXT"}</Text>
								</View>
							)}
							<View style={styles.labelWrap}>
								<Text numberOfLines={1} style={styles.filename}>{attachment.filename}</Text>
								{attachment.size > 0 && <Text style={styles.size}>{formatBytes(attachment.size)}</Text>}
							</View>
						</Pressable>
						{onRemove && (
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={`Remove ${attachment.filename}`}
								onPress={() => onRemove(attachment.id)}
								hitSlop={8}
								style={styles.remove}
							>
								<Text style={styles.removeGlyph}>×</Text>
							</Pressable>
						)}
					</View>
				);
			})}
		</View>
	);
}

const createStyles = (c: Colors) => StyleSheet.create({
	list: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
	card: {
		position: "relative",
		maxWidth: 240,
		backgroundColor: c.surface,
		borderColor: c.borderStrong,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: radius.md,
	},
	open: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm },
	pressed: { opacity: 0.7 },
	preview: { width: 42, height: 42, borderRadius: radius.sm, backgroundColor: c.surfaceStrong },
	fileIcon: {
		width: 42, height: 42, borderRadius: radius.sm, alignItems: "center", justifyContent: "center",
		backgroundColor: c.accentSoft,
	},
	fileGlyph: { color: c.accent, fontSize: 10, fontWeight: "700" },
	labelWrap: { minWidth: 0, flexShrink: 1, paddingRight: spacing.sm },
	filename: { color: c.text, fontSize: 12.5, fontWeight: "600" },
	size: { color: c.textFaint, fontSize: 10, marginTop: 2 },
	remove: {
		position: "absolute", right: -6, top: -6, width: 22, height: 22, borderRadius: radius.full,
		alignItems: "center", justifyContent: "center", backgroundColor: c.bgElevated,
		borderColor: c.borderStrong, borderWidth: StyleSheet.hairlineWidth,
	},
	removeGlyph: { color: c.textMuted, fontSize: 15, lineHeight: 17 },
});
