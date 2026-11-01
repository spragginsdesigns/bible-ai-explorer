"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen } from "lucide-react";
import type { SavedProjectView } from "@/lib/beta/sermons/view-types";
import { CARD, GOLD_BUTTON, INPUT, MUTED, SERIF, TEXT_LINK } from "./ui";

const NEW = "new";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

interface Saved {
	projectId: string;
	href: string;
	created: boolean;
	added: { transcript: boolean; passages: number; questions: number };
	note: string | null;
}

function savedMessage(result: Saved): string {
	const parts = [
		result.added.transcript ? "the transcript as a source" : null,
		result.added.passages ? plural(result.added.passages, "passage") : null,
		result.added.questions ? plural(result.added.questions, "question") : null,
	].filter(Boolean);
	const what = parts.length ? `Added ${parts.join(", ")}.` : "The project already has everything from this sermon.";
	return result.note ? `${what} ${result.note}` : what;
}

/**
 * Keep a sermon in a Study Project (LC-17643, docs/beta/sermons.md): a new
 * project named after it, or one of the founder's own. The project gets the
 * transcript as a source, the passages, and the questions marked for
 * research; saving again brings in only what is new.
 */
export default function SaveToProject({
	sermonId,
	title,
	passages,
	research,
	saved,
	choices,
}: {
	sermonId: string;
	title: string;
	passages: number;
	research: number;
	saved: SavedProjectView[];
	choices: { id: string; title: string }[];
}) {
	const router = useRouter();
	// Once a project was started from this sermon, it is offered instead of starting another.
	const started = saved.find((project) => project.created && !project.archived);
	const [target, setTarget] = useState<string>(started?.projectId ?? saved.find((project) => !project.archived)?.projectId ?? NEW);
	const [state, setState] = useState<{ busy: boolean; error: string | null; message: string | null }>({ busy: false, error: null, message: null });
	const savedHere = saved.some((project) => project.projectId === target);
	const brings = [
		"the transcript as a source",
		passages ? `the ${plural(passages, "passage")}` : null,
		research ? `the ${plural(research, "question")} you marked for research` : "any questions you mark for research",
	].filter((part): part is string => part !== null);

	const save = async () => {
		setState({ busy: true, error: null, message: null });
		try {
			const response = await fetch(`/api/beta/sermons/${sermonId}/project`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(target === NEW ? { create: true } : { projectId: target }),
			});
			const data = (await response.json().catch(() => ({}))) as Partial<Saved> & { error?: string };
			if (!response.ok || !data.projectId) {
				setState({ busy: false, error: data.error ?? "Something went wrong. Please try again.", message: null });
				return;
			}
			setTarget(data.projectId);
			setState({ busy: false, error: null, message: savedMessage(data as Saved) });
			router.refresh();
		} catch {
			setState({ busy: false, error: "The connection dropped. Please try again.", message: null });
		}
	};

	return (
		<section aria-labelledby="sermon-project" className={`${CARD} mt-5 p-5`}>
			<h2 id="sermon-project" className={`${SERIF} text-[24px] font-semibold leading-tight`}>Keep it in a Study Project</h2>
			<p className={`mt-1 text-[15px] leading-6 ${MUTED}`}>
				The project gets {brings.slice(0, -1).join(", ")} and {brings[brings.length - 1]}, so its assistant can answer from the sermon.
			</p>
			{saved.length > 0 && (
				<ul className="mt-2" aria-label="Saved in">
					{saved.map((project) => (
						<li key={project.projectId}>
							<Link href={`${project.href}#sources`} className={TEXT_LINK}>
								<FolderOpen size={17} aria-hidden /> Open {project.title}
								{project.archived ? " (archived)" : ""}
							</Link>
						</li>
					))}
				</ul>
			)}
			<div className="mt-3 flex flex-col gap-2 sm:flex-row">
				<label htmlFor="sermon-project-target" className="sr-only">
					Project to save into
				</label>
				<select
					id="sermon-project-target"
					value={target}
					onChange={(event) => {
						setTarget(event.target.value);
						setState({ busy: false, error: null, message: null });
					}}
					className={`${INPUT} sm:flex-1`}
				>
					{!started && <option value={NEW}>A new project: {title}</option>}
					{choices.map((project) => (
						<option key={project.id} value={project.id}>
							{project.title}
						</option>
					))}
				</select>
				<button type="button" className={GOLD_BUTTON} disabled={state.busy} onClick={() => void save()}>
					{state.busy ? "Saving…" : savedHere ? "Update the project" : "Save to project"}
				</button>
			</div>
			{state.error && (
				<p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
					{state.error}
				</p>
			)}
			{state.message && (
				<p role="status" className="mt-2 text-sm">
					{state.message}
				</p>
			)}
		</section>
	);
}
