"use client";

import React, { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";

interface NotesSearchProps {
	value: string;
	onChange: (query: string) => void;
}

const NotesSearch: React.FC<NotesSearchProps> = ({ value, onChange }) => {
	const [localValue, setLocalValue] = useState(value);
	const debounceRef = useRef<ReturnType<typeof setTimeout>>();

	useEffect(() => {
		setLocalValue(value);
	}, [value]);

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const val = e.target.value;
		setLocalValue(val);
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => onChange(val), 300);
	};

	const handleClear = () => {
		setLocalValue("");
		onChange("");
	};

	return (
		<div className="px-3 lg:px-8 pb-2 pt-3">
			<div className="relative mx-auto w-full max-w-5xl">
				<div className="flex items-center gap-2.5 px-4 py-2.5 rounded-full border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02] focus-within:border-amber-500/40 dark:focus-within:border-amber-400/30 transition-colors">
					<Search className="w-4 h-4 text-neutral-400 dark:text-neutral-600 flex-shrink-0" />
					<input
						value={localValue}
						onChange={handleChange}
						placeholder="Search notes..."
						className="flex-1 bg-transparent text-neutral-800 dark:text-neutral-200 text-sm outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-600"
					/>
					{localValue && (
						<button
							onClick={handleClear}
							className="text-neutral-400 dark:text-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-400 transition-colors"
						>
							<X className="w-4 h-4" />
						</button>
					)}
				</div>
			</div>
		</div>
	);
};

export default NotesSearch;
