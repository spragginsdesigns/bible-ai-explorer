import React from "react";

const LoadingAnimation: React.FC = () => (
	<div className="flex flex-col items-center mt-2">
		<div className="text-sm mb-2">Referencing Scripture...</div>
		<div className="relative w-16 h-16">
			<div className="absolute inset-0 animate-page-turn">
				<svg viewBox="0 0 24 24" className="w-full h-full">
					<path
						fill="currentColor"
						d="M6 2h12a2 2 0 012 2v16a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zm0 2v16h12V4H6z"
					/>
					<path
						fill="currentColor"
						className="animate-page-content"
						d="M8 6h8v2H8V6zm0 4h8v2H8v-2zm0 4h8v2H8v-2z"
					/>
				</svg>
			</div>
		</div>
	</div>
);

export default LoadingAnimation;
