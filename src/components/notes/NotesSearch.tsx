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
		<div className="relative px-3 pb-2">
			<div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/[0.06] bg-white/[0.02] focus-within:border-amber-400/30 transition-colors">
				<Search className="w-3.5 h-3.5 text-neutral-600 flex-shrink-0" />
				<input
					value={localValue}
					onChange={handleChange}
					placeholder="Search notes..."
					className="flex-1 bg-transparent text-neutral-200 text-xs outline-none placeholder:text-neutral-600"
				/>
				{localValue && (
					<button
						onClick={handleClear}
						className="text-neutral-600 hover:text-neutral-400 transition-colors"
					>
						<X className="w-3.5 h-3.5" />
					</button>
				)}
			</div>
		</div>
	);
};

export default NotesSearch;
