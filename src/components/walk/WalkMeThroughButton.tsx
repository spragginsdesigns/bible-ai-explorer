"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2 } from "lucide-react";
import { openWelcomeConversation, startWalkWithMe } from "@/lib/walk-client";

/**
 * Settings → "Walk me through SureWord": the quiet way back into the welcome
 * for anyone, any time (it replaces typing /onboard). The server reopens the
 * welcome conversation where it stopped, or starts one.
 */
export default function WalkMeThroughButton() {
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const open = async () => {
		if (pending) return;
		setPending(true);
		setError(null);
		const result = await startWalkWithMe("manual");
		if (result?.status === "active") {
			openWelcomeConversation(router, result.conversationId);
			return;
		}
		setPending(false);
		setError("Couldn't open the walkthrough. Try again.");
	};

	return (
		<>
			<button
				type="button"
				onClick={() => void open()}
				disabled={pending}
				className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-2xl px-4 text-left text-[15px] font-semibold text-neutral-900 transition-colors hover:bg-black/[0.03] disabled:opacity-60 dark:text-neutral-100 dark:hover:bg-white/[0.03]"
			>
				Walk me through SureWord
				{pending ? (
					<Loader2 className="w-4 h-4 animate-spin text-neutral-400 dark:text-neutral-600" aria-hidden />
				) : (
					<ChevronRight className="w-4 h-4 text-neutral-400 dark:text-neutral-600" aria-hidden />
				)}
			</button>
			{error && (
				<p role="alert" className="px-4 pb-3 text-xs text-red-600 dark:text-red-400">
					{error}
				</p>
			)}
		</>
	);
}
