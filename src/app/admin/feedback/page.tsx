import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FEEDBACK_TAGS } from "@/lib/chat/answer-feedback";
import { FEEDBACK_CATEGORIES } from "@/lib/feedback/in-app-feedback";
import { currentAdminUserId, loadReviewPage, type ReviewItem } from "@/lib/admin/feedback-review";
import {
	REVIEW_WINDOWS,
	parseReviewFilters,
	reviewQueryString,
	type ReviewFilters,
	type ReviewSearchParams,
} from "@/lib/admin/feedback-review-rules";
import MarkReviewedButton from "./MarkReviewedButton";

/**
 * The owner's review queue (docs/FEATURES.md, "Reviewing reports"): every
 * thumbs-down answer and every Send feedback message, newest first, 50 per
 * page, each with a persisted "Mark reviewed".
 *
 * Only ADMIN_USER_IDS may open it. Everyone else, signed in or out, gets the
 * ordinary 404, so the page does not admit it exists. It is not linked from
 * any public UI, not in the sitemap, and noindex. Server-rendered: the
 * browser receives the current page and nothing more.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Review queue",
	robots: { index: false, follow: false, nocache: true },
};

const TAG_LABELS = new Map<string, string>(FEEDBACK_TAGS.map((tag) => [tag.id, tag.label]));
const CATEGORY_LABELS = new Map<string, string>(FEEDBACK_CATEGORIES.map((item) => [item.id, item.label]));

const dateFormat = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeStyle: "short",
	timeZone: "America/Los_Angeles",
});

function href(filters: ReviewFilters, change: Partial<ReviewFilters>): string {
	return `/admin/feedback${reviewQueryString({ ...filters, page: 1, ...change })}`;
}

function FilterLink({ active, to, children }: { active: boolean; to: string; children: React.ReactNode }) {
	return (
		<Link
			href={to}
			className={
				active
					? "rounded-md bg-neutral-100 px-3 py-1 text-sm font-medium text-neutral-950"
					: "rounded-md border border-neutral-700 px-3 py-1 text-sm text-neutral-300 hover:bg-neutral-800"
			}
		>
			{children}
		</Link>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="mt-3">
			<div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
			<div className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-200">{children}</div>
		</div>
	);
}

function ItemCard({ item }: { item: ReviewItem }) {
	const reviewed = Boolean(item.reviewedAt);
	return (
		<li className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2 text-sm">
					<span
						className={
							item.kind === "rating"
								? "rounded bg-red-950 px-2 py-0.5 text-red-300"
								: "rounded bg-sky-950 px-2 py-0.5 text-sky-300"
						}
					>
						{item.kind === "rating" ? "Answer rating" : "Feedback message"}
					</span>
					<time dateTime={item.at} className="text-neutral-400">
						{dateFormat.format(new Date(item.at))}
					</time>
					{reviewed && item.reviewedAt ? (
						<span className="text-neutral-500">reviewed {dateFormat.format(new Date(item.reviewedAt))}</span>
					) : null}
				</div>
				<MarkReviewedButton kind={item.kind} id={item.id} reviewed={reviewed} />
			</div>

			<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-neutral-500">
				<span>user {item.userId}</span>
				{item.kind === "rating" ? (
					<>
						<span>conversation {item.conversationId}</span>
						<span>message {item.id}</span>
						<span>model {item.modelId ?? "unknown"}</span>
						<span>platform not stored</span>
					</>
				) : (
					<>
						<span>platform {item.platform}</span>
						<span>version {item.appVersion ?? "unknown"}</span>
						<span>{item.wantsReply ? "asked for a reply" : "no reply requested"}</span>
					</>
				)}
			</div>

			{item.kind === "rating" ? (
				<>
					<Field label="Reasons">
						{item.tags.length > 0 ? item.tags.map((tag) => TAG_LABELS.get(tag) ?? tag).join(", ") : "None picked"}
					</Field>
					{item.reason ? <Field label="Comment">{item.reason}</Field> : null}
					<Field label="Question">{item.question ?? "(no user message before this answer)"}</Field>
					<details className="mt-3">
						<summary className="cursor-pointer text-xs uppercase tracking-wide text-neutral-500">Answer</summary>
						<div className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-200">{item.answer}</div>
					</details>
				</>
			) : (
				<>
					<Field label="Category">{CATEGORY_LABELS.get(item.category) ?? item.category}</Field>
					<Field label="Message">{item.message}</Field>
				</>
			)}
		</li>
	);
}

export default async function AdminFeedbackPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	if (!(await currentAdminUserId())) notFound();

	const filters = parseReviewFilters((await searchParams) as ReviewSearchParams);
	const { items, hasMore } = await loadReviewPage(filters);

	return (
		<main className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-100">
			<div className="mx-auto max-w-4xl">
				<h1 className="text-2xl font-semibold">Review queue</h1>
				<p className="mt-1 text-sm text-neutral-400">
					Thumbs-down answers and Send feedback messages, newest first. Times are Pacific.
				</p>

				<div className="mt-6 flex flex-col gap-3">
					<div className="flex flex-wrap gap-2">
						<FilterLink active={filters.type === "all"} to={href(filters, { type: "all" })}>All</FilterLink>
						<FilterLink active={filters.type === "rating"} to={href(filters, { type: "rating" })}>
							Answer ratings
						</FilterLink>
						<FilterLink active={filters.type === "message"} to={href(filters, { type: "message" })}>
							Feedback messages
						</FilterLink>
					</div>
					<div className="flex flex-wrap gap-2">
						{REVIEW_WINDOWS.map((days) => (
							<FilterLink key={days} active={filters.days === days} to={href(filters, { days })}>
								Last {days} days
							</FilterLink>
						))}
					</div>
					<div className="flex flex-wrap gap-2">
						<FilterLink active={filters.unreviewedOnly} to={href(filters, { unreviewedOnly: true })}>
							Unreviewed only
						</FilterLink>
						<FilterLink active={!filters.unreviewedOnly} to={href(filters, { unreviewedOnly: false })}>
							Include reviewed
						</FilterLink>
					</div>
				</div>

				{items.length === 0 ? (
					<p className="mt-8 text-neutral-400">Nothing here for these filters.</p>
				) : (
					<ul className="mt-6 flex flex-col gap-4">
						{items.map((item) => (
							<ItemCard key={`${item.kind}-${item.id}`} item={item} />
						))}
					</ul>
				)}

				<nav className="mt-8 flex items-center justify-between text-sm">
					{filters.page > 1 ? (
						<Link className="text-amber-400 hover:underline" href={href(filters, { page: filters.page - 1 })}>
							Newer
						</Link>
					) : (
						<span />
					)}
					<span className="text-neutral-500">Page {filters.page}</span>
					{hasMore ? (
						<Link className="text-amber-400 hover:underline" href={href(filters, { page: filters.page + 1 })}>
							Older
						</Link>
					) : (
						<span />
					)}
				</nav>
			</div>
		</main>
	);
}
