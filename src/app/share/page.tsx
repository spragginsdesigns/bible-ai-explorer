import Link from "next/link";
import { redirect } from "next/navigation";
import { combineSharedText, shareActionHref } from "@/lib/share-target";

/**
 * The installed web app's share target (`share_target` in site.webmanifest):
 * text or a link shared from another app lands here, and the user picks what
 * SureWord should do with it. Not a public route, so a signed-out share goes
 * through sign-in and comes back with its query intact. Android's native share
 * sheet offers the same two choices.
 */
export default async function SharePage({
	searchParams,
}: {
	searchParams: Promise<{ title?: string | string[]; text?: string | string[]; url?: string | string[] }>;
}) {
	const shared = combineSharedText(await searchParams);
	if (!shared) redirect("/");

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-4 px-4 py-10">
			<h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Shared with SureWord</h1>
			<p className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-black/[0.09] bg-white/70 p-4 text-sm leading-6 text-neutral-800 dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-neutral-200">
				{shared}
			</p>
			<div className="flex flex-col gap-2 sm:flex-row">
				<Link
					href={shareActionHref("check", shared)}
					className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-amber-500 px-4 text-sm font-bold text-neutral-950 hover:bg-amber-600 dark:bg-amber-400 dark:hover:bg-amber-300"
				>
					Check against Scripture
				</Link>
				<Link
					href={shareActionHref("reply", shared)}
					className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-black/[0.12] px-4 text-sm font-bold text-neutral-800 hover:bg-black/[0.04] dark:border-white/[0.12] dark:text-neutral-100 dark:hover:bg-white/[0.06]"
				>
					Help me reply
				</Link>
			</div>
			<p className="text-xs text-neutral-500">
				Either one opens the chat with this filled in, so you can add to it before you send.
			</p>
		</main>
	);
}
