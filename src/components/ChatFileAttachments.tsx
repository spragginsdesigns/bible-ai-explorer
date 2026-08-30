"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { FileText, ImageIcon, X } from "lucide-react";
import type { ChatAttachmentDescriptor } from "@/lib/chat-attachment-types";

interface ChatFileAttachmentsProps {
	attachments: ChatAttachmentDescriptor[];
	onRemove?: (id: string) => void;
}

function formatBytes(bytes: number): string {
	if (bytes <= 0) return "";
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChatFileAttachments({ attachments, onRemove }: ChatFileAttachmentsProps) {
	const [urls, setUrls] = useState<Record<string, string>>({});

	const refresh = useCallback(async (attachment: ChatAttachmentDescriptor): Promise<string | null> => {
		const response = await fetch("/api/chat/attachments/refresh", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ids: [attachment.id] }),
		});
		if (!response.ok) return null;
		const body = await response.json();
		const next = body.attachments?.[0]?.previewUrl;
		if (typeof next !== "string") return null;
		setUrls((current) => ({ ...current, [attachment.id]: next }));
		return next;
	}, []);

	const openAttachment = useCallback(async (attachment: ChatAttachmentDescriptor) => {
		const popup = window.open("about:blank", "_blank");
		if (!popup) return;
		popup.opener = null;
		const url = await refresh(attachment);
		popup.location.replace(url ?? urls[attachment.id] ?? attachment.previewUrl);
	}, [refresh, urls]);

	return (
		<div className="flex max-w-full flex-wrap gap-2">
			{attachments.map((attachment) => {
				const url = urls[attachment.id] ?? attachment.previewUrl;
				const isImage = attachment.mediaType.startsWith("image/");
				return (
					<div
						key={attachment.id}
						className="group relative flex min-w-0 max-w-[240px] items-center gap-2 rounded-xl border border-black/[0.09] bg-white/70 p-2 pr-3 dark:border-white/[0.09] dark:bg-white/[0.04]"
					>
						<button
							type="button"
							onClick={() => void openAttachment(attachment)}
							className="flex min-w-0 flex-1 items-center gap-2 text-left"
							aria-label={`Open ${attachment.filename}`}
						>
							{isImage ? (
								<Image
									src={url}
									alt=""
									width={40}
									height={40}
									unoptimized
									onError={() => void refresh(attachment)}
									className="h-10 w-10 flex-shrink-0 rounded-lg object-cover"
								/>
							) : (
								<span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400">
									{attachment.mediaType === "application/pdf" ? <FileText className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
								</span>
							)}
							<span className="min-w-0">
								<span className="block truncate text-metadata font-medium text-neutral-800 dark:text-neutral-200">
									{attachment.filename}
								</span>
								{attachment.size > 0 && (
									<span className="block text-metadata text-neutral-500">{formatBytes(attachment.size)}</span>
								)}
							</span>
						</button>
						{onRemove && (
							<button
								type="button"
								onClick={() => onRemove(attachment.id)}
								aria-label={`Remove ${attachment.filename}`}
								className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-black/10 bg-white text-neutral-600 shadow-sm hover:text-red-600 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-300"
							>
								<X className="h-3 w-3" />
							</button>
						)}
					</div>
				);
			})}
		</div>
	);
}
