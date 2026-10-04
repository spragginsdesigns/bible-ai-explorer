"use client";

import React from "react";
import type { Editor } from "@tiptap/react";
import {
	Bold,
	Italic,
	Underline,
	Strikethrough,
	Highlighter,
	Heading1,
	Heading2,
	Heading3,
	Heading4,
	Heading5,
	Heading6,
	List,
	ListOrdered,
	ListChecks,
	IndentIncrease,
	IndentDecrease,
	Quote,
	Code,
	SquareCode,
	AlignLeft,
	AlignCenter,
	AlignRight,
	Link as LinkIcon,
	Undo,
	Redo,
} from "lucide-react";
import WikilinkPicker from "./WikilinkPicker";
import { formatWikilink } from "./wikilinks";
import type { Note } from "@/types/notes";

interface EditorToolbarProps {
	editor: Editor | null;
	notes?: Note[];
	currentNoteId?: string;
}

interface ToolbarButton {
	icon: React.ReactNode;
	title: string;
	action: () => void;
	isActive?: boolean;
}

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

const HEADING_ICONS: Record<HeadingLevel, React.ComponentType<{ className?: string }>> = {
	1: Heading1,
	2: Heading2,
	3: Heading3,
	4: Heading4,
	5: Heading5,
	6: Heading6,
};

const HEADING_LEVELS: HeadingLevel[] = [1, 2, 3, 4, 5, 6];

const EditorToolbar: React.FC<EditorToolbarProps> = ({ editor, notes, currentNoteId }) => {
	if (!editor) return null;

	// Wikilinks stay plain text in the body; the server parses them on save.
	const insertWikilink = (title: string) => {
		const text = formatWikilink(title);
		if (!text) return;
		editor.chain().focus().insertContent({ type: "text", text }).run();
	};

	const addLink = () => {
		const url = window.prompt("URL:");
		if (url) {
			editor.chain().focus().setLink({ href: url }).run();
		}
	};

	// Indent/outdent act on list items (bullet, ordered or task), as on the
	// Android toolbar; outside a list they do nothing.
	const indent = () => {
		const item = editor.can().sinkListItem("taskItem") ? "taskItem" : "listItem";
		editor.chain().focus().sinkListItem(item).run();
	};
	const outdent = () => {
		const item = editor.can().liftListItem("taskItem") ? "taskItem" : "listItem";
		editor.chain().focus().liftListItem(item).run();
	};

	const headingButtons: ToolbarButton[] = HEADING_LEVELS.map((level) => {
		const Icon = HEADING_ICONS[level];
		return {
			icon: <Icon className="w-4 h-4" />,
			title: `Heading ${level}`,
			action: () => editor.chain().focus().toggleHeading({ level }).run(),
			isActive: editor.isActive("heading", { level }),
		};
	});

	// Groups rendered before the insert-note-link button
	const primaryGroups: ToolbarButton[][] = [
		[
			{
				icon: <Undo className="w-4 h-4" />,
				title: "Undo",
				action: () => editor.chain().focus().undo().run(),
			},
			{
				icon: <Redo className="w-4 h-4" />,
				title: "Redo",
				action: () => editor.chain().focus().redo().run(),
			},
		],
		[
			{
				icon: <Bold className="w-4 h-4" />,
				title: "Bold",
				action: () => editor.chain().focus().toggleBold().run(),
				isActive: editor.isActive("bold"),
			},
			{
				icon: <Italic className="w-4 h-4" />,
				title: "Italic",
				action: () => editor.chain().focus().toggleItalic().run(),
				isActive: editor.isActive("italic"),
			},
			{
				icon: <Underline className="w-4 h-4" />,
				title: "Underline",
				action: () => editor.chain().focus().toggleUnderline().run(),
				isActive: editor.isActive("underline"),
			},
			{
				icon: <Strikethrough className="w-4 h-4" />,
				title: "Strikethrough",
				action: () => editor.chain().focus().toggleStrike().run(),
				isActive: editor.isActive("strike"),
			},
			{
				icon: <Code className="w-4 h-4" />,
				title: "Inline Code",
				action: () => editor.chain().focus().toggleCode().run(),
				isActive: editor.isActive("code"),
			},
			{
				icon: <Highlighter className="w-4 h-4" />,
				title: "Highlight",
				action: () => editor.chain().focus().toggleHighlight().run(),
				isActive: editor.isActive("highlight"),
			},
		],
		headingButtons,
	];

	// Groups rendered after it; on narrow screens these are reached by
	// scrolling the row rather than being hidden.
	const secondaryGroups: ToolbarButton[][] = [
		[
			{
				icon: <List className="w-4 h-4" />,
				title: "Bullet List",
				action: () => editor.chain().focus().toggleBulletList().run(),
				isActive: editor.isActive("bulletList"),
			},
			{
				icon: <ListOrdered className="w-4 h-4" />,
				title: "Ordered List",
				action: () => editor.chain().focus().toggleOrderedList().run(),
				isActive: editor.isActive("orderedList"),
			},
			{
				icon: <ListChecks className="w-4 h-4" />,
				title: "Task List",
				action: () => editor.chain().focus().toggleTaskList().run(),
				isActive: editor.isActive("taskList"),
			},
			{
				icon: <IndentIncrease className="w-4 h-4" />,
				title: "Indent",
				action: indent,
			},
			{
				icon: <IndentDecrease className="w-4 h-4" />,
				title: "Outdent",
				action: outdent,
			},
		],
		[
			{
				icon: <Quote className="w-4 h-4" />,
				title: "Blockquote",
				action: () => editor.chain().focus().toggleBlockquote().run(),
				isActive: editor.isActive("blockquote"),
			},
			{
				icon: <SquareCode className="w-4 h-4" />,
				title: "Code Block",
				action: () => editor.chain().focus().toggleCodeBlock().run(),
				isActive: editor.isActive("codeBlock"),
			},
			{
				icon: <LinkIcon className="w-4 h-4" />,
				title: "Link",
				action: addLink,
				isActive: editor.isActive("link"),
			},
		],
		[
			{
				icon: <AlignLeft className="w-4 h-4" />,
				title: "Align Left",
				action: () => editor.chain().focus().setTextAlign("left").run(),
				isActive: editor.isActive({ textAlign: "left" }),
			},
			{
				icon: <AlignCenter className="w-4 h-4" />,
				title: "Align Center",
				action: () => editor.chain().focus().setTextAlign("center").run(),
				isActive: editor.isActive({ textAlign: "center" }),
			},
			{
				icon: <AlignRight className="w-4 h-4" />,
				title: "Align Right",
				action: () => editor.chain().focus().setTextAlign("right").run(),
				isActive: editor.isActive({ textAlign: "right" }),
			},
		],
	];

	const renderGroup = (group: ToolbarButton[], gi: number, showSep: boolean) => (
		<React.Fragment key={gi}>
			{showSep && (
				<div className="w-px h-5 bg-white/[0.06] mx-1 flex-shrink-0" />
			)}
			{group.map((btn, bi) => (
				<button
					key={bi}
					onClick={btn.action}
					title={btn.title}
					aria-label={btn.title}
					aria-pressed={btn.isActive}
					className={`
						min-w-[32px] min-h-[32px] flex items-center justify-center rounded-md transition-colors flex-shrink-0
						${btn.isActive
							? "text-amber-400 bg-white/[0.06]"
							: "text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.03]"
						}
					`}
				>
					{btn.icon}
				</button>
			))}
		</React.Fragment>
	);

	return (
		// The border and glass span the full width; the scroller inside is
		// capped to the editor's writing column so the toolbar shares its left
		// edge on desktop. Every button stays mounted at every width and the
		// row scrolls when it cannot fit - none are hidden.
		<div className="border-b border-white/[0.06] glass-light flex-shrink-0">
			<div className="relative mx-auto w-full max-w-3xl">
				<div className="flex items-center gap-0.5 px-3 py-1.5 md:px-4 md:py-2 overflow-x-auto scrollbar-hide">
					{primaryGroups.map((group, gi) => renderGroup(group, gi, gi > 0))}
					{notes && (
						<>
							<div className="w-px h-5 bg-white/[0.06] mx-1 flex-shrink-0" />
							<WikilinkPicker
								notes={notes}
								currentNoteId={currentNoteId}
								onSelect={insertWikilink}
							/>
						</>
					)}
					{secondaryGroups.map((group, gi) =>
						renderGroup(group, gi + primaryGroups.length, true)
					)}
					{/* Trailing spacer so the last button clears the fade cue. */}
					<div className="w-6 flex-shrink-0 md:hidden" aria-hidden />
				</div>
				{/* Fade at the right edge: the only hint that the row scrolls,
				    since the scrollbar is suppressed. */}
				<div
					aria-hidden
					className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white/85 dark:from-neutral-950/85 to-transparent md:hidden"
				/>
			</div>
		</div>
	);
};

export default EditorToolbar;
