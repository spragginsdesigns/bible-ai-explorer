import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { bookByOrder } from "@/lib/bible/books";

export interface GlobalShortcutHandlers {
	/** `n` — start a new chat. */
	onNewChat?: () => void;
	/** `h` — open or focus the conversation history (the sidebar search). */
	onOpenHistory?: () => void;
}

/** The chat composer's textarea, found by its stable placeholder. */
const COMPOSER_SELECTOR = 'textarea[placeholder="Ask a question about the Bible..."]';

/**
 * How many mounted hooks share the single window listener. Chat surfaces can
 * mount this hook from more than one component (sidebar, notes page) without
 * firing bindings twice.
 */
let mountCount = 0;

function isEditableTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
	);
}

/**
 * Global keyboard bindings for the web app (B9): `n` new chat, `/` focus the
 * composer, `h` history, `[` / `]` previous and next chapter on the Bible
 * reader page. No modifiers; keystrokes meant for a field are left alone.
 * Multiple mounts share one listener; the first mount wins.
 */
export function useGlobalShortcuts(handlers: GlobalShortcutHandlers = {}): void {
	const router = useRouter();
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;

	useEffect(() => {
		mountCount += 1;
		if (mountCount > 1) {
			return () => {
				mountCount -= 1;
			};
		}

		const navigateChapter = (delta: number) => {
			if (window.location.pathname !== "/bible/chapter") return;
			const params = new URLSearchParams(window.location.search);
			const order = Number.parseInt(params.get("book") ?? "1", 10);
			const chapter = Number.parseInt(params.get("chapter") ?? "1", 10);
			const book = bookByOrder(order);
			if (!book) return;
			const next = Math.min(Math.max(chapter + delta, 1), book.chapters);
			if (next === chapter) return;
			params.set("chapter", String(next));
			params.delete("verse");
			router.push(`/bible/chapter?${params.toString()}`);
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			if (isEditableTarget(event.target)) return;
			switch (event.key) {
				case "n":
					event.preventDefault();
					handlersRef.current.onNewChat?.();
					break;
				case "/":
					event.preventDefault();
					document.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR)?.focus();
					break;
				case "h":
					event.preventDefault();
					handlersRef.current.onOpenHistory?.();
					break;
				case "[":
					navigateChapter(-1);
					break;
				case "]":
					navigateChapter(1);
					break;
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => {
			mountCount -= 1;
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [router]);
}
