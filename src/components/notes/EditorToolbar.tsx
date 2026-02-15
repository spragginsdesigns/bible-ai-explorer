"use client";

import React from "react";
import type { Editor } from "@tiptap/react";
import {
	Bold,
	Italic,
	Underline,
	Highlighter,
	Heading1,
	Heading2,
	Heading3,
	List,
	ListOrdered,
	ListChecks,
	Quote,
	Code,
	AlignLeft,
	AlignCenter,
	AlignRight,
	Link as LinkIcon,
	Undo,
	Redo,
} from "lucide-react";

interface EditorToolbarProps {
	editor: Editor | null;
}

interface ToolbarButton {
	icon: React.ReactNode;
	title: string;
	action: () => void;
	isActive?: boolean;
}

const EditorToolbar: React.FC<EditorToolbarProps> = ({ editor }) => {
	if (!editor) return null;

	const addLink = () => {
		const url = window.prompt("URL:");
		if (url) {
			editor.chain().focus().setLink({ href: url }).run();
		}
	};

	const groups: ToolbarButton[][] = [
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
				icon: <Highlighter className="w-4 h-4" />,
				title: "Highlight",
				action: () => editor.chain().focus().toggleHighlight().run(),
				isActive: editor.isActive("highlight"),
			},
		],
		[
			{
				icon: <Heading1 className="w-4 h-4" />,
				title: "Heading 1",
				action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
				isActive: editor.isActive("heading", { level: 1 }),
			},
			{
				icon: <Heading2 className="w-4 h-4" />,
				title: "Heading 2",
				action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
				isActive: editor.isActive("heading", { level: 2 }),
			},
			{
				icon: <Heading3 className="w-4 h-4" />,
				title: "Heading 3",
				action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
				isActive: editor.isActive("heading", { level: 3 }),
			},
		],
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
		],
		[
			{
				icon: <Quote className="w-4 h-4" />,
				title: "Blockquote",
				action: () => editor.chain().focus().toggleBlockquote().run(),
				isActive: editor.isActive("blockquote"),
			},
			{
				icon: <Code className="w-4 h-4" />,
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

	return (
		<div className="flex items-center gap-0.5 px-3 py-2 border-b border-white/[0.06] glass-light overflow-x-auto scrollbar-hide">
			{groups.map((group, gi) => (
				<React.Fragment key={gi}>
					{gi > 0 && (
						<div className="w-px h-5 bg-white/[0.06] mx-1 flex-shrink-0" />
					)}
					{group.map((btn, bi) => (
						<button
							key={bi}
							onClick={btn.action}
							title={btn.title}
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
			))}
		</div>
	);
};

export default EditorToolbar;
