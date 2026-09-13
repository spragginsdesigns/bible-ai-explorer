"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Globe, Loader2, Sparkles, AlertCircle, Minus } from "lucide-react";
import { formatWorkDuration, type ChatProgress } from "@/lib/chat/progress";

export default function WorkActivity({ progress, isStreaming }: { progress: ChatProgress; isStreaming: boolean }) {
	const [expanded, setExpanded] = useState(false);
	const [extraMs, setExtraMs] = useState(0);
	const live = isStreaming && progress.state === "running";
	useEffect(() => {
		setExtraMs(0);
		if (!live) return;
		const receivedAt = Date.now();
		const timer = setInterval(() => setExtraMs(Date.now() - receivedAt), 1000);
		return () => clearInterval(timer);
	}, [live, progress.sequence, progress.runId]);
	const elapsed = progress.elapsedMs + (live ? extraMs : 0);
	const duration = formatWorkDuration(elapsed);
	const title = live ? `Working for ${duration}` : progress.state === "error" ? `Interrupted after ${duration}` : progress.state === "running" ? `Updates stopped after ${duration}` : `Worked for ${duration}`;
	return <div className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
		<button type="button" aria-expanded={expanded} onClick={() => setExpanded(v => !v)} className="flex min-h-11 items-center gap-2 text-left">
			{live && <Loader2 className="h-4 w-4 motion-safe:animate-spin" />}{title}
			<ChevronDown className={`h-4 w-4 ${expanded ? "rotate-180" : ""}`} />
		</button>
		{live && progress.phase !== "answering" && <div aria-live="polite" className="space-y-3 rounded-2xl border border-amber-600/20 bg-neutral-500/5 p-4 dark:border-amber-400/20">
			<div className="flex items-center gap-2 text-[13px] tracking-wide text-amber-700 dark:text-amber-400/70"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />Activity</div>
			<p className="text-base leading-relaxed text-neutral-800 dark:text-neutral-200">{progress.label}</p>
			{elapsed - progress.lastActivityMs >= 20_000 && <p>Still waiting for the response. No new update yet.</p>}
		</div>}
		{expanded && <div className="mt-2 space-y-3 border-l border-neutral-300 pl-3 dark:border-neutral-700">
			{progress.entries.length === 0 && <p>No additional activity to show yet.</p>}
			{progress.entries.map(entry => {
				const Icon = entry.state === "error" ? AlertCircle : entry.kind === "summary" ? Sparkles : entry.state === "running" ? Loader2 : entry.state === "interrupted" || entry.kind === "status" ? Minus : entry.sources?.length ? Globe : Check;
				return <details key={entry.id} className={entry.kind === "summary" ? "rounded-xl bg-neutral-500/5 px-3 py-1" : undefined}>
					<summary className="flex min-h-11 cursor-pointer list-none items-center gap-2"><Icon className="h-4 w-4 shrink-0" /><span>{entry.label}</span>{(entry.detail || entry.sources?.length) && <ChevronDown className="h-3 w-3 shrink-0" />}</summary>
					{entry.detail && <p className="ml-6 whitespace-pre-wrap break-words leading-relaxed">{entry.detail.replace(/\*\*/g, "")}</p>}
					{entry.sources?.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="ml-6 flex min-h-11 items-center break-words text-amber-700 hover:underline dark:text-amber-400">{source.title}</a>)}
				</details>;
			})}
		</div>}
	</div>;
}
