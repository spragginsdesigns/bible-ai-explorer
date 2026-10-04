"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight, PenLine, Plus, X } from "lucide-react";
import type { Note, NoteProperties as NotePropertiesMap, NotePropertyValue } from "@/types/notes";
import {
	PROPERTY_TYPES,
	PROPERTY_TYPE_LABELS,
	normalizeAliases,
	normalizePropertyKey,
	parsePropertyValue,
	propertyEntries,
	propertyKeyTaken,
	propertyTypeOf,
	propertyValueToInput,
	removeNoteProperty,
	setNoteProperty,
	type NotePropertyType,
} from "./notePropertyRules";

/** Add/edit form state; `originalKey` is null while adding rather than editing. */
interface PropertyDraft {
	originalKey: string | null;
	key: string;
	type: NotePropertyType;
	value: string;
}

const VALUE_PLACEHOLDER: Record<NotePropertyType, string> = {
	text: "Value",
	number: "0",
	checkbox: "",
	list: "Comma separated",
};

const formatDate = (iso: string) =>
	new Date(iso).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});

interface ChipInputProps {
	values: string[];
	placeholder: string;
	onChange: (next: string[]) => void;
	/** Optional normalizer applied to the list after an add (aliases dedupe by case). */
	normalize?: (values: string[]) => string[];
}

const ChipInput: React.FC<ChipInputProps> = ({ values, placeholder, onChange, normalize }) => {
	const [draft, setDraft] = useState("");

	const commit = () => {
		const value = draft.trim();
		setDraft("");
		if (!value) return;
		const next = normalize ? normalize([...values, value]) : values.includes(value) ? values : [...values, value];
		if (next.length !== values.length) onChange(next);
	};

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{values.map((value) => (
				<span
					key={value}
					className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-metadata bg-white/[0.05] border border-white/[0.08] text-neutral-300"
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
	/** Name of the note's folder, or null when it is unfiled. */
	folderName: string | null;
	onUpdate: (changes: Partial<Note>) => void;
}

const NotePropertiesSection: React.FC<NotePropertiesSectionProps> = ({
	note,
	folderName,
	onUpdate,
}) => {
	const [expanded, setExpanded] = useState(true);
	const [draft, setDraft] = useState<PropertyDraft | null>(null);
	// Scalar inputs stay local until blur so a PATCH does not fire per keystroke.
	const [scalarDrafts, setScalarDrafts] = useState<Record<string, string>>({});

	const properties: NotePropertiesMap = note.properties ?? {};
	const entries = propertyEntries(note.properties);

	const writeProperties = (next: NotePropertiesMap) => {
		onUpdate({ properties: next });
	};

	const setProperty = (key: string, value: NotePropertyValue) => {
		writeProperties(setNoteProperty(properties, key, value));
	};

	const dropScalarDraft = (key: string) =>
		setScalarDrafts((prev) => {
			const copy = { ...prev };
			delete copy[key];
			return copy;
		});

	const removeProperty = (key: string) => {
		dropScalarDraft(key);
		writeProperties(removeNoteProperty(properties, key));
	};

	const commitScalar = (key: string, type: NotePropertyType) => {
		const raw = scalarDrafts[key];
		dropScalarDraft(key);
		if (raw === undefined) return;
		if (type === "number") {
			const parsed = Number(raw);
			setProperty(key, Number.isFinite(parsed) ? parsed : 0);
			return;
		}
		setProperty(key, raw);
	};

	// Android's rules (noteProperties.ts): whitespace-normalized key, unique
	// ignoring case, and a value that parses for the chosen type.
	const draftKey = draft ? normalizePropertyKey(draft.key) : "";
	const draftValue = draft ? parsePropertyValue(draft.type, draft.value) : null;
	const draftKeyTaken =
		draft !== null && propertyKeyTaken(note.properties, draftKey, draft.originalKey ?? undefined);
	const draftValid = draft !== null && draftKey.length > 0 && draftValue !== null && !draftKeyTaken;

	const saveDraft = () => {
		if (!draft || !draftValid || draftValue === null) return;
		if (draft.originalKey) dropScalarDraft(draft.originalKey);
		writeProperties(
			setNoteProperty(note.properties, draftKey, draftValue, draft.originalKey ?? undefined)
		);
		setDraft(null);
	};

	const renderValue = (key: string, value: NotePropertyValue) => {
		const type = propertyTypeOf(value);

		if (type === "checkbox") {
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

		if (type === "list") {
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
				type={type === "number" ? "number" : "text"}
				value={scalarDrafts[key] ?? String(value)}
				onChange={(e) =>
					setScalarDrafts((prev) => ({ ...prev, [key]: e.target.value }))
				}
				onBlur={() => commitScalar(key, type)}
				onKeyDown={(e) => {
					if (e.key === "Enter") e.currentTarget.blur();
					if (e.key === "Escape") {
						dropScalarDraft(key);
						e.currentTarget.blur();
					}
				}}
				placeholder="Empty"
				className="w-full bg-transparent text-neutral-200 text-xs outline-none placeholder:text-neutral-600 py-0.5 border-b border-transparent focus:border-amber-400/40 transition-colors"
			/>
		);
	};

	const chipClass = (active: boolean) =>
		`px-2.5 py-1 rounded-full text-metadata border transition-colors ${
			active
				? "border-amber-400/40 bg-amber-400/10 text-amber-500 dark:text-amber-400"
				: "border-white/[0.08] text-neutral-500 hover:text-neutral-300"
		}`;

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
				<span className="text-metadata text-neutral-600">{entries.length}</span>
			</button>

			{expanded && (
				<div className="px-4 pb-3 space-y-3">
					{/* Read-only facts */}
					<dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 text-metadata">
						<dt className="text-neutral-600">Created</dt>
						<dd className="text-neutral-400">{formatDate(note.createdAt)}</dd>
						<dt className="text-neutral-600">Updated</dt>
						<dd className="text-neutral-400">{formatDate(note.updatedAt)}</dd>
						<dt className="text-neutral-600">Words</dt>
						<dd className="text-neutral-400">{note.wordCount}</dd>
						<dt className="text-neutral-600">Folder</dt>
						<dd className="text-neutral-400 truncate">{folderName ?? "None"}</dd>
					</dl>

					<div className="grid grid-cols-[88px_1fr] gap-x-3 items-start">
						<span className="text-metadata text-neutral-600 pt-1">Aliases</span>
						<ChipInput
							values={note.aliases}
							placeholder="Add alias"
							normalize={normalizeAliases}
							onChange={(next) => onUpdate({ aliases: next })}
						/>
					</div>

					{entries.map(([key, value]) => (
						<div
							key={key}
							className="grid grid-cols-[88px_1fr_auto_auto] gap-x-2 items-start group"
						>
							<span
								className="text-metadata text-neutral-600 pt-1 truncate"
								title={key}
							>
								{key}
							</span>
							<div className="min-w-0 pt-0.5">{renderValue(key, value)}</div>
							<button
								onClick={() =>
									setDraft({
										originalKey: key,
										key,
										type: propertyTypeOf(value),
										value: propertyValueToInput(value),
									})
								}
								title={`Edit property ${key}`}
								aria-label={`Edit property ${key}`}
								className="opacity-60 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 text-neutral-600 hover:text-amber-400 transition-opacity pt-1"
							>
								<PenLine className="w-3 h-3" />
							</button>
							<button
								onClick={() => removeProperty(key)}
								title={`Delete property ${key}`}
								aria-label={`Delete property ${key}`}
								className="opacity-60 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 text-neutral-600 hover:text-red-400 transition-opacity pt-1"
							>
								<X className="w-3 h-3" />
							</button>
						</div>
					))}

					{draft ? (
						<div className="space-y-2 rounded-xl border border-white/[0.08] p-2.5">
							<input
								autoFocus
								value={draft.key}
								onChange={(e) => setDraft({ ...draft, key: e.target.value })}
								onKeyDown={(e) => {
									if (e.key === "Enter") saveDraft();
									if (e.key === "Escape") setDraft(null);
								}}
								placeholder="Property name"
								className="w-full bg-transparent text-neutral-200 text-xs outline-none placeholder:text-neutral-600 border-b border-white/[0.1] pb-1"
							/>
							{draftKeyTaken && (
								<p className="text-metadata text-red-400/80">
									A property with that name already exists.
								</p>
							)}
							<div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Property type">
								{PROPERTY_TYPES.map((type) => (
									<button
										key={type}
										type="button"
										role="radio"
										aria-checked={draft.type === type}
										onClick={() =>
											setDraft({
												...draft,
												type,
												// Checkbox has no free text, so seed it with a real value.
												value: type === "checkbox" ? "true" : draft.value,
											})
										}
										className={chipClass(draft.type === type)}
									>
										{PROPERTY_TYPE_LABELS[type]}
									</button>
								))}
							</div>
							{draft.type === "checkbox" ? (
								<div className="flex gap-1.5">
									<button
										type="button"
										onClick={() => setDraft({ ...draft, value: "true" })}
										className={chipClass(draft.value === "true")}
									>
										Yes
									</button>
									<button
										type="button"
										onClick={() => setDraft({ ...draft, value: "false" })}
										className={chipClass(draft.value === "false")}
									>
										No
									</button>
								</div>
							) : (
								<input
									type={draft.type === "number" ? "number" : "text"}
									value={draft.value}
									onChange={(e) => setDraft({ ...draft, value: e.target.value })}
									onKeyDown={(e) => {
										if (e.key === "Enter") saveDraft();
										if (e.key === "Escape") setDraft(null);
									}}
									placeholder={VALUE_PLACEHOLDER[draft.type]}
									className="w-full bg-transparent text-neutral-200 text-xs outline-none placeholder:text-neutral-600 border-b border-white/[0.1] pb-1"
								/>
							)}
							<div className="flex items-center gap-3">
								<button
									onClick={saveDraft}
									disabled={!draftValid}
									className="text-xs text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-40"
								>
									Save
								</button>
								<button
									onClick={() => setDraft(null)}
									className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
								>
									Cancel
								</button>
							</div>
						</div>
					) : (
						<button
							onClick={() => setDraft({ originalKey: null, key: "", type: "text", value: "" })}
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
