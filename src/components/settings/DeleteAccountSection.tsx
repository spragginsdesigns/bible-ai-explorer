"use client";

import React, { useRef, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { Loader2, Trash2 } from "lucide-react";
import {
	CONFIRMATION_WORD,
	DELETE_CONFIRM_MESSAGE,
	DELETE_CONFIRM_TITLE,
	DELETE_ERROR_TITLE,
	DELETE_TYPE_MESSAGE,
	DELETE_TYPE_TITLE,
	initialDeletionState,
	isConfirmationTyped,
	reduceDeletion,
	requestAccountDeletion,
	type DeletionState,
} from "@/lib/account-deletion-client";
import { clearSyncedPreferences } from "@/lib/preferencesSync";

type Step = "closed" | "confirm" | "type";

const dangerButton =
	"flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-red-500/25 dark:border-red-400/20 bg-red-500/10 dark:bg-red-400/10 text-sm font-bold text-red-600 dark:text-red-400 hover:bg-red-500/20 dark:hover:bg-red-400/20 transition-colors disabled:opacity-40 disabled:pointer-events-none";
const cancelButton =
	"flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-black/[0.1] dark:border-white/[0.08] text-sm font-bold text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors";

/**
 * The "Delete account" control under Sign out. Two steps before anything is
 * sent (what goes, then type DELETE), progress while it runs, and the shared
 * status handling. On success it clears this browser's per-account cache the
 * way sign-out does, then signs out of Clerk and returns home.
 */
export default function DeleteAccountSection() {
	const { signOut } = useClerk();
	const [step, setStep] = useState<Step>("closed");
	const [typed, setTyped] = useState("");
	const stateRef = useRef<DeletionState>(initialDeletionState);
	const [state, setState] = useState<DeletionState>(initialDeletionState);

	const update = (next: DeletionState) => {
		stateRef.current = next;
		setState(next);
	};

	const deleting = state.phase.kind === "deleting";
	const deleted = state.phase.kind === "deleted";
	const errorMessage = state.phase.kind === "failed" ? state.phase.message : null;
	const confirmed = isConfirmationTyped(typed);

	const run = async () => {
		const current = stateRef.current;
		if (current.phase.kind === "deleting" || current.phase.kind === "deleted") return;
		setStep("closed");
		update({ ...current, phase: { kind: "deleting" } });
		const next = reduceDeletion(stateRef.current, await requestAccountDeletion());
		update(next);
		if (next.phase.kind !== "deleted") return;
		clearSyncedPreferences();
		try {
			await signOut({ redirectUrl: "/" });
		} catch {
			window.location.assign("/");
		}
	};

	const dismissError = () => update({ ...stateRef.current, phase: { kind: "idle" } });

	if (deleting || deleted) {
		return (
			<div
				role="status"
				className="flex min-h-[44px] items-center justify-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400"
			>
				<Loader2 className="w-4 h-4 animate-spin" />
				Deleting account…
			</div>
		);
	}

	if (errorMessage) {
		return (
			<div role="alert" className="flex flex-col gap-3">
				<div>
					<p className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">{DELETE_ERROR_TITLE}</p>
					<p className="text-[13px] text-neutral-500 dark:text-neutral-400">{errorMessage}</p>
				</div>
				<div className="flex gap-2">
					<button type="button" onClick={dismissError} className={cancelButton}>
						Cancel
					</button>
					<button type="button" onClick={() => void run()} className={dangerButton}>
						Try again
					</button>
				</div>
			</div>
		);
	}

	if (step === "confirm") {
		return (
			<div role="alertdialog" aria-labelledby="delete-account-title" className="flex flex-col gap-3">
				<div>
					<p id="delete-account-title" className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
						{DELETE_CONFIRM_TITLE}
					</p>
					<p className="text-[13px] text-neutral-500 dark:text-neutral-400">{DELETE_CONFIRM_MESSAGE}</p>
				</div>
				<div className="flex gap-2">
					<button type="button" onClick={() => setStep("closed")} className={cancelButton}>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => {
							setTyped("");
							setStep("type");
						}}
						className={dangerButton}
					>
						Continue
					</button>
				</div>
			</div>
		);
	}

	if (step === "type") {
		return (
			<form
				role="alertdialog"
				aria-labelledby="delete-account-type-title"
				className="flex flex-col gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					if (confirmed) void run();
				}}
			>
				<div>
					<p id="delete-account-type-title" className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
						{DELETE_TYPE_TITLE}
					</p>
					<p className="text-[13px] text-neutral-500 dark:text-neutral-400">{DELETE_TYPE_MESSAGE}</p>
				</div>
				<input
					value={typed}
					onChange={(event) => setTyped(event.target.value)}
					placeholder={CONFIRMATION_WORD}
					aria-label="Type DELETE to confirm"
					autoComplete="off"
					autoCorrect="off"
					autoCapitalize="characters"
					spellCheck={false}
					autoFocus
					className="min-h-[44px] rounded-xl border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.03] px-3 text-[15px] text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:border-red-500/40"
				/>
				<div className="flex gap-2">
					<button type="button" onClick={() => setStep("closed")} className={cancelButton}>
						Cancel
					</button>
					<button type="submit" disabled={!confirmed} className={dangerButton}>
						Delete account
					</button>
				</div>
			</form>
		);
	}

	return (
		<button
			type="button"
			onClick={() => setStep("confirm")}
			title="Permanently deletes your SureWord account and data"
			className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-400/10 transition-colors"
		>
			<Trash2 className="w-4 h-4" />
			Delete account
		</button>
	);
}
