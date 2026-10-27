/**
 * Where the atlas's places are, for SureWord Beta's Atlas & Timeline
 * (LC-17655, docs/beta/atlas.md).
 *
 * This extends the shared corpus (`src/data/bible-atlas/places.json`) without
 * forking it: every corpus place keeps its id, name, description and refs
 * there, and this file only adds where it sits on the map. The journeys also
 * stop at places the corpus does not have yet (Perga, Miletus, Puteoli...);
 * those are `BETA_ATLAS_WAYPOINTS`, written in the corpus's own `AtlasPlace`
 * shape and held to its rules by `tests/beta-atlas.test.mjs` (every reference
 * resolves, and the name or an alias is in a cited verse of the bundled KJV),
 * so promoting one into places.json is a copy. They stay here while the beta
 * is web-only, because places.json is mirrored into the Android app.
 *
 * Coordinates are the modern identification of each site (WGS84). Scripture
 * rarely fixes a site the way a map does, so every entry says how sure the
 * identification is:
 *   known        the site is not in doubt (Jerusalem, Ephesus, Rome);
 *   traditional  the long-held identification, which the card says (Sinai at
 *                Jebel Musa, Golgotha at the Holy Sepulchre);
 *   uncertain    no one knows the spot; the marker shows the region Scripture
 *                describes, and the card says so (Marah, Elim, the crossing
 *                of the Red sea).
 *
 * No imports on purpose: the tests load this file with Node's type stripping.
 */

export type BetaAtlasCertainty = "known" | "traditional" | "uncertain";
export type BetaAtlasFeature = "city" | "region" | "mountain" | "water" | "island";

export interface BetaAtlasGeo {
	lat: number;
	lon: number;
	certainty: BetaAtlasCertainty;
	feature: BetaAtlasFeature;
	/** 1 is labelled at every zoom, 2 once the map is closer, 3 only close in. */
	rank: 1 | 2 | 3;
}

/** A place the corpus does not have yet, in the corpus's own AtlasPlace shape. */
export interface BetaAtlasWaypoint {
	id: string;
	name: string;
	alsoCalled?: string[];
	description: string;
	refs: string[];
	modernRegion?: string;
}

export const BETA_ATLAS_WAYPOINTS: readonly BetaAtlasWaypoint[] = [
	// Abraham
	{
		id: "gerar",
		name: "Gerar",
		description: "Where Abraham sojourned between Kadesh and Shur, and where Abimelech king of Gerar took Sarah until God warned him in a dream. Isaac also dwelt there in the famine.",
		refs: ["Genesis 20:1", "Genesis 20:2", "Genesis 26:6"],
	},
	// The Exodus
	{
		id: "rameses",
		name: "Rameses",
		alsoCalled: ["Raamses"],
		description: "The city in the land of Egypt that Israel built for Pharaoh as a treasure city, and from which the children of Israel journeyed out on the morrow after the passover.",
		refs: ["Exodus 1:11", "Exodus 12:37", "Numbers 33:3"],
	},
	{
		id: "succoth-of-egypt",
		name: "Succoth",
		description: "The first camp of the children of Israel after they went out of Rameses, about six hundred thousand on foot that were men, beside children.",
		refs: ["Exodus 12:37", "Exodus 13:20", "Numbers 33:5"],
	},
	{
		id: "etham",
		name: "Etham",
		description: "The camp in the edge of the wilderness, where the LORD went before them by day in a pillar of a cloud and by night in a pillar of fire.",
		refs: ["Exodus 13:20", "Numbers 33:6"],
	},
	{
		id: "pihahiroth",
		name: "Pi-hahiroth",
		alsoCalled: ["Pihahiroth"],
		description: "Where the LORD told Israel to turn and encamp before the sea, between Migdol and the sea, over against Baalzephon, and where Pharaoh's host overtook them.",
		refs: ["Exodus 14:2", "Exodus 14:9", "Numbers 33:7"],
	},
	{
		id: "wilderness-of-sin",
		name: "wilderness of Sin",
		description: "The wilderness between Elim and Sinai where the whole congregation murmured, and the LORD rained bread from heaven and sent quails at even.",
		refs: ["Exodus 16:1", "Numbers 33:11"],
	},
	{
		id: "eziongaber",
		name: "Eziongaber",
		alsoCalled: ["Eziongeber"],
		description: "A camp of Israel in the wilderness journeys, by Elath on the shore of the Red sea in the land of Edom, where Solomon afterward made a navy of ships.",
		refs: ["Numbers 33:35", "Deuteronomy 2:8", "1 Kings 9:26"],
	},
	{
		id: "mount-hor",
		name: "mount Hor",
		description: "The mount by the coast of the land of Edom where Aaron was stripped of his garments, gathered unto his people and died, and Eleazar his son was made priest.",
		refs: ["Numbers 20:22", "Numbers 20:28", "Numbers 33:38"],
	},
	// The Gospels
	{
		id: "bethabara",
		name: "Bethabara",
		description: "The place beyond Jordan where John was baptizing, and where he saw Jesus coming and said, Behold the Lamb of God, which taketh away the sin of the world.",
		refs: ["John 1:28", "John 1:29"],
	},
	{
		id: "nain",
		name: "Nain",
		description: "The city where the Lord met the funeral of a widow's only son, touched the bier, and said, Young man, I say unto thee, Arise.",
		refs: ["Luke 7:11", "Luke 7:14"],
	},
	{
		id: "gadarenes",
		name: "country of the Gadarenes",
		alsoCalled: ["Gadarenes", "Gergesenes"],
		description: "The country on the other side of the sea of Galilee where the Lord cast the legion of devils out of a man among the tombs, and the swine ran violently down a steep place into the sea.",
		refs: ["Mark 5:1", "Luke 8:26", "Matthew 8:28"],
	},
	// Paul's journeys
	{
		id: "seleucia",
		name: "Seleucia",
		description: "The port Barnabas and Saul went down to when they were sent forth by the Holy Ghost, and from which they sailed to Cyprus.",
		refs: ["Acts 13:4"],
	},
	{
		id: "salamis",
		name: "Salamis",
		description: "The city of Cyprus where Barnabas and Saul first preached the word of God in the synagogues of the Jews, with John to their minister.",
		refs: ["Acts 13:5"],
		modernRegion: "Cyprus",
	},
	{
		id: "paphos",
		name: "Paphos",
		description: "The city at the far side of Cyprus where the deputy Sergius Paulus believed, after Elymas the sorcerer was struck blind at Paul's word.",
		refs: ["Acts 13:6", "Acts 13:13"],
		modernRegion: "Cyprus",
	},
	{
		id: "perga",
		name: "Perga",
		description: "The city in Pamphylia where John departed from Paul and Barnabas and returned to Jerusalem, and where they preached the word on their way home.",
		refs: ["Acts 13:13", "Acts 14:25"],
	},
	{
		id: "antioch-in-pisidia",
		name: "Antioch in Pisidia",
		description: "Where Paul stood up in the synagogue on the sabbath and preached Christ from Moses and the prophets, and then turned to the Gentiles when the Jews contradicted.",
		refs: ["Acts 13:14", "Acts 14:21", "2 Timothy 3:11"],
	},
	{
		id: "derbe",
		name: "Derbe",
		description: "A city of Lycaonia where Paul and Barnabas fled from Iconium and preached the gospel, and where Paul departed with Barnabas the day after he was stoned at Lystra. He came to it again with Silas on his second journey.",
		refs: ["Acts 14:6", "Acts 14:20", "Acts 16:1"],
	},
	{
		id: "attalia",
		name: "Attalia",
		description: "The port of Pamphylia that Paul and Barnabas went down to after preaching in Perga, and from which they sailed back to Antioch.",
		refs: ["Acts 14:25"],
	},
	{
		id: "phrygia",
		name: "Phrygia",
		description: "The region Paul and his company went throughout, with Galatia, when they were forbidden of the Holy Ghost to preach the word in Asia, and which he strengthened again on his third journey.",
		refs: ["Acts 16:6", "Acts 18:23"],
	},
	{
		id: "mysia",
		name: "Mysia",
		description: "The region Paul's company came to and passed by, when they assayed to go into Bithynia and the Spirit suffered them not, coming down to Troas.",
		refs: ["Acts 16:7", "Acts 16:8"],
	},
	{
		id: "samothracia",
		name: "Samothracia",
		description: "The island Paul's company came to with a straight course from Troas, on the way to Neapolis and Macedonia.",
		refs: ["Acts 16:11"],
	},
	{
		id: "neapolis",
		name: "Neapolis",
		description: "The port where Paul first landed in Macedonia, going on from there to Philippi.",
		refs: ["Acts 16:11"],
	},
	{
		id: "amphipolis",
		name: "Amphipolis",
		description: "A city Paul and Silas passed through on the road from Philippi to Thessalonica.",
		refs: ["Acts 17:1"],
	},
	{
		id: "apollonia",
		name: "Apollonia",
		description: "A city Paul and Silas passed through after Amphipolis, coming to Thessalonica.",
		refs: ["Acts 17:1"],
	},
	{
		id: "macedonia",
		name: "Macedonia",
		description: "The land of the man in Paul's vision who prayed him, Come over into Macedonia, and help us. Philippi, Thessalonica and Berea were its cities, and Paul passed through it again on his third journey.",
		refs: ["Acts 16:9", "Acts 16:10", "Acts 20:1"],
	},
	{
		id: "cenchrea",
		name: "Cenchrea",
		description: "The port of Corinth where Paul shaved his head, for he had a vow, before sailing into Syria; Phebe was a servant of its church.",
		refs: ["Acts 18:18", "Romans 16:1"],
	},
	{
		id: "greece",
		name: "Greece",
		description: "Where Paul came after going over Macedonia and abode three months on his third journey, until the Jews laid wait for him as he was about to sail into Syria.",
		refs: ["Acts 20:2", "Acts 20:3"],
	},
	{
		id: "assos",
		name: "Assos",
		description: "Where Paul, who had chosen to go afoot from Troas, met the others and was taken on board the ship.",
		refs: ["Acts 20:13", "Acts 20:14"],
	},
	{
		id: "mitylene",
		name: "Mitylene",
		description: "Where the ship came with Paul aboard after taking him in at Assos.",
		refs: ["Acts 20:14"],
	},
	{
		id: "chios",
		name: "Chios",
		description: "The island Paul's ship came over against the day after leaving Mitylene.",
		refs: ["Acts 20:15"],
	},
	{
		id: "samos",
		name: "Samos",
		description: "The island where the ship arrived on the next day, on the way to Miletus.",
		refs: ["Acts 20:15"],
	},
	{
		id: "trogyllium",
		name: "Trogyllium",
		description: "Where the ship tarried for a night before coming to Miletus.",
		refs: ["Acts 20:15"],
	},
	{
		id: "miletus",
		name: "Miletus",
		description: "Where Paul sent to Ephesus for the elders of the church and told them they would see his face no more; they kneeled down and prayed, and accompanied him unto the ship.",
		refs: ["Acts 20:15", "Acts 20:17", "2 Timothy 4:20"],
	},
	{
		id: "coos",
		name: "Coos",
		description: "The island Paul's ship came to with a straight course after leaving Miletus.",
		refs: ["Acts 21:1"],
	},
	{
		id: "rhodes",
		name: "Rhodes",
		description: "The island the ship came to the day after Coos.",
		refs: ["Acts 21:1"],
	},
	{
		id: "patara",
		name: "Patara",
		description: "Where Paul's company found a ship sailing over unto Phenicia, went aboard and set forth.",
		refs: ["Acts 21:1", "Acts 21:2"],
	},
	{
		id: "ptolemais",
		name: "Ptolemais",
		description: "Where Paul's company finished their course from Tyre, saluted the brethren, and abode with them one day.",
		refs: ["Acts 21:7"],
	},
	{
		id: "myra",
		name: "Myra",
		description: "A city of Lycia where the centurion found a ship of Alexandria sailing into Italy and put Paul and the other prisoners therein.",
		refs: ["Acts 27:5", "Acts 27:6"],
	},
	{
		id: "cnidus",
		name: "Cnidus",
		description: "Where the ship came scarce after sailing slowly many days, the wind not suffering them.",
		refs: ["Acts 27:7"],
	},
	{
		id: "salmone",
		name: "Salmone",
		description: "The point the ship sailed past, under Crete, after Cnidus.",
		refs: ["Acts 27:7"],
	},
	{
		id: "fair-havens",
		name: "The fair havens",
		alsoCalled: ["fair havens", "Lasea"],
		description: "The harbour of Crete, nigh unto the city of Lasea, where Paul warned that the voyage would be with hurt and much damage, but the centurion believed the master of the ship more than Paul.",
		refs: ["Acts 27:8", "Acts 27:9", "Acts 27:10"],
	},
	{
		id: "clauda",
		name: "Clauda",
		description: "The island the ship ran under when the tempestuous wind Euroclydon caught it, where they had much work to come by the boat and undergirded the ship.",
		refs: ["Acts 27:16"],
	},
	{
		id: "syracuse",
		name: "Syracuse",
		description: "Where Paul's company landed in a ship of Alexandria after three months on Melita, and tarried three days.",
		refs: ["Acts 28:12"],
	},
	{
		id: "rhegium",
		name: "Rhegium",
		description: "Where the ship fetched a compass and came, waiting a day for the south wind.",
		refs: ["Acts 28:13"],
	},
	{
		id: "puteoli",
		name: "Puteoli",
		description: "Where Paul's company found brethren and were desired to tarry with them seven days, and so went toward Rome.",
		refs: ["Acts 28:13", "Acts 28:14"],
	},
	{
		id: "appii-forum",
		name: "Appii forum",
		description: "Where brethren from Rome came to meet Paul; when he saw them, he thanked God and took courage.",
		refs: ["Acts 28:15"],
	},
	{
		id: "three-taverns",
		name: "The three taverns",
		alsoCalled: ["three taverns"],
		description: "The other place the brethren of Rome came out as far as to meet Paul on his way into the city.",
		refs: ["Acts 28:15"],
	},
];

/**
 * Corpus places drawn at another place's marker, because Scripture uses both
 * names for one spot. Selecting one flies to the shared marker and shows its
 * own card.
 */
export const BETA_ATLAS_SAME_SITE: Readonly<Record<string, { at: string; note: string }>> = {
	horeb: { at: "mount-sinai", note: "Scripture calls the mountain of God both Horeb and Sinai, so it shares Sinai's marker." },
	babel: { at: "babylon", note: "Scripture places Babel in the land of Shinar; it is traditionally taken to be the site of Babylon." },
};

/** Corpus places with no marker at all, and why. */
export const BETA_ATLAS_UNMAPPED: Readonly<Record<string, string>> = {
	eden: "Scripture names the rivers that went out of Eden, but it does not fix where the garden was, so the atlas does not guess.",
};

export const BETA_ATLAS_GEO: Readonly<Record<string, BetaAtlasGeo>> = {
	// Creation and the patriarchs
	ararat: { lat: 39.702, lon: 44.298, certainty: "traditional", feature: "mountain", rank: 2 },
	ur: { lat: 30.9626, lon: 46.1031, certainty: "traditional", feature: "city", rank: 1 },
	haran: { lat: 36.865, lon: 39.03, certainty: "known", feature: "city", rank: 1 },
	canaan: { lat: 31.95, lon: 34.98, certainty: "known", feature: "region", rank: 1 },
	shechem: { lat: 32.2133, lon: 35.2817, certainty: "known", feature: "city", rank: 2 },
	bethel: { lat: 31.9286, lon: 35.2386, certainty: "traditional", feature: "city", rank: 2 },
	hebron: { lat: 31.5326, lon: 35.0998, certainty: "known", feature: "city", rank: 1 },
	sodom: { lat: 31.1, lon: 35.42, certainty: "uncertain", feature: "city", rank: 2 },
	gomorrah: { lat: 31.02, lon: 35.47, certainty: "uncertain", feature: "city", rank: 3 },
	beersheba: { lat: 31.2447, lon: 34.8406, certainty: "known", feature: "city", rank: 2 },
	moriah: { lat: 31.7781, lon: 35.2354, certainty: "known", feature: "mountain", rank: 3 },
	gerar: { lat: 31.3833, lon: 34.6, certainty: "traditional", feature: "city", rank: 3 },
	egypt: { lat: 29.85, lon: 31.25, certainty: "known", feature: "region", rank: 1 },
	goshen: { lat: 30.75, lon: 31.8, certainty: "traditional", feature: "region", rank: 2 },
	peniel: { lat: 32.18, lon: 35.67, certainty: "uncertain", feature: "city", rank: 3 },
	jabbok: { lat: 32.21, lon: 35.79, certainty: "known", feature: "water", rank: 3 },
	// Egypt and the Exodus
	rameses: { lat: 30.7983, lon: 31.8347, certainty: "traditional", feature: "city", rank: 2 },
	"succoth-of-egypt": { lat: 30.5531, lon: 32.0989, certainty: "traditional", feature: "city", rank: 3 },
	etham: { lat: 30.45, lon: 32.38, certainty: "uncertain", feature: "region", rank: 3 },
	pihahiroth: { lat: 30.05, lon: 32.5, certainty: "uncertain", feature: "region", rank: 3 },
	"red-sea": { lat: 29.7, lon: 32.58, certainty: "uncertain", feature: "water", rank: 1 },
	marah: { lat: 29.33, lon: 32.95, certainty: "uncertain", feature: "region", rank: 3 },
	elim: { lat: 29.15, lon: 33.07, certainty: "uncertain", feature: "region", rank: 3 },
	"wilderness-of-sin": { lat: 28.95, lon: 33.35, certainty: "uncertain", feature: "region", rank: 3 },
	rephidim: { lat: 28.72, lon: 33.63, certainty: "uncertain", feature: "region", rank: 3 },
	"mount-sinai": { lat: 28.5394, lon: 33.9753, certainty: "traditional", feature: "mountain", rank: 1 },
	midian: { lat: 28.0, lon: 35.5, certainty: "traditional", feature: "region", rank: 2 },
	kadeshbarnea: { lat: 30.6503, lon: 34.43, certainty: "traditional", feature: "city", rank: 2 },
	eziongaber: { lat: 29.539, lon: 35.005, certainty: "traditional", feature: "city", rank: 3 },
	"mount-hor": { lat: 30.3167, lon: 35.4069, certainty: "traditional", feature: "mountain", rank: 3 },
	edom: { lat: 30.45, lon: 35.6, certainty: "known", feature: "region", rank: 2 },
	moab: { lat: 31.45, lon: 35.78, certainty: "known", feature: "region", rank: 2 },
	"mount-nebo": { lat: 31.7676, lon: 35.7258, certainty: "traditional", feature: "mountain", rank: 2 },
	gilead: { lat: 32.3, lon: 35.86, certainty: "known", feature: "region", rank: 2 },
	jordan: { lat: 32.33, lon: 35.57, certainty: "known", feature: "water", rank: 2 },
	// Conquest and judges
	jericho: { lat: 31.8712, lon: 35.444, certainty: "known", feature: "city", rank: 1 },
	ai: { lat: 31.9164, lon: 35.2614, certainty: "traditional", feature: "city", rank: 3 },
	gilgal: { lat: 31.86, lon: 35.5, certainty: "uncertain", feature: "city", rank: 3 },
	"mount-ebal": { lat: 32.2333, lon: 35.2733, certainty: "known", feature: "mountain", rank: 3 },
	"mount-gerizim": { lat: 32.1994, lon: 35.2731, certainty: "known", feature: "mountain", rank: 3 },
	hazor: { lat: 33.0172, lon: 35.5683, certainty: "known", feature: "city", rank: 2 },
	shiloh: { lat: 32.0556, lon: 35.2897, certainty: "known", feature: "city", rank: 2 },
	dan: { lat: 33.2486, lon: 35.6522, certainty: "known", feature: "city", rank: 2 },
	gaza: { lat: 31.5017, lon: 34.4667, certainty: "known", feature: "city", rank: 2 },
	ashdod: { lat: 31.7547, lon: 34.6639, certainty: "known", feature: "city", rank: 3 },
	gath: { lat: 31.7, lon: 34.8456, certainty: "traditional", feature: "city", rank: 3 },
	mizpah: { lat: 31.8853, lon: 35.2133, certainty: "uncertain", feature: "city", rank: 3 },
	ramah: { lat: 31.8503, lon: 35.2311, certainty: "traditional", feature: "city", rank: 3 },
	gibeah: { lat: 31.8222, lon: 35.2306, certainty: "traditional", feature: "city", rank: 3 },
	"valley-of-elah": { lat: 31.6911, lon: 34.9631, certainty: "known", feature: "region", rank: 3 },
	endor: { lat: 32.6343, lon: 35.3653, certainty: "traditional", feature: "city", rank: 3 },
	"mount-gilboa": { lat: 32.4778, lon: 35.4253, certainty: "known", feature: "mountain", rank: 2 },
	// The kingdoms
	jerusalem: { lat: 31.7767, lon: 35.2316, certainty: "known", feature: "city", rank: 1 },
	zion: { lat: 31.7735, lon: 35.2357, certainty: "traditional", feature: "mountain", rank: 3 },
	tyre: { lat: 33.2705, lon: 35.1964, certainty: "known", feature: "city", rank: 1 },
	sidon: { lat: 33.5631, lon: 35.3689, certainty: "known", feature: "city", rank: 2 },
	"mount-carmel": { lat: 32.728, lon: 35.045, certainty: "known", feature: "mountain", rank: 2 },
	zarephath: { lat: 33.4553, lon: 35.295, certainty: "known", feature: "city", rank: 3 },
	jezreel: { lat: 32.5569, lon: 35.3292, certainty: "known", feature: "city", rank: 3 },
	samaria: { lat: 32.2764, lon: 35.1958, certainty: "known", feature: "city", rank: 1 },
	assyria: { lat: 36.0, lon: 43.4, certainty: "known", feature: "region", rank: 1 },
	nineveh: { lat: 36.3594, lon: 43.1528, certainty: "known", feature: "city", rank: 1 },
	babylon: { lat: 32.5364, lon: 44.4208, certainty: "known", feature: "city", rank: 1 },
	shushan: { lat: 32.1894, lon: 48.2578, certainty: "known", feature: "city", rank: 2 },
	// The Gospels
	bethlehem: { lat: 31.7043, lon: 35.2073, certainty: "known", feature: "city", rank: 1 },
	nazareth: { lat: 32.7019, lon: 35.2972, certainty: "known", feature: "city", rank: 1 },
	capernaum: { lat: 32.8807, lon: 35.5753, certainty: "known", feature: "city", rank: 1 },
	"sea-of-galilee": { lat: 32.8, lon: 35.59, certainty: "known", feature: "water", rank: 1 },
	bethsaida: { lat: 32.9103, lon: 35.6311, certainty: "uncertain", feature: "city", rank: 3 },
	cana: { lat: 32.7466, lon: 35.3392, certainty: "traditional", feature: "city", rank: 2 },
	nain: { lat: 32.6303, lon: 35.3478, certainty: "known", feature: "city", rank: 3 },
	gadarenes: { lat: 32.8261, lon: 35.6503, certainty: "traditional", feature: "region", rank: 3 },
	"caesarea-philippi": { lat: 33.2484, lon: 35.6944, certainty: "known", feature: "city", rank: 2 },
	sychar: { lat: 32.2094, lon: 35.2853, certainty: "traditional", feature: "city", rank: 3 },
	bethabara: { lat: 31.837, lon: 35.55, certainty: "traditional", feature: "city", rank: 3 },
	bethany: { lat: 31.7714, lon: 35.2614, certainty: "traditional", feature: "city", rank: 2 },
	"mount-of-olives": { lat: 31.7784, lon: 35.2443, certainty: "known", feature: "mountain", rank: 2 },
	gethsemane: { lat: 31.7794, lon: 35.2397, certainty: "traditional", feature: "city", rank: 3 },
	golgotha: { lat: 31.7785, lon: 35.2296, certainty: "traditional", feature: "mountain", rank: 3 },
	emmaus: { lat: 31.839, lon: 35.135, certainty: "uncertain", feature: "city", rank: 3 },
	// The early church and Paul's journeys
	joppa: { lat: 32.0544, lon: 34.7522, certainty: "known", feature: "city", rank: 2 },
	caesarea: { lat: 32.5, lon: 34.8917, certainty: "known", feature: "city", rank: 1 },
	damascus: { lat: 33.511, lon: 36.3064, certainty: "known", feature: "city", rank: 1 },
	tarsus: { lat: 36.9164, lon: 34.8936, certainty: "known", feature: "city", rank: 1 },
	antioch: { lat: 36.2025, lon: 36.1606, certainty: "known", feature: "city", rank: 1 },
	seleucia: { lat: 36.1236, lon: 35.9256, certainty: "known", feature: "city", rank: 3 },
	cyprus: { lat: 35.05, lon: 33.2, certainty: "known", feature: "island", rank: 2 },
	salamis: { lat: 35.185, lon: 33.9017, certainty: "known", feature: "city", rank: 3 },
	paphos: { lat: 34.7564, lon: 32.4067, certainty: "known", feature: "city", rank: 3 },
	perga: { lat: 36.9614, lon: 30.8539, certainty: "known", feature: "city", rank: 3 },
	attalia: { lat: 36.8862, lon: 30.7056, certainty: "known", feature: "city", rank: 3 },
	"antioch-in-pisidia": { lat: 38.3061, lon: 31.189, certainty: "known", feature: "city", rank: 2 },
	iconium: { lat: 37.8714, lon: 32.4846, certainty: "known", feature: "city", rank: 2 },
	lystra: { lat: 37.5783, lon: 32.454, certainty: "known", feature: "city", rank: 2 },
	derbe: { lat: 37.3506, lon: 33.3678, certainty: "traditional", feature: "city", rank: 2 },
	galatia: { lat: 39.6, lon: 32.8, certainty: "known", feature: "region", rank: 2 },
	phrygia: { lat: 38.75, lon: 30.3, certainty: "known", feature: "region", rank: 3 },
	mysia: { lat: 39.75, lon: 27.6, certainty: "known", feature: "region", rank: 3 },
	troas: { lat: 39.7519, lon: 26.1586, certainty: "known", feature: "city", rank: 2 },
	samothracia: { lat: 40.485, lon: 25.53, certainty: "known", feature: "island", rank: 3 },
	neapolis: { lat: 40.9369, lon: 24.4128, certainty: "known", feature: "city", rank: 3 },
	philippi: { lat: 41.0131, lon: 24.2864, certainty: "known", feature: "city", rank: 2 },
	amphipolis: { lat: 40.8233, lon: 23.8417, certainty: "known", feature: "city", rank: 3 },
	apollonia: { lat: 40.645, lon: 23.485, certainty: "traditional", feature: "city", rank: 3 },
	thessalonica: { lat: 40.6403, lon: 22.9439, certainty: "known", feature: "city", rank: 2 },
	berea: { lat: 40.5242, lon: 22.2024, certainty: "known", feature: "city", rank: 2 },
	macedonia: { lat: 40.95, lon: 22.4, certainty: "known", feature: "region", rank: 2 },
	athens: { lat: 37.9715, lon: 23.7257, certainty: "known", feature: "city", rank: 1 },
	corinth: { lat: 37.9058, lon: 22.8786, certainty: "known", feature: "city", rank: 1 },
	cenchrea: { lat: 37.8839, lon: 22.9928, certainty: "known", feature: "city", rank: 3 },
	greece: { lat: 38.6, lon: 22.2, certainty: "known", feature: "region", rank: 2 },
	ephesus: { lat: 37.9411, lon: 27.3419, certainty: "known", feature: "city", rank: 1 },
	colosse: { lat: 37.7883, lon: 29.2617, certainty: "known", feature: "city", rank: 3 },
	assos: { lat: 39.4892, lon: 26.3372, certainty: "known", feature: "city", rank: 3 },
	mitylene: { lat: 39.105, lon: 26.555, certainty: "known", feature: "city", rank: 3 },
	chios: { lat: 38.37, lon: 26.06, certainty: "known", feature: "island", rank: 3 },
	samos: { lat: 37.73, lon: 26.83, certainty: "known", feature: "island", rank: 3 },
	trogyllium: { lat: 37.66, lon: 27.03, certainty: "traditional", feature: "city", rank: 3 },
	miletus: { lat: 37.5306, lon: 27.2783, certainty: "known", feature: "city", rank: 2 },
	patmos: { lat: 37.31, lon: 26.547, certainty: "known", feature: "island", rank: 2 },
	coos: { lat: 36.8933, lon: 27.2878, certainty: "known", feature: "island", rank: 3 },
	rhodes: { lat: 36.4341, lon: 28.2176, certainty: "known", feature: "island", rank: 3 },
	patara: { lat: 36.2616, lon: 29.315, certainty: "known", feature: "city", rank: 3 },
	myra: { lat: 36.2589, lon: 29.9853, certainty: "known", feature: "city", rank: 3 },
	ptolemais: { lat: 32.9236, lon: 35.07, certainty: "known", feature: "city", rank: 3 },
	cnidus: { lat: 36.6858, lon: 27.3747, certainty: "known", feature: "city", rank: 3 },
	salmone: { lat: 35.31, lon: 26.31, certainty: "traditional", feature: "region", rank: 3 },
	crete: { lat: 35.25, lon: 24.9, certainty: "known", feature: "island", rank: 2 },
	"fair-havens": { lat: 34.93, lon: 24.81, certainty: "traditional", feature: "city", rank: 3 },
	clauda: { lat: 34.84, lon: 24.08, certainty: "known", feature: "island", rank: 3 },
	melita: { lat: 35.95, lon: 14.4, certainty: "traditional", feature: "island", rank: 2 },
	syracuse: { lat: 37.0755, lon: 15.2866, certainty: "known", feature: "city", rank: 3 },
	rhegium: { lat: 38.111, lon: 15.65, certainty: "known", feature: "city", rank: 3 },
	puteoli: { lat: 40.8236, lon: 14.1219, certainty: "known", feature: "city", rank: 3 },
	"appii-forum": { lat: 41.45, lon: 13.05, certainty: "known", feature: "city", rank: 3 },
	"three-taverns": { lat: 41.6, lon: 12.85, certainty: "traditional", feature: "city", rank: 3 },
	rome: { lat: 41.8925, lon: 12.4853, certainty: "known", feature: "city", rank: 1 },
};
