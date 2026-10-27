"use client";

import { useState, type FormEvent } from "react";
import { Link2, Plus, Trash2, X } from "lucide-react";
import { useModalFocus } from "@/components/useModalFocus";
import {
	CONNECTION_LABEL_MAX,
	CONNECTION_REFS_MAX,
	NODE_LABEL_MAX,
	NODE_NOTE_MAX,
	NODE_REFS_MAX,
	READINGS_MAX,
	childrenOf,
	formatPassage,
	nextNodeId,
	parsePassage,
	subtreeIds,
	type ConceptMap,
	type MapNode,
} from "@/lib/beta/maps/map-rules";
import { kjvVerseCounter, MAP_BOOKS, readPassage } from "@/lib/beta/maps/passages";

const field = "w-full rounded-2xl border border-black/15 bg-white/80 px-3.5 py-2.5 text-base outline-none focus:border-amber-700/50 dark:border-white/15 dark:bg-white/[.04] dark:focus:border-amber-300/50";
const label = "text-xs font-bold uppercase tracking-[.16em] text-neutral-600 dark:text-[#b3ad9e]";
const smallButton = "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-black/15 px-4 text-sm font-bold hover:bg-black/[.04] disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/[.04]";

/** A passage the founder typed, rewritten canonically once every verse is found in the KJV. */
async function checkedPassage(text: string): Promise<string | null> {
	const parsed = readPassage(text);
	if (!parsed) return null;
	const passage = parsePassage(text, MAP_BOOKS, await kjvVerseCounter([parsed]));
	return passage ? formatPassage(passage, MAP_BOOKS) : null;
}

/** A list of passages with a field to add one; at least one always stays. */
function PassageList({ refs, max, onChange, name }: { refs: string[]; max: number; onChange: (refs: string[]) => void; name: string }) {
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const add = async (event: FormEvent) => {
		event.preventDefault();
		const text = draft.trim();
		if (!text) return;
		setBusy(true);
		const canonical = await checkedPassage(text);
		setBusy(false);
		if (!canonical) {
			setError(`"${text}" is not a passage in the KJV. Try a form like Romans 5:1 or John 3:16-18.`);
			return;
		}
		if (!refs.includes(canonical)) onChange([...refs, canonical]);
		setDraft("");
		setError(null);
	};
	return (
		<div>
			<ul className="flex flex-wrap gap-2">
				{refs.map((ref) => (
					<li key={ref} className="flex items-center rounded-full border border-amber-700/30 bg-[#fbf3df] pl-3 text-sm font-bold text-amber-900 dark:border-amber-300/30 dark:bg-[#1d1a10] dark:text-amber-200">
						{ref}
						<button type="button" disabled={refs.length <= 1} onClick={() => onChange(refs.filter((item) => item !== ref))} aria-label={`Remove ${ref}`} className="flex h-11 w-10 items-center justify-center rounded-full disabled:opacity-30">
							<X size={15} aria-hidden />
						</button>
					</li>
				))}
			</ul>
			{refs.length < max && (
				<form onSubmit={add} className="mt-2 flex gap-2">
					<label className="sr-only" htmlFor={`${name}-add`}>Add a passage</label>
					<input id={`${name}-add`} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a passage, e.g. Acts 2:38" autoComplete="off" className={`${field} min-h-11 py-2`} />
					<button type="submit" disabled={!draft.trim() || busy} className={`${smallButton} shrink-0`}>
						<Plus size={16} aria-hidden /> Add
					</button>
				</form>
			)}
			{error && <p role="alert" className="mt-1.5 text-sm text-red-700 dark:text-red-300">{error}</p>}
		</div>
	);
}

interface Props {
	map: ConceptMap;
	nodeId: string;
	onChange: (map: ConceptMap) => void;
	onClose: () => void;
	/** Opens the editor on another node (a child just added, say). */
	onEdit: (nodeId: string) => void;
}

/**
 * Editing one node of a draft or saved map (LC-17654): its label, note and
 * passages, how it connects to its parent, where it sits, its links across
 * the map, and whether it is a question Christians read differently. Every
 * passage is checked against the bundled KJV as it is added; the whole map is
 * checked again when it is saved.
 */
export default function NodeEditor({ map, nodeId, onChange, onClose, onEdit }: Props) {
	const ref = useModalFocus<HTMLDivElement>({ open: true, onClose });
	const [linkTarget, setLinkTarget] = useState("");
	const [linkLabel, setLinkLabel] = useState("");
	const [confirmDelete, setConfirmDelete] = useState(false);
	const node = map.nodes.find((item) => item.id === nodeId);
	if (!node) return null;
	const isRoot = node.parentId === null;
	const parent = node.parentId ? map.nodes.find((item) => item.id === node.parentId) : undefined;
	const children = childrenOf(map, node.id);
	const below = subtreeIds(map, node.id);
	const links = map.links.filter((link) => link.from === node.id || link.to === node.id);

	const patch = (change: Partial<MapNode>) => onChange({ ...map, nodes: map.nodes.map((item) => (item.id === node.id ? { ...item, ...change } : item)) });

	const addChild = () => {
		const id = nextNodeId(map);
		const kind = node.kind === "question" ? "reading" : "topic";
		const child: MapNode = { id, parentId: node.id, label: kind === "reading" ? "A reading" : "A new idea", note: "", kind, refs: [node.refs[0]], via: { label: "", refs: [node.refs[0]] } };
		// Keep pre-order: the new child goes after the node's last descendant.
		const lastIndex = Math.max(...map.nodes.map((item, index) => (below.has(item.id) ? index : -1)));
		const nodes = [...map.nodes];
		nodes.splice(lastIndex + 1, 0, child);
		onChange({ ...map, nodes });
		onEdit(id);
	};

	const remove = () => {
		onChange({
			...map,
			nodes: map.nodes.filter((item) => !below.has(item.id)),
			links: map.links.filter((link) => !below.has(link.from) && !below.has(link.to)),
		});
		onClose();
	};

	const moveUnder = (parentId: string) => {
		if (!parentId || parentId === node.parentId) return;
		const target = map.nodes.find((item) => item.id === parentId);
		if (!target) return;
		const kind: MapNode["kind"] = target.kind === "question" ? "reading" : node.kind === "reading" ? "topic" : node.kind;
		const moving = map.nodes.filter((item) => below.has(item.id)).map((item): MapNode => (item.id === node.id ? { ...item, parentId, kind } : item));
		const rest = map.nodes.filter((item) => !below.has(item.id));
		const targetBelow = subtreeIds({ nodes: rest }, parentId);
		const insertAt = Math.max(...rest.map((item, index) => (targetBelow.has(item.id) ? index : -1))) + 1;
		rest.splice(insertAt, 0, ...moving);
		onChange({ ...map, nodes: rest, links: map.links.filter((link) => !(link.from === parentId && link.to === node.id) && !(link.to === parentId && link.from === node.id)) });
	};

	// A node can become a question only while everything under it can be a reading.
	const canBeQuestion = !isRoot && node.kind !== "reading" && children.every((child) => childrenOf(map, child.id).length === 0) && children.length <= READINGS_MAX;
	const setQuestion = (on: boolean) => {
		onChange({
			...map,
			nodes: map.nodes.map((item) => {
				if (item.id === node.id) return { ...item, kind: on ? "question" : "topic" };
				if (item.parentId === node.id) return { ...item, kind: on ? "reading" : "topic" };
				return item;
			}),
		});
	};

	// Anywhere outside its own branch except under an interpretation; under a question only
	// as a reading, so only a node with nothing under it, and only while the question has room.
	const parentOptions = map.nodes.filter(
		(item) =>
			!below.has(item.id) &&
			item.kind !== "reading" &&
			(item.kind !== "question" || (children.length === 0 && (item.id === node.parentId || childrenOf(map, item.id).length < READINGS_MAX))),
	);
	const linkOptions = map.nodes.filter((item) => item.id !== node.id && item.id !== node.parentId && item.parentId !== node.id && !links.some((link) => link.from === item.id || link.to === item.id));

	const addLink = (event: FormEvent) => {
		event.preventDefault();
		const text = linkLabel.trim();
		if (!linkTarget || !text) return;
		const other = map.nodes.find((item) => item.id === linkTarget);
		onChange({ ...map, links: [...map.links, { id: nextNodeId(map, "link-"), from: node.id, to: linkTarget, label: text.slice(0, CONNECTION_LABEL_MAX), refs: [other?.refs[0] ?? node.refs[0]] }] });
		setLinkTarget("");
		setLinkLabel("");
	};

	return (
		<div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 lg:items-stretch lg:justify-end lg:bg-black/20" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<div ref={ref} role="dialog" aria-modal="true" aria-labelledby="map-editor-title" tabIndex={-1} className="flex max-h-[86dvh] w-full max-w-2xl flex-col rounded-t-[28px] border border-black/10 bg-[#f6f2e9] text-[#24281f] outline-none dark:border-white/10 dark:bg-[#111710] dark:text-[#f1eadc] lg:max-h-none lg:w-[480px] lg:rounded-none lg:rounded-l-[28px]">
				<header className="flex items-center gap-3 border-b border-black/10 px-5 py-3 dark:border-white/10">
					<h2 id="map-editor-title" className="min-w-0 flex-1 truncate font-[family-name:var(--font-cormorant)] text-[26px] font-semibold">Edit {isRoot ? "the centre" : node.kind === "reading" ? "an interpretation" : "a node"}</h2>
					<button type="button" onClick={onClose} className="min-h-11 rounded-full bg-[#24281f] px-5 text-sm font-bold text-white dark:bg-[#e5b664] dark:text-[#1c2118]">Done</button>
				</header>
				<div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 pb-8 pt-4">
					<div>
						<label htmlFor="map-node-label" className={label}>Label</label>
						<input id="map-node-label" value={node.label} maxLength={NODE_LABEL_MAX} onChange={(event) => patch({ label: event.target.value })} className={`${field} mt-2 font-[family-name:var(--font-cormorant)] text-[20px] font-semibold`} />
						{!node.label.trim() && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-300">A node needs a label.</p>}
					</div>
					<div>
						<label htmlFor="map-node-note" className={label}>Note</label>
						<textarea id="map-node-note" value={node.note} maxLength={NODE_NOTE_MAX} rows={3} onChange={(event) => patch({ note: event.target.value })} placeholder="What these verses say about it, in your words" className={`${field} mt-2 resize-y leading-6`} />
					</div>
					<div>
						<p className={label}>Passages</p>
						<div className="mt-2"><PassageList name="node" refs={node.refs} max={NODE_REFS_MAX} onChange={(refs) => patch({ refs })} /></div>
					</div>

					{parent && node.via && (
						<fieldset className="rounded-[20px] border border-black/[.09] p-4 dark:border-white/[.09]">
							<legend className={`${label} px-1`}>How it connects to “{parent.label}”</legend>
							<label htmlFor="map-node-via" className="sr-only">Connection label</label>
							<input id="map-node-via" value={node.via.label} maxLength={CONNECTION_LABEL_MAX} onChange={(event) => patch({ via: { ...node.via!, label: event.target.value } })} placeholder="e.g. fulfilled in, the sign, leads to" className={field} />
							<div className="mt-3"><PassageList name="via" refs={node.via.refs} max={CONNECTION_REFS_MAX} onChange={(refs) => patch({ via: { ...node.via!, refs } })} /></div>
						</fieldset>
					)}

					{node.kind !== "reading" && !isRoot && (
						<label className="flex min-h-11 items-start gap-3 rounded-[20px] border border-amber-700/30 p-4 dark:border-amber-300/30">
							<input type="checkbox" checked={node.kind === "question"} disabled={!canBeQuestion && node.kind !== "question"} onChange={(event) => setQuestion(event.target.checked)} className="mt-1 h-5 w-5 accent-[#b8862f]" />
							<span className="text-sm leading-6">
								<span className="font-bold">Christians read this differently.</span> The nodes under it become interpretations, shown side by side and labelled so none reads as settled. A question needs two to four.
								{!canBeQuestion && node.kind !== "question" && <span className="block text-neutral-500"> Only possible while nothing sits under its children.</span>}
							</span>
						</label>
					)}

					<div className="flex flex-wrap gap-2">
						{(node.kind !== "question" || children.length < READINGS_MAX) && node.kind !== "reading" && (
							<button type="button" onClick={addChild} className={smallButton}><Plus size={16} aria-hidden /> {node.kind === "question" ? "Add an interpretation" : "Add a node under it"}</button>
						)}
						{!isRoot && (
							confirmDelete ? (
								<button type="button" onClick={remove} className={`${smallButton} border-red-700/40 text-red-800 dark:text-red-300`}><Trash2 size={16} aria-hidden /> Delete {below.size > 1 ? `it and ${below.size - 1} under it` : "it"}</button>
							) : (
								<button type="button" onClick={() => setConfirmDelete(true)} className={smallButton}><Trash2 size={16} aria-hidden /> Delete</button>
							)
						)}
					</div>

					{!isRoot && (
						<div>
							<label htmlFor="map-node-move" className={label}>Sits under</label>
							<select id="map-node-move" value={node.parentId ?? ""} onChange={(event) => moveUnder(event.target.value)} className={`${field} mt-2 min-h-11`}>
								{parentOptions.map((item) => (
									<option key={item.id} value={item.id}>{item.label}{item.kind === "question" ? " (as an interpretation)" : ""}</option>
								))}
							</select>
						</div>
					)}

					<div>
						<p className={label}>Links across the map</p>
						{links.length > 0 && (
							<ul className="mt-2 space-y-3">
								{links.map((link) => {
									const other = map.nodes.find((item) => item.id === (link.from === node.id ? link.to : link.from));
									const setLink = (change: Partial<typeof link>) => onChange({ ...map, links: map.links.map((item) => (item.id === link.id ? { ...item, ...change } : item)) });
									return (
										<li key={link.id} className="rounded-[20px] border border-dashed border-amber-700/40 p-3 dark:border-amber-300/35">
											<div className="flex items-center gap-2">
												<Link2 size={16} aria-hidden className="shrink-0 text-amber-800 dark:text-amber-200" />
												<span className="min-w-0 flex-1 truncate text-sm font-bold">{other?.label}</span>
												<button type="button" onClick={() => onChange({ ...map, links: map.links.filter((item) => item.id !== link.id) })} aria-label={`Remove the link to ${other?.label}`} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/5"><Trash2 size={16} aria-hidden /></button>
											</div>
											<label className="sr-only" htmlFor={`link-label-${link.id}`}>Link label</label>
											<input id={`link-label-${link.id}`} value={link.label} maxLength={CONNECTION_LABEL_MAX} onChange={(event) => setLink({ label: event.target.value })} className={`${field} mt-2 min-h-11 py-2`} />
											<div className="mt-2"><PassageList name={`link-${link.id}`} refs={link.refs} max={CONNECTION_REFS_MAX} onChange={(refs) => setLink({ refs })} /></div>
										</li>
									);
								})}
							</ul>
						)}
						{linkOptions.length > 0 && (
							<form onSubmit={addLink} className="mt-2 grid grid-cols-1 gap-2">
								<label className="sr-only" htmlFor="map-link-target">Link to</label>
								<select id="map-link-target" value={linkTarget} onChange={(event) => setLinkTarget(event.target.value)} className={`${field} min-h-11`}>
									<option value="">Link to another node…</option>
									{linkOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
								</select>
								<div className="flex gap-2">
									<label className="sr-only" htmlFor="map-link-label">Link label</label>
									<input id="map-link-label" value={linkLabel} maxLength={CONNECTION_LABEL_MAX} onChange={(event) => setLinkLabel(event.target.value)} placeholder="How they connect" className={`${field} min-h-11 py-2`} />
									<button type="submit" disabled={!linkTarget || !linkLabel.trim()} className={`${smallButton} shrink-0`}><Link2 size={16} aria-hidden /> Link</button>
								</div>
								<p className="text-xs text-neutral-500 dark:text-neutral-400">A new link starts with the other node&rsquo;s first passage; change it above.</p>
							</form>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
