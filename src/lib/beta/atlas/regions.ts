/**
 * Regions the atlas's Places view flies to (LC-17655), each framed by the
 * places that bound it. Shared by the page (URL parsing) and the panel.
 *
 * No imports on purpose: the tests load this file with Node's type stripping.
 */
export const ATLAS_REGIONS: readonly { id: string; label: string; places: readonly string[]; maxScale?: number }[] = [
	{ id: "world", label: "The Bible's world", places: ["rome", "ur", "shushan", "egypt", "ararat"] },
	{ id: "holy-land", label: "The Holy Land", places: ["dan", "beersheba", "joppa", "gilead", "caesarea-philippi", "gaza"] },
	{ id: "jerusalem", label: "Jerusalem", places: ["golgotha", "mount-of-olives", "bethany", "zion", "gethsemane"], maxScale: 0.75 },
	{ id: "galilee", label: "Galilee", places: ["capernaum", "nazareth", "cana", "nain", "bethsaida"], maxScale: 0.4 },
	{ id: "paul", label: "Paul's world", places: ["rome", "jerusalem", "philippi", "antioch", "melita"] },
	{ id: "sinai", label: "Egypt & Sinai", places: ["rameses", "mount-sinai", "kadeshbarnea", "eziongaber", "jericho"] },
	{ id: "east", label: "Mesopotamia", places: ["haran", "nineveh", "babylon", "ur", "shushan"] },
];
