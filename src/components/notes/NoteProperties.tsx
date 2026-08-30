"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import {
	emptyPropertyValue,
	propertyKindOf,
	type Note,
	type NoteProperties as NotePropertiesMap,
	type NotePropertyKind,
	type NotePropertyValue,
} from "@/types/notes";

const KIND_OPTIONS: { value: NotePropertyKind; label: string }[] = [
	{ value: "text", label: "Text" },
	{ value: "number", label: "Number" },
	{ value: "checkbox", label: "Checkbox" },
	{ value: "list", label: "List" },
];

const formatDate = (iso: string) =>
	new Date(iso).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});

interface ChipInputProps {
	values: string[];
	placeholder: string;
	onChange: (next: string[]) => void;
}

const ChipInput: React.FC<ChipInputProps> = ({ values, placeholder, onChange }) => {
	const [draft, setDraft] = useState("");

	const commit = () => {
		const value = draft.trim();
		setDraft("");
		if (!value || values.includes(value)) return;
		onChange([...values, value]);
	};

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{values.map((value) => (
				<span
					key={value}
					className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px] bg-white/[0.05] border border-white/[0.08] text-neutral-300"
				>
					{value}
					<button
						onClick={() => onChange(values.filter((v) => v !== value))}
						title={`Remove ${value}`}
						className="text-neutral-600 hover:text-red-400 transition-colors"
					>
						<X className="w-3 h-3" />
					</button>
				</span>
			))}
			<input
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						commit();
					}
					if (e.key === "Escape") setDraft("");
				}}
				placeholder={placeholder}
				className="flex-1 min-w-[100px] bg-transparent text-neutral-200 text-xs outline-none placeholder:text-neutral-600 py-0.5"
			/>
		</div>
	);
};

interface NotePropertiesSectionProps {
	note: Note;
	onUpdate: (changes: Partial<Note>) => void;
}

const NotePropertiesSection: React.FC<NotePropertiesSectionProps> = ({
	note,
	onUpdate,
}) => {
	const [expanded, setExpanded] = useState(true);
	const [adding, setAdding] = useState(false);
	const [newKey, setNewKey] = useState("");
	const [newKind, setNewKind] = useState<NotePropertyKind>("text");
	// Scalar inputs stay local until blur so a PATCH does not fire per keystroke.
	const [drafts, setDrafts] = useState<Record<string, string>>({});

	const properties: NotePropertiesMap = note.properties ?? {};
	const entries = Object.entries(properties);

	const writeProperties = (next: NotePropertiesMap) => {
		onUpdate({ properties: next });
	};

	const setProperty = (key: string, value: NotePropertyValue) => {
		writeProperties({ ...properties, [key]: value });
	};

	const removeProperty = (key: string) => {
		const next = { ...properties };
		delete next[key];
		setDrafts((prev) => {
			const copy = { ...prev };
			delete copy[key];
			return copy;
		});
		writeProperties(next);
	};

	const commitScalar = (key: string, kind: NotePropertyKind) => {
		const draft = drafts[key];
		setDrafts((prev) => {
			const copy = { ...prev };
			delete copy[key];
			return copy;
		});
		if (draft === undefined) return;
		if (kind === "number") {
			const parsed = Number(draft);
			setProperty(key, Number.isFinite(parsed) ? parsed : 0);
			return;
		}
		setProperty(key, draft);
	};

	const addProperty = () => {
		const key = newKey.trim();
		if (!key || key in properties) return;
		writeProperties({ ...properties, [key]: emptyPropertyValue(newKind) });
		setNewKey("");
		setNewKind("text");
		setAdding(false);
	};

	const renderValue = (key: string, value: NotePropertyValue) => {
		const kind = propertyKindOf(value);

		if (kind === "checkbox") {
			return (
				<button
					onClick={() => setProperty(key, !value)}
					className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
						value
							? "bg-amber-400/80 border-amber-400"
							: "border-white/[0.15] hover:border-white/[0.3]"
					}`}
					title={value ? "Uncheck" : "Check"}
				>
					{value ? <span className="block w-1.5 h-1.5 rounded-sm bg-neutral-950" /> : null}
				</button>
			);
		}

		if (kind === "list") {
			return (
				<ChipInput
					values={value as string[]}
					placeholder="Add value"
					onChange={(next) => setProperty(key, next)}
				/>
			);
		}

		return (
			<input
				type={kind === "number" ? "number" : "text"}
				value={drafts[key] ?? String(value)}
				onChange={(e) =>
					setDrafts((prev) => ({ ...prev, [key]: e.target.value }))
				}
				onBlur={() => commitScalar(key, kind)}
				onKeyDown={(e) => {
					if (e.key === "Enter") e.currentTarget.blur();
					if (e.key === "Escape") {
						setDrafts((prev) => {
							const copy = { ...prev };
							delete copy[key];
							return copy;
						});
						e.currentTarget.blur();
					}
				}}
				placeholder="Empty"
				className="w-full bg-transparent text-neutral-200 text-xs outline-none placeholder:text-neutral-600 py-0.5 border-b border-transparent focus:border-amber-400/40 transition-colors"
			/>
		);
	};

	return (
		<section className="border-b border-white/[0.06]">
			<button
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-1.5 px-4 py-2 text-left text-neutral-500 hover:text-neutral-300 transition-colors"
			>
				{expanded ? (
					<ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
				) : (
					<ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
				)}
				<span className="text-xs font-medium">Properties</span>
				<span className="text-[10px] text-neutral-600">{entries.length}</span>
			</button>

			{expanded && (
				<div className="px-4 pb-3 space-y-3">
					{/* Read-only facts */}
					<dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 text-[11px]">
						<dt className="text-neutral-600">Created</dt>
						<dd className="text-neutral-400">{formatDate(note.createdAt)}</dd>
						<dt className="text-neutral-600">Updated</dt>
						<dd className="text-neutral-400">{formatDate(note.updatedAt)}</dd>
						<dt className="text-neutral-600">Words</dt>
						<dd className="text-neutral-400">{note.wordCount}</dd>
					</dl>

					<div className="grid grid-cols-[88px_1fr] gap-x-3 items-start">
						<span className="text-[11px] text-neutral-600 pt-1">Aliases</span>
						<ChipInput
							values={note.aliases}
							placeholder="Add alias"
							onChange={(next) => onUpdate({ aliases: next })}
						/>
					</div>

					{entries.map(([key, value]) => (
						<div
							key={key}
							className="grid grid-cols-[88px_1fr_auto] gap-x-3 items-start group"
						>
							<span
								className="text-[11px] text-neutral-600 pt-1 truncate"
								title={key}
							>
								{key}
							</span>
							<div className="min-w-0 pt-0.5">{renderValue(key, value)}</div>
							<button
								onClick={() => removeProperty(key)}
								title={`Delete ${key}`}
								className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-neutral-600 hover:text-red-400 transition-opacity pt-1"
							>
								<X className="w-3 h-3" />
							</button>
						</div>
					))}

					{adding ? (
						<div className="flex items-center gap-2">
							<input
								autoFocus
								value={newKey}
								onChange={(e) => setNewKey(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") addProperty();
									if (e.key === "Escape") setAdding(false);
								}}
								placeholder="Property name"
								className="flex-1 min-w-0 bg-transparent text-neutral-200 text-xs outline-none placeholder:text-neutral-600 border-b border-white/[0.1] pb-1"
							/>
							<select
								value={newKind}
								onChange={(e) => setNewKind(e.target.value as NotePropertyKind)}
								className="bg-neutral-900 text-neutral-300 text-xs rounded-lg border border-white/[0.08] px-1.5 py-1 outline-none"
							>
								{KIND_OPTIONS.map((opt) => (
									<option key={opt.value} value={opt.value}>
										{opt.label}
									</option>
								))}
							</select>
							<button
								onClick={addProperty}
								className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
							>
								Add
							</button>
							<button
								onClick={() => setAdding(false)}
								className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
							>
								Cancel
							</button>
						</div>
					) : (
						<button
							onClick={() => setAdding(true)}
							className="flex items-center gap-1.5 text-neutral-600 hover:text-neutral-400 transition-colors text-xs"
						>
							<Plus className="w-3 h-3" />
							Add property
						</button>
					)}
				</div>
			)}
		</section>
	);
};

export default NotePropertiesSection;
