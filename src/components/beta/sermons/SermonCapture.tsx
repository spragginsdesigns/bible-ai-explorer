"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileAudio, Mic, Square } from "lucide-react";
import { CHUNK_SAMPLE_RATE, SERMON_MAX_SECONDS, formatClock } from "@/lib/beta/sermons/sermons-rules";
import { decodeToMono, pieceBounds, recorderType, wavPiece } from "./audio";
import { CARD, EYEBROW, GOLD_BUTTON, INPUT, MUTED, QUIET_BUTTON, SERIF, sermonHref } from "./ui";

type Phase =
	| { kind: "idle" }
	| { kind: "recording"; startedAt: number }
	| { kind: "preparing" }
	| { kind: "transcribing"; done: number; of: number }
	| { kind: "finding" }
	| { kind: "failed"; message: string; canResume: boolean };

interface Job {
	samples: Float32Array;
	bounds: number[];
	sermonId: string | null;
	source: "upload" | "recording";
	fileName: string | null;
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
	const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
	return { ok: response.ok, status: response.status, data: await response.json().catch(() => ({})) };
}

/**
 * Upload or record a sermon (LC-17643). Nothing leaves the browser until the
 * founder confirms they may use the recording; then the audio is cut into
 * pieces here and each piece is transcribed in order. A failed piece can be
 * retried without starting over or paying again for the pieces before it.
 */
export default function SermonCapture() {
	const router = useRouter();
	const [title, setTitle] = useState("");
	const [preacher, setPreacher] = useState("");
	const [permission, setPermission] = useState(false);
	const [phase, setPhase] = useState<Phase>({ kind: "idle" });
	const [now, setNow] = useState(0);
	const job = useRef<Job | null>(null);
	const recorder = useRef<MediaRecorder | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const busy = phase.kind === "preparing" || phase.kind === "transcribing" || phase.kind === "finding" || phase.kind === "recording";

	useEffect(() => {
		if (phase.kind !== "recording") return;
		const timer = setInterval(() => {
			const elapsed = (Date.now() - phase.startedAt) / 1000;
			setNow(elapsed);
			if (elapsed >= SERMON_MAX_SECONDS) recorder.current?.stop();
		}, 500);
		return () => clearInterval(timer);
	}, [phase]);

	useEffect(() => () => recorder.current?.stream.getTracks().forEach((track) => track.stop()), []);

	async function run() {
		const current = job.current;
		if (!current) return;
		try {
			if (!current.sermonId) {
				const created = await postJson("/api/beta/sermons", {
					title,
					preacher,
					permission,
					source: current.source,
					fileName: current.fileName,
					durationSec: current.samples.length / CHUNK_SAMPLE_RATE,
				});
				if (!created.ok || typeof created.data.sermonId !== "string") {
					setPhase({ kind: "failed", message: String(created.data.error ?? "The sermon could not be started."), canResume: false });
					return;
				}
				current.sermonId = created.data.sermonId;
			}
			const id = current.sermonId;
			let index = 0;
			let attempts = 0;
			while (index < current.bounds.length) {
				setPhase({ kind: "transcribing", done: index, of: current.bounds.length });
				const from = index === 0 ? 0 : current.bounds[index - 1];
				const response = await fetch(`/api/beta/sermons/${id}/pieces?index=${index}`, {
					method: "POST",
					headers: { "Content-Type": "audio/wav" },
					body: wavPiece(current.samples, from, current.bounds[index]),
				});
				const data = (await response.json().catch(() => ({}))) as { transcribed?: number; error?: string };
				if (response.ok && typeof data.transcribed === "number") {
					index = data.transcribed;
					attempts = 0;
					continue;
				}
				attempts += 1;
				if (response.status < 500 || attempts >= 3) {
					setPhase({ kind: "failed", message: data.error ?? "That part of the sermon could not be transcribed.", canResume: response.status >= 500 || response.status === 409 });
					return;
				}
			}
			setPhase({ kind: "finding" });
			const finished = await postJson(`/api/beta/sermons/${id}/finish`, {});
			if (!finished.ok) {
				setPhase({ kind: "failed", message: String(finished.data.error ?? "The passages could not be found."), canResume: true });
				return;
			}
			job.current = null;
			router.push(sermonHref(id));
			router.refresh();
		} catch {
			setPhase({ kind: "failed", message: "The connection dropped. Your progress is kept; try again.", canResume: true });
		}
	}

	async function start(blob: Blob, source: Job["source"], fileName: string | null) {
		setPhase({ kind: "preparing" });
		let samples: Float32Array;
		try {
			samples = await decodeToMono(blob);
		} catch {
			setPhase({ kind: "failed", message: "That file could not be read as audio. Try an MP3, M4A or WAV.", canResume: false });
			return;
		}
		const seconds = samples.length / CHUNK_SAMPLE_RATE;
		if (seconds < 5) return setPhase({ kind: "failed", message: "That recording is too short to study.", canResume: false });
		if (seconds > SERMON_MAX_SECONDS + 1) return setPhase({ kind: "failed", message: `A sermon can be up to ${SERMON_MAX_SECONDS / 60} minutes long.`, canResume: false });
		job.current = { samples, bounds: pieceBounds(samples), sermonId: null, source, fileName };
		await run();
	}

	async function record() {
		const type = recorderType();
		if (!type || !navigator.mediaDevices?.getUserMedia) {
			setPhase({ kind: "failed", message: "This browser cannot record audio. Upload a file instead.", canResume: false });
			return;
		}
		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			setPhase({ kind: "failed", message: "SureWord needs the microphone to record. Allow it in your browser, or upload a file.", canResume: false });
			return;
		}
		const chunks: Blob[] = [];
		const media = new MediaRecorder(stream, { mimeType: type });
		media.ondataavailable = (event) => event.data.size > 0 && chunks.push(event.data);
		media.onstop = () => {
			stream.getTracks().forEach((track) => track.stop());
			recorder.current = null;
			void start(new Blob(chunks, { type }), "recording", null);
		};
		recorder.current = media;
		media.start(1000);
		setNow(0);
		setPhase({ kind: "recording", startedAt: Date.now() });
	}

	return (
		<section aria-labelledby="sermon-new" className={`${CARD} p-5 sm:p-6`}>
			<h2 id="sermon-new" className={`${SERIF} text-[30px] font-semibold leading-tight`}>Add a sermon</h2>
			<p className={`mt-1 max-w-2xl text-[15px] leading-6 ${MUTED}`}>
				Upload a recording or record one here. SureWord transcribes it with timestamps and finds every passage it names or quotes. Study notes and questions are written only when you ask.
			</p>
			<div className="mt-5 grid gap-3 sm:grid-cols-2">
				<label className="block">
					<span className={EYEBROW}>Title</span>
					<input className={`${INPUT} mt-1.5`} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Treasure in earthen vessels" disabled={busy} />
				</label>
				<label className="block">
					<span className={EYEBROW}>Preacher</span>
					<input className={`${INPUT} mt-1.5`} value={preacher} onChange={(event) => setPreacher(event.target.value)} maxLength={80} placeholder="Optional" disabled={busy} />
				</label>
			</div>
			<label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border border-amber-700/25 bg-amber-500/[.06] p-4 dark:border-amber-300/25">
				<input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#b8862f]" checked={permission} onChange={(event) => setPermission(event.target.checked)} disabled={busy} />
				<span className="text-[15px] leading-6">
					<strong>I have permission to use this recording.</strong> It is my own, the church or speaker allows it, or it is in the public domain. The audio is sent to OpenAI to be transcribed and is not kept; the transcript is saved to your study.
				</span>
			</label>

			{phase.kind === "recording" ? (
				<div className="mt-5 flex flex-wrap items-center gap-4" role="status">
					<span className="inline-flex items-center gap-2 text-[17px] font-bold tabular-nums">
						<span className="h-3 w-3 rounded-full bg-red-600" aria-hidden /> Recording {formatClock(now)}
					</span>
					<button type="button" className={GOLD_BUTTON} onClick={() => recorder.current?.stop()}>
						<Square size={18} aria-hidden /> Stop and transcribe
					</button>
				</div>
			) : (
				<div className="mt-5 flex flex-wrap gap-3">
					<button type="button" className={GOLD_BUTTON} disabled={!permission || busy} onClick={() => fileInput.current?.click()}>
						<FileAudio size={19} aria-hidden /> Upload audio
					</button>
					<button type="button" className={QUIET_BUTTON} disabled={!permission || busy} onClick={() => void record()}>
						<Mic size={18} aria-hidden /> Record
					</button>
					<input
						ref={fileInput}
						type="file"
						accept="audio/*,.mp3,.m4a,.wav,.webm,.ogg,.aac"
						className="sr-only"
						tabIndex={-1}
						aria-label="Sermon audio file"
						onChange={(event) => {
							const file = event.target.files?.[0];
							event.target.value = "";
							if (file && permission) void start(file, "upload", file.name);
						}}
					/>
				</div>
			)}
			{!permission && phase.kind === "idle" && <p className={`mt-3 text-sm ${MUTED}`}>Tick the permission box to upload or record.</p>}

			<div aria-live="polite" className="mt-4">
				{phase.kind === "preparing" && <p className="text-[15px] font-semibold">Preparing the audio…</p>}
				{phase.kind === "transcribing" && (
					<div>
						<p className="text-[15px] font-semibold">Transcribing part {Math.min(phase.done + 1, phase.of)} of {phase.of}…</p>
						<div className="mt-2 h-2 overflow-hidden rounded-full bg-black/[.08] dark:bg-white/[.1]">
							<div className="h-full rounded-full bg-[#e5b664] transition-[width]" style={{ width: `${Math.round((phase.done / phase.of) * 100)}%` }} />
						</div>
					</div>
				)}
				{phase.kind === "finding" && <p className="text-[15px] font-semibold">Finding every passage it names or quotes…</p>}
				{phase.kind === "failed" && (
					<div role="alert" className="rounded-2xl border border-red-700/25 bg-red-500/[.06] p-4 text-[15px]">
						<p>{phase.message}</p>
						<div className="mt-3 flex flex-wrap gap-3">
							{phase.canResume && job.current && (
								<button type="button" className={QUIET_BUTTON} onClick={() => void run()}>
									Try again
								</button>
							)}
							<button type="button" className={QUIET_BUTTON} onClick={() => { job.current = null; setPhase({ kind: "idle" }); }}>
								{phase.canResume && job.current ? "Start over" : "OK"}
							</button>
						</div>
					</div>
				)}
			</div>
		</section>
	);
}
