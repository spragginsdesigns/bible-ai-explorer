import Link from "next/link";
import type { ReactNode } from "react";
import type { LegalBlock, LegalInline } from "@/lib/marketing/legal-content";

interface LegalBlocksProps {
	blocks: LegalBlock[];
	/** Per-page styling; the text itself comes only from legal-content.ts. */
	classNames: { h2: string; link: string; list?: string };
}

function renderInline(
	content: LegalInline[],
	linkClassName: string,
): ReactNode[] {
	return content.map((part, index) => {
		if (typeof part === "string") return part;
		if ("strong" in part) return <strong key={index}>{part.strong}</strong>;
		if (part.href.startsWith("/")) {
			return (
				<Link key={index} href={part.href} className={linkClassName}>
					{part.text}
				</Link>
			);
		}
		return (
			<a key={index} href={part.href} className={linkClassName}>
				{part.text}
			</a>
		);
	});
}

/** Renders a legal document's blocks as the /privacy and /terms pages show them. */
export default function LegalBlocks({ blocks, classNames }: LegalBlocksProps) {
	return blocks.map((block, index) => {
		if (block.type === "h2") {
			return (
				<h2 key={index} className={classNames.h2}>
					{block.text}
				</h2>
			);
		}
		if (block.type === "ul") {
			return (
				<ul key={index} className={classNames.list}>
					{block.items.map((item, itemIndex) => (
						<li key={itemIndex}>{renderInline(item, classNames.link)}</li>
					))}
				</ul>
			);
		}
		return <p key={index}>{renderInline(block.content, classNames.link)}</p>;
	});
}
