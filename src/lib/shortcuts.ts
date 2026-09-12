import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { bookByOrder } from "@/lib/bible/books";

export interface GlobalShortcutHandlers {
	/** `n`: start a new chat. */
	onNewChat?: () => void;
	/** `h`: open or focus the conversation history (the sidebar search). */
	onOpenHistory?: () => void;
}

/** The chat composer's textarea, found by its stable placeholder. */
const COMPOSER_SELECTOR = 'textarea[placeholder="Ask a question about the Bible..."]';

interface ShortcutSubscriber {
	handlers: { current: GlobalShortcutHandlers };
	router: ReturnType<typeof useRouter>;
}

/** Mounted consumers share one listener, while each keeps its own handlers. */
const subscribers = new Set<ShortcutSubscriber>();

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return Boolean(
		target.closest("input, textarea, select") ||
			target.isContentEditable ||
			target.closest('[contenteditable]:not([contenteditable="false"])')
	);
}

function hasOpenDialog(): boolean {
	return [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]')].some(
		(dialog) => {
			if (dialog.getAttribute("aria-hidden") === "true") return false;
			const style = window.getComputedStyle(dialog);
			return style.display !== "none" && style.visibility !== "hidden";
		}
	);
}

function subscriberWith(handler: keyof GlobalShortcutHandlers): ShortcutSubscriber | undefined {
	return [...subscribers].find((subscriber) => subscriber.handlers.current[handler]);
}

/** Navigate with the same cross-book semantics as ChapterReader's buttons. */
function navigateChapter(delta: -1 | 1): boolean {
	if (window.location.pathname !== "/bible/chapter") return false;
	const subscriber = subscribers.values().next().value as ShortcutSubscriber | undefined;
	if (!subscriber) return false;

	const params = new URLSearchParams(window.location.search);
	const order = Number.parseInt(params.get("book") ?? "1", 10);
	const chapter = Number.parseInt(params.get("chapter") ?? "1", 10);
	const book = bookByOrder(order);
	if (!book || chapter < 1 || chapter > book.chapters) return false;

	let target: { order: number; chapter: number } | null = null;
	if (delta === -1) {
		const previousBook = bookByOrder(order - 1);
		target = chapter > 1
			? { order, chapter: chapter - 1 }
			: previousBook
				? { order: previousBook.order, chapter: previousBook.chapters }
				: null;
	} else {
		const nextBook = bookByOrder(order + 1);
		target = chapter < book.chapters
			? { order, chapter: chapter + 1 }
			: nextBook
				? { order: nextBook.order, chapter: 1 }
				: null;
	}
	if (!target) return false;

	params.set("book", String(target.order));
	params.set("chapter", String(target.chapter));
	params.delete("verse");
	subscriber.router.push(`/bible/chapter?${params.toString()}`);
	return true;
}

function onGlobalKeyDown(event: KeyboardEvent): void {
	if (
		event.defaultPrevented ||
		event.repeat ||
		event.isComposing ||
		event.keyCode === 229 ||
		event.ctrlKey ||
		event.metaKey ||
		event.altKey ||
		isEditableTarget(event.target) ||
		isEditableTarget(document.activeElement) ||
		hasOpenDialog()
	) {
		return;
	}

	switch (event.key) {
		case "n": {
			const subscriber = subscriberWith("onNewChat");
			if (!subscriber) return;
			event.preventDefault();
			subscriber.handlers.current.onNewChat?.();
			break;
		}
		case "/": {
			const composer = document.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR);
			if (!composer) return;
			event.preventDefault();
			composer.focus();
			break;
		}
		case "h": {
			const subscriber = subscriberWith("onOpenHistory");
			if (!subscriber) return;
			event.preventDefault();
			subscriber.handlers.current.onOpenHistory?.();
			break;
		}
		case "[":
			if (navigateChapter(-1)) event.preventDefault();
			break;
		case "]":
			if (navigateChapter(1)) event.preventDefault();
			break;
	}
}

/**
 * Global keyboard bindings for the web app (B9): `n` new chat, `/` focus the
 * composer, `h` history, `[` / `]` previous and next chapter on the Bible
 * reader page. No modifiers; keystrokes meant for a field, an IME session, or
 * an open dialog are left alone. Multiple mounts share one listener.
 */
export function useGlobalShortcuts(handlers: GlobalShortcutHandlers = {}): void {
	const router = useRouter();
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;

	useEffect(() => {
		const subscriber: ShortcutSubscriber = { handlers: handlersRef, router };
		subscribers.add(subscriber);
		if (subscribers.size === 1) window.addEventListener("keydown", onGlobalKeyDown);
		return () => {
			subscribers.delete(subscriber);
			if (subscribers.size === 0) window.removeEventListener("keydown", onGlobalKeyDown);
		};
	}, [router]);
}
