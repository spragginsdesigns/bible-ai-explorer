/**
 * The side-by-side lanes of SureWord Beta's scrubbable timeline (LC-17655,
 * docs/beta/atlas.md): patriarchs, the Exodus and the judges, the kings of the
 * united kingdom and then of Israel and Judah side by side, the prophets, the
 * exile and return, the life of Christ and the early church.
 *
 * Years are signed (BC is negative), like `AtlasEventDate`. Every span says
 * where its years come from, and the timeline labels it the same way:
 *
 *   ussher   from James Ussher's own Annals of the World (1658). The kings'
 *            accessions are his, checked paragraph by paragraph against the
 *            archive.org text of the 2003 Master Books edition: Rehoboam and
 *            Jeroboam 975 (para. 476-477), Asa 955 (488), Ahab 918 (506),
 *            Jehoshaphat 914 (508), Joash 878 (536), Jeroboam II 825 (550),
 *            Hezekiah 726 (620), Samaria taken 721, Jerusalem levelled 588 (850).
 *   corpus   from the dated events of the shared atlas corpus
 *            (`src/data/bible-atlas/events.json`), whose labels the app already
 *            presents as the traditional (Ussher) dating of the KJV margins.
 *   reigns   Scripture dates the prophet by the kings it names ("in the days of
 *            Uzziah, Jotham, Ahaz, and Hezekiah"); the span runs over those
 *            reigns as Ussher dates them, and says so.
 *
 * Where a span's dates rest on corpus events, `events` names them and the test
 * checks the years still agree with the corpus.
 *
 * No imports on purpose: the tests load this file with Node's type stripping.
 */

export type BetaLaneSource = "ussher" | "corpus" | "reigns";

export interface BetaLaneSpan {
	id: string;
	label: string;
	start: number;
	end: number;
	refs: readonly string[];
	source: BetaLaneSource;
	/** How Scripture dates it, for `reigns`, or anything else worth saying. */
	note?: string;
	/** A corpus person id. */
	person?: string;
	/** A journey id in journeys.ts. */
	journey?: string;
	/** Corpus event ids the years are taken from. */
	events?: readonly string[];
}

export interface BetaLaneUndated {
	label: string;
	refs: readonly string[];
	person?: string;
}

/**
 * Where each of the corpus's nine eras sits on the scrubber. The display span
 * is the era's dated corpus events (the Divided Kingdom runs on to 588 BC while
 * the Exile has begun in 606 BC); `scaleEnd` is where its share of the track
 * stops, so the track is one continuous run. `weight` is its share: dense eras
 * get more room than long quiet ones.
 */
export const BETA_ERA_SPANS: readonly { era: string; start: number; end: number; scaleEnd: number; weight: number }[] = [
	{ era: "Creation & the Patriarchs", start: -4004, end: -1635, scaleEnd: -1635, weight: 1.5 },
	{ era: "Egypt & the Exodus", start: -1635, end: -1451, scaleEnd: -1451, weight: 1.1 },
	{ era: "Conquest & Judges", start: -1451, end: -1095, scaleEnd: -1095, weight: 1.2 },
	{ era: "United Kingdom", start: -1095, end: -975, scaleEnd: -975, weight: 0.9 },
	{ era: "Divided Kingdom", start: -975, end: -588, scaleEnd: -606, weight: 2.2 },
	{ era: "Exile & Return", start: -606, end: -397, scaleEnd: -397, weight: 1.1 },
	{ era: "Between the Testaments", start: -397, end: -5, scaleEnd: -5, weight: 0.5 },
	{ era: "Life of Christ", start: -5, end: 30, scaleEnd: 30, weight: 1.3 },
	{ era: "The Early Church", start: 30, end: 96, scaleEnd: 96, weight: 1.2 },
];

export interface BetaLane {
	id: string;
	title: string;
	/** The scrubber's row label, short enough for a phone. */
	short: string;
	spans: readonly BetaLaneSpan[];
	/** Corpus events drawn as points in this lane. */
	events?: readonly string[];
	/** Entries Scripture gives no date for, listed beside the lane. */
	undated?: readonly BetaLaneUndated[];
	/** What the lane says when the scrubber is in one of its gaps. */
	gap?: string;
	/** What the lane says for a while after its last span ends. */
	after?: string;
}

export const BETA_TIMELINE_LANES: readonly BetaLane[] = [
	{
		id: "patriarchs",
		title: "Patriarchs",
		short: "Patriarchs",
		spans: [
			{ id: "abraham", label: "Abraham", start: -1996, end: -1821, refs: ["Genesis 11:26", "Genesis 25:7"], source: "ussher", person: "abraham", journey: "abraham" },
			{ id: "isaac", label: "Isaac", start: -1896, end: -1716, refs: ["Genesis 21:5", "Genesis 35:28"], source: "ussher", person: "isaac" },
			{ id: "jacob", label: "Jacob", start: -1836, end: -1689, refs: ["Genesis 25:26", "Genesis 47:28"], source: "ussher", person: "jacob" },
			{ id: "joseph", label: "Joseph", start: -1745, end: -1635, refs: ["Genesis 30:24", "Genesis 50:26"], source: "ussher", person: "joseph" },
		],
	},
	{
		id: "judges",
		title: "Exodus & judges",
		short: "Judges",
		spans: [
			{ id: "moses-exodus", label: "Moses: the Exodus and the wilderness", start: -1491, end: -1451, refs: ["Exodus 12:41", "Numbers 14:33", "Deuteronomy 34:5"], source: "corpus", person: "moses", journey: "exodus", events: ["the-exodus", "moses-dies-on-nebo"] },
			{ id: "joshua", label: "Joshua", start: -1451, end: -1427, refs: ["Joshua 1:2", "Joshua 24:29"], source: "corpus", person: "joshua", events: ["joshua-commissioned", "joshuas-farewell"] },
		],
		events: [
			"othniel-delivers-israel",
			"ehud-and-eglon",
			"ruth-gleans-in-bethlehem",
			"deborah-and-barak",
			"gideons-three-hundred",
			"abimelech-made-king",
			"jephthahs-vow",
			"samuel-called-at-shiloh",
			"samson-and-delilah",
			"israel-asks-for-a-king",
		],
		gap: "In those days there was no king in Israel: the LORD raised up judges.",
	},
	{
		id: "united",
		title: "United kingdom",
		short: "United",
		spans: [
			{ id: "saul", label: "Saul", start: -1095, end: -1056, refs: ["1 Samuel 10:1", "1 Samuel 31:6"], source: "ussher", person: "saul" },
			{ id: "david", label: "David", start: -1056, end: -1015, refs: ["2 Samuel 2:4", "2 Samuel 5:4", "1 Kings 2:11"], source: "ussher", person: "david", note: "King over Judah in Hebron seven years and six months, then over all Israel in Jerusalem thirty and three years (2 Samuel 5:5)." },
			{ id: "solomon", label: "Solomon", start: -1015, end: -975, refs: ["1 Kings 1:39", "1 Kings 11:42"], source: "ussher", person: "solomon" },
		],
	},
	{
		id: "israel",
		title: "Kings of Israel",
		short: "Israel",
		gap: "No king on the throne of Israel in Ussher's reckoning.",
		after: "Samaria was taken in 721 BC and Israel carried away into Assyria (2 Kings 17:6).",
		spans: [
			{ id: "jeroboam", label: "Jeroboam", start: -975, end: -954, refs: ["1 Kings 12:20", "1 Kings 14:20"], source: "ussher", person: "jeroboam" },
			{ id: "nadab", label: "Nadab", start: -954, end: -953, refs: ["1 Kings 15:25"], source: "ussher" },
			{ id: "baasha", label: "Baasha", start: -953, end: -930, refs: ["1 Kings 15:33"], source: "ussher" },
			{ id: "elah", label: "Elah", start: -930, end: -929, refs: ["1 Kings 16:8"], source: "ussher" },
			{ id: "zimri", label: "Zimri", start: -929, end: -929, refs: ["1 Kings 16:15"], source: "ussher", note: "Reigned seven days in Tirzah." },
			{ id: "omri", label: "Omri", start: -929, end: -918, refs: ["1 Kings 16:23"], source: "ussher" },
			{ id: "ahab", label: "Ahab", start: -918, end: -898, refs: ["1 Kings 16:29"], source: "ussher", person: "ahab" },
			{ id: "ahaziah-of-israel", label: "Ahaziah", start: -898, end: -896, refs: ["1 Kings 22:51"], source: "ussher" },
			{ id: "jehoram-of-israel", label: "Jehoram (Joram)", start: -896, end: -884, refs: ["2 Kings 3:1"], source: "ussher" },
			{ id: "jehu", label: "Jehu", start: -884, end: -856, refs: ["2 Kings 9:6", "2 Kings 10:36"], source: "ussher", person: "jehu" },
			{ id: "jehoahaz-of-israel", label: "Jehoahaz", start: -856, end: -841, refs: ["2 Kings 13:1"], source: "ussher" },
			{ id: "jehoash-of-israel", label: "Jehoash (Joash)", start: -841, end: -825, refs: ["2 Kings 13:10"], source: "ussher" },
			{ id: "jeroboam-ii", label: "Jeroboam II", start: -825, end: -784, refs: ["2 Kings 14:23"], source: "ussher" },
			{ id: "zachariah", label: "Zachariah", start: -773, end: -772, refs: ["2 Kings 15:8"], source: "ussher", note: "Reigned six months." },
			{ id: "shallum", label: "Shallum", start: -772, end: -772, refs: ["2 Kings 15:13"], source: "ussher", note: "Reigned a full month." },
			{ id: "menahem", label: "Menahem", start: -772, end: -761, refs: ["2 Kings 15:17"], source: "ussher" },
			{ id: "pekahiah", label: "Pekahiah", start: -761, end: -759, refs: ["2 Kings 15:23"], source: "ussher" },
			{ id: "pekah", label: "Pekah", start: -759, end: -739, refs: ["2 Kings 15:27"], source: "ussher" },
			{ id: "hoshea", label: "Hoshea", start: -730, end: -721, refs: ["2 Kings 17:1", "2 Kings 17:6"], source: "ussher", note: "In the ninth year of Hoshea the king of Assyria took Samaria, and carried Israel away." },
		],
	},
	{
		id: "judah",
		title: "Kings of Judah",
		short: "Judah",
		after: "Jerusalem was broken up in 588 BC and Judah carried away to Babylon (2 Kings 25:4-11).",
		spans: [
			{ id: "rehoboam", label: "Rehoboam", start: -975, end: -958, refs: ["1 Kings 14:21"], source: "ussher", person: "rehoboam" },
			{ id: "abijam", label: "Abijam", start: -958, end: -955, refs: ["1 Kings 15:1", "1 Kings 15:2"], source: "ussher" },
			{ id: "asa", label: "Asa", start: -955, end: -914, refs: ["1 Kings 15:9", "1 Kings 15:10"], source: "ussher" },
			{ id: "jehoshaphat", label: "Jehoshaphat", start: -914, end: -889, refs: ["1 Kings 22:41", "1 Kings 22:42"], source: "ussher" },
			{ id: "jehoram-of-judah", label: "Jehoram", start: -889, end: -885, refs: ["2 Kings 8:16", "2 Kings 8:17"], source: "ussher", note: "Made king beside his father in 892, Jehoshaphat being then king of Judah (2 Kings 8:16); reigned alone from 889." },
			{ id: "ahaziah-of-judah", label: "Ahaziah", start: -885, end: -884, refs: ["2 Kings 8:25", "2 Kings 8:26"], source: "ussher" },
			{ id: "athaliah", label: "Athaliah", start: -884, end: -878, refs: ["2 Kings 11:1", "2 Kings 11:3"], source: "ussher", person: "athaliah" },
			{ id: "joash", label: "Joash", start: -878, end: -839, refs: ["2 Kings 12:1"], source: "ussher", person: "joash" },
			{ id: "amaziah", label: "Amaziah", start: -839, end: -810, refs: ["2 Kings 14:1", "2 Kings 14:2"], source: "ussher" },
			{ id: "uzziah", label: "Uzziah (Azariah)", start: -810, end: -758, refs: ["2 Kings 15:1", "2 Kings 15:2"], source: "ussher" },
			{ id: "jotham", label: "Jotham", start: -758, end: -742, refs: ["2 Kings 15:32", "2 Kings 15:33"], source: "ussher" },
			{ id: "ahaz", label: "Ahaz", start: -742, end: -726, refs: ["2 Kings 16:1", "2 Kings 16:2"], source: "ussher" },
			{ id: "hezekiah", label: "Hezekiah", start: -726, end: -698, refs: ["2 Kings 18:1", "2 Kings 18:2"], source: "ussher", person: "hezekiah" },
			{ id: "manasseh", label: "Manasseh", start: -698, end: -643, refs: ["2 Kings 21:1"], source: "ussher", person: "manasseh" },
			{ id: "amon", label: "Amon", start: -643, end: -641, refs: ["2 Kings 21:19"], source: "ussher" },
			{ id: "josiah", label: "Josiah", start: -641, end: -610, refs: ["2 Kings 22:1"], source: "ussher", person: "josiah" },
			{ id: "jehoahaz-of-judah", label: "Jehoahaz", start: -610, end: -610, refs: ["2 Kings 23:31"], source: "ussher", note: "Reigned three months." },
			{ id: "jehoiakim", label: "Jehoiakim", start: -610, end: -599, refs: ["2 Kings 23:36"], source: "ussher" },
			{ id: "jehoiachin", label: "Jehoiachin", start: -599, end: -599, refs: ["2 Kings 24:8"], source: "ussher", note: "Reigned three months, then was carried to Babylon." },
			{ id: "zedekiah", label: "Zedekiah", start: -599, end: -588, refs: ["2 Kings 24:18", "2 Kings 25:2"], source: "ussher", note: "In his eleventh year the city was broken up; Ussher dates the levelling of Jerusalem's walls to 588 BC." },
		],
	},
	{
		id: "prophets",
		title: "Prophets",
		short: "Prophets",
		spans: [
			{ id: "elijah", label: "Elijah", start: -910, end: -896, refs: ["1 Kings 17:1", "2 Kings 2:11"], source: "corpus", person: "elijah", events: ["elijah-and-the-drought", "elijah-taken-up"] },
			{ id: "elisha", label: "Elisha", start: -896, end: -839, refs: ["2 Kings 2:15", "2 Kings 13:14"], source: "ussher", person: "elisha", note: "From Elijah's taking up to his death in the days of Joash king of Israel." },
			{ id: "amos", label: "Amos", start: -810, end: -784, refs: ["Amos 1:1"], source: "reigns", person: "amos", note: "In the days of Uzziah king of Judah, and in the days of Jeroboam king of Israel." },
			{ id: "hosea", label: "Hosea", start: -810, end: -698, refs: ["Hosea 1:1"], source: "reigns", person: "hosea", note: "In the days of Uzziah, Jotham, Ahaz, and Hezekiah, kings of Judah, and of Jeroboam king of Israel." },
			{ id: "isaiah", label: "Isaiah", start: -810, end: -698, refs: ["Isaiah 1:1", "Isaiah 6:1"], source: "reigns", person: "isaiah", note: "In the days of Uzziah, Jotham, Ahaz, and Hezekiah, kings of Judah; he saw the Lord in the year that king Uzziah died." },
			{ id: "micah", label: "Micah", start: -758, end: -698, refs: ["Micah 1:1"], source: "reigns", person: "micah", note: "In the days of Jotham, Ahaz, and Hezekiah, kings of Judah." },
			{ id: "zephaniah", label: "Zephaniah", start: -641, end: -610, refs: ["Zephaniah 1:1"], source: "reigns", person: "zephaniah", note: "In the days of Josiah king of Judah." },
			{ id: "jeremiah", label: "Jeremiah", start: -629, end: -588, refs: ["Jeremiah 1:2", "Jeremiah 1:3"], source: "reigns", person: "jeremiah", note: "From the thirteenth year of Josiah unto the end of the eleventh year of Zedekiah.", events: ["jeremiah-called"] },
			{ id: "ezekiel", label: "Ezekiel", start: -595, end: -573, refs: ["Ezekiel 1:2", "Ezekiel 29:17"], source: "reigns", person: "ezekiel", note: "From the fifth year of king Jehoiachin's captivity to the seven and twentieth year.", events: ["ezekiel-by-chebar"] },
			{ id: "daniel", label: "Daniel", start: -606, end: -534, refs: ["Daniel 1:1", "Daniel 10:1"], source: "corpus", person: "daniel", note: "From the first captives taken to Babylon to the third year of Cyrus king of Persia, two years after his decree.", events: ["first-captives-to-babylon"] },
			{ id: "haggai", label: "Haggai", start: -520, end: -520, refs: ["Haggai 1:1"], source: "ussher", person: "haggai", note: "In the second year of Darius the king." },
			{ id: "zechariah", label: "Zechariah", start: -520, end: -518, refs: ["Zechariah 1:1", "Zechariah 7:1"], source: "reigns", person: "zechariah", note: "From the second to the fourth year of king Darius." },
		],
		events: ["jonah-sent-to-nineveh", "isaiah-sees-the-lord", "malachis-last-word"],
		undated: [
			{ label: "Joel", refs: ["Joel 1:1"], person: "joel" },
			{ label: "Obadiah", refs: ["Obadiah 1:1"], person: "obadiah" },
			{ label: "Nahum", refs: ["Nahum 1:1"], person: "nahum" },
			{ label: "Habakkuk", refs: ["Habakkuk 1:1"], person: "habakkuk" },
		],
	},
	{
		id: "exile",
		title: "Exile & return",
		short: "Exile",
		spans: [
			{ id: "seventy-years", label: "The seventy years in Babylon", start: -606, end: -536, refs: ["Jeremiah 25:11", "2 Chronicles 36:21", "2 Chronicles 36:22"], source: "corpus", events: ["first-captives-to-babylon", "cyrus-decree"] },
		],
		events: [
			"jerusalem-burnt",
			"cyrus-decree",
			"foundation-of-second-temple",
			"second-temple-finished",
			"esther-made-queen",
			"ezra-brings-the-law",
			"the-wall-rebuilt",
		],
	},
	{
		id: "christ",
		title: "Life of Christ",
		short: "Christ",
		spans: [
			{ id: "life-of-christ", label: "The life of Christ", start: -4, end: 30, refs: ["Luke 2:11", "Acts 1:9"], source: "corpus", person: "jesus-christ", journey: "gospels", events: ["the-birth-of-christ", "the-ascension"] },
		],
	},
	{
		id: "church",
		title: "Early church",
		short: "Church",
		spans: [
			{ id: "early-church", label: "From Pentecost to Patmos", start: 30, end: 96, refs: ["Acts 2:1", "Revelation 1:9"], source: "corpus", events: ["pentecost", "john-on-patmos"] },
		],
	},
];
