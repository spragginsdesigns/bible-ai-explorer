/**
 * Chapter Games (LC-17850, LC-17851, docs/beta/games.md): one quick game for
 * each chapter of Matthew, and the award a won game earns. Each game is a
 * short round (about fifteen seconds, LC-17851's "wario-ware" ask) played in
 * the page: its command, controls and tips are shown big before it starts,
 * and the cast speaks a verse of the chapter as it begins and when it is won.
 * No imports on purpose: the reader (a client component), the server and the
 * tests all load it, the tests with Node's type stripping.
 */

export type GameGrade = "gold" | "silver" | "bronze";

/** One control of a game, as its start screen shows it: keys on a keyboard, the gesture on a touch screen. */
export interface GameControl {
	/** Key caps, as printed: "←", "→", "↑", "↓", "Space", a letter or digit, or "Click" for the mouse. */
	keys: readonly string[];
	/** The gesture on a touch screen ("Tap", "Drag", "Swipe left"). */
	touch: string;
	/** What it does, short ("Hop forward"). */
	action: string;
}

export interface ChapterGame {
	/** Stable id: the award item's key and the API's `<game>` segment. */
	slug: string;
	title: string;
	tagline: string;
	/** Canonical book order (Matthew is 40), chapter, and the verses the game plays. */
	book: number;
	chapter: number;
	verses: readonly [number, number];
	/** "Matthew 14:22-33". */
	reference: string;
	/** The passage's story in a few words ("Peter walks on the water"). */
	story: string;
	/** The one-word order flashed as the round starts ("Hop!"). */
	command: string;
	controls: readonly GameControl[];
	/** At most two short tips, shown under the controls. */
	tips: readonly string[];
	/** How long a round runs, in seconds. */
	seconds: number;
	/** The soonest a round can be won; the server refuses a faster reported run. */
	minSeconds: number;
	/** The verses the cast speaks as the round starts and when it is won (from the full-cast recording). */
	voice: { intro: number; win: number };
	/** What winning it earns. */
	award: string;
	/** The award's three grades, named from the passage. */
	grades: Record<GameGrade, string>;
	/** What the round's 0-100 score (`faithKept`) measures, in lower case ("faith kept"). */
	measure: string;
	/** The medal's mark, from the passage. */
	emblem: GameEmblem;
	/** The award item's study-store topics. */
	topics: readonly string[];
}

export type GameEmblem =
	| "scroll"
	| "star"
	| "wheat"
	| "fish"
	| "flame"
	| "gem"
	| "house"
	| "sailboat"
	| "hand"
	| "bird"
	| "feather"
	| "apple"
	| "sprout"
	| "wave"
	| "basket"
	| "key"
	| "coins"
	| "search"
	| "sparkles"
	| "eye"
	| "leaf"
	| "shirt"
	| "egg"
	| "zap"
	| "crown"
	| "moon"
	| "heart"
	| "sun";

const MATTHEW = 40;
const TAP = { keys: ["Click"], touch: "Tap" } as const;

export const CHAPTER_GAMES: readonly ChapterGame[] = [
	{
		slug: "the-generations",
		title: "The Generations",
		tagline: "Tap the line from Abraham to Christ, in order",
		book: MATTHEW,
		chapter: 1,
		verses: [1, 17],
		reference: "Matthew 1:1-17",
		story: "The book of the generation of Jesus Christ",
		command: "In order!",
		controls: [{ ...TAP, action: "Tap the next name in the line" }],
		tips: ["Who begat whom: follow the line", "A wrong name costs you time"],
		seconds: 15,
		minSeconds: 4,
		voice: { intro: 1, win: 17 },
		award: "The Son of David",
		grades: { gold: "Fourteen Generations", silver: "The Son of Abraham", bronze: "The Book of the Generation" },
		measure: "order kept",
		emblem: "scroll",
		topics: ["chapter game", "genealogy"],
	},
	{
		slug: "the-caravan",
		title: "The Caravan",
		tagline: "Run the desert under the star",
		book: MATTHEW,
		chapter: 2,
		verses: [1, 12],
		reference: "Matthew 2:1-12",
		story: "The wise men follow the star",
		command: "Jump!",
		controls: [
			{ keys: ["↑", "Space"], touch: "Tap", action: "Jump" },
			{ keys: ["↓"], touch: "Swipe down", action: "Duck" },
		],
		tips: ["Jump the rocks, duck the low ledges", "Keep under the star"],
		seconds: 15,
		minSeconds: 15,
		voice: { intro: 2, win: 10 },
		award: "Come to Worship Him",
		grades: { gold: "Exceeding Great Joy", silver: "The Star Went Before Them", bronze: "We Have Seen His Star" },
		measure: "kept to the star",
		emblem: "star",
		topics: ["chapter game", "worship"],
	},
	{
		slug: "winnow",
		title: "Winnow the Floor",
		tagline: "Wheat to the garner, chaff to the fire",
		book: MATTHEW,
		chapter: 3,
		verses: [11, 17],
		reference: "Matthew 3:11-17",
		story: "John baptizes in Jordan",
		command: "Sort!",
		controls: [
			{ keys: ["←"], touch: "Swipe left", action: "Wheat to the garner" },
			{ keys: ["→"], touch: "Swipe right", action: "Chaff to the fire" },
		],
		tips: ["Golden grain is wheat, pale husks are chaff", "It gets faster: keep up"],
		seconds: 15,
		minSeconds: 15,
		voice: { intro: 12, win: 17 },
		award: "Whose Fan Is in His Hand",
		grades: { gold: "Well Pleased", silver: "Gathered into the Garner", bronze: "Fruits Meet for Repentance" },
		measure: "sorted right",
		emblem: "wheat",
		topics: ["chapter game", "repentance"],
	},
	{
		slug: "fishers-of-men",
		title: "Fishers of Men",
		tagline: "Cast the net with Peter and Andrew",
		book: MATTHEW,
		chapter: 4,
		verses: [18, 22],
		reference: "Matthew 4:18-22",
		story: "Jesus calls Peter and Andrew",
		command: "Catch!",
		controls: [{ keys: ["←", "→"], touch: "Drag", action: "Move the net" }],
		tips: ["Catch the fish", "Let the driftwood go by"],
		seconds: 15,
		minSeconds: 15,
		voice: { intro: 19, win: 20 },
		award: "Fishers of Men",
		grades: { gold: "Straightway They Followed", silver: "Casting a Net", bronze: "By the Sea of Galilee" },
		measure: "fish caught",
		emblem: "fish",
		topics: ["chapter game", "discipleship"],
	},
	{
		slug: "let-your-light-shine",
		title: "Let Your Light Shine",
		tagline: "Lift the bushels off the candles",
		book: MATTHEW,
		chapter: 5,
		verses: [14, 16],
		reference: "Matthew 5:14-16",
		story: "The light of the world",
		command: "Uncover!",
		controls: [{ ...TAP, action: "Lift a bushel off its candle" }],
		tips: ["Lift each bushel as it covers a light", "Tap only the bushels: misses put lights out"],
		seconds: 15,
		minSeconds: 15,
		voice: { intro: 15, win: 16 },
		award: "The Light of the World",
		grades: { gold: "Let Your Light So Shine", silver: "A City Set on an Hill", bronze: "On a Candlestick" },
		measure: "light kept",
		emblem: "flame",
		topics: ["chapter game", "witness"],
	},
	{
		slug: "treasures-in-heaven",
		title: "Treasures in Heaven",
		tagline: "Lay up treasure where moth and rust cannot reach",
		book: MATTHEW,
		chapter: 6,
		verses: [19, 21],
		reference: "Matthew 6:19-21",
		story: "Treasures in heaven",
		command: "Lay up!",
		controls: [{ keys: ["←", "→"], touch: "Drag", action: "Move the chest" }],
		tips: ["Catch the gold and jewels", "Dodge the moths and the rust"],
		seconds: 15,
		minSeconds: 15,
		voice: { intro: 19, win: 21 },
		award: "Treasure in Heaven",
		grades: { gold: "Where Your Heart Is", silver: "Neither Moth nor Rust", bronze: "Lay Up for Yourselves" },
		measure: "treasure kept",
		emblem: "gem",
		topics: ["chapter game", "treasure"],
	},
	{
		slug: "house-on-the-rock",
		title: "Built on the Rock",
		tagline: "Stack the wise man's house before the rain",
		book: MATTHEW,
		chapter: 7,
		verses: [24, 27],
		reference: "Matthew 7:24-27",
		story: "The wise man built his house upon a rock",
		command: "Build!",
		controls: [{ keys: ["Space", "↓"], touch: "Tap", action: "Drop the stone" }],
		tips: ["Drop each stone square on the one below", "The rain and the winds will test it"],
		seconds: 15,
		minSeconds: 6,
		voice: { intro: 24, win: 25 },
		award: "Founded upon a Rock",
		grades: { gold: "It Fell Not", silver: "A Wise Man", bronze: "Heareth These Sayings" },
		measure: "built true",
		emblem: "house",
		topics: ["chapter game", "obedience"],
	},
	{
		slug: "lord-save-us",
		title: "Lord, Save Us",
		tagline: "Bail the ship till Jesus rebukes the wind",
		book: MATTHEW,
		chapter: 8,
		verses: [23, 27],
		reference: "Matthew 8:23-27",
		story: "Jesus calms the storm",
		command: "Bail!",
		controls: [{ keys: ["←", "→"], touch: "Tap left, then right", action: "Bail: left, right, left, right" }],
		tips: ["Alternate left and right to bail fast", "Big waves pour in more"],
		seconds: 12,
		minSeconds: 12,
		voice: { intro: 25, win: 26 },
		award: "A Great Calm",
		grades: { gold: "Even the Winds and the Sea Obey Him", silver: "What Manner of Man", bronze: "O Ye of Little Faith" },
		measure: "ship kept afloat",
		emblem: "sailboat",
		topics: ["chapter game", "faith"],
	},
	{
		slug: "hem-of-his-garment",
		title: "The Hem of His Garment",
		tagline: "Press through the crowd and touch the hem",
		book: MATTHEW,
		chapter: 9,
		verses: [20, 22],
		reference: "Matthew 9:20-22",
		story: "She touched the hem of his garment",
		command: "Reach!",
		controls: [{ keys: ["←", "→", "↑", "↓"], touch: "Drag", action: "Weave through the crowd" }],
		tips: ["Slip through the gaps in the crowd", "Touch the hem before he passes"],
		seconds: 15,
		minSeconds: 2.8,
		voice: { intro: 21, win: 22 },
		award: "Thy Faith Hath Made Thee Whole",
		grades: { gold: "Whole from That Hour", silver: "Be of Good Comfort", bronze: "If I May But Touch" },
		measure: "faith kept",
		emblem: "hand",
		topics: ["chapter game", "healing"],
	},
	{
		slug: "sheep-among-wolves",
		title: "Sheep Among Wolves",
		tagline: "Wise as serpents, harmless as doves",
		book: MATTHEW,
		chapter: 10,
		verses: [16, 31],
		reference: "Matthew 10:16-31",
		story: "The twelve sent forth",
		command: "Dodge!",
		controls: [{ keys: ["←", "→", "↑", "↓"], touch: "Drag", action: "Move the sheep" }],
		tips: ["Keep clear of the wolves", "A wolf crouches before it lunges"],
		seconds: 15,
		minSeconds: 15,
		voice: { intro: 16, win: 31 },
		award: "Wise as Serpents",
		grades: { gold: "Harmless as Doves", silver: "Of More Value Than Many Sparrows", bronze: "Fear Ye Not" },
		measure: "kept safe",
		emblem: "bird",
		topics: ["chapter game", "mission"],
	},
	{
		slug: "rest-for-your-souls",
		title: "Rest for Your Souls",
		tagline: "Lift the burdens off the weary",
		book: MATTHEW,
		chapter: 11,
		verses: [28, 30],
		reference: "Matthew 11:28-30",
		story: "Come unto me, and I will give you rest",
		command: "Lift!",
		controls: [{ ...TAP, action: "Lift a burden off" }],
		tips: ["Lift each burden before a traveller falls", "The heaviest glow red: lift them first"],
		seconds: 15,
		minSeconds: 15,
		voice: { intro: 28, win: 30 },
		award: "My Burden Is Light",
		grades: { gold: "Rest unto Your Souls", silver: "My Yoke Is Easy", bronze: "Come unto Me" },
		measure: "burdens lifted",
		emblem: "feather",
		topics: ["chapter game", "rest"],
	},
	{
		slug: "known-by-his-fruit",
		title: "Known by His Fruit",
		tagline: "Pick the good fruit, leave the corrupt",
		book: MATTHEW,
		chapter: 12,
		verses: [33, 35],
		reference: "Matthew 12:33-35",
		story: "The tree is known by his fruit",
		command: "Pick!",
		controls: [{ ...TAP, action: "Pick a good fruit" }],
		tips: ["Pick fruit while it is bright and ripe", "Never pick the corrupt fruit"],
		seconds: 15,
		minSeconds: 15,
		voice: { intro: 33, win: 35 },
		award: "Known by His Fruit",
		grades: { gold: "Make the Tree Good", silver: "The Good Treasure of the Heart", bronze: "Good Things" },
		measure: "good fruit picked",
		emblem: "apple",
		topics: ["chapter game", "fruit"],
	},
	{
		slug: "the-sower",
		title: "The Sower",
		tagline: "Sow the seed on the good ground",
		book: MATTHEW,
		chapter: 13,
		verses: [3, 9],
		reference: "Matthew 13:3-9",
		story: "A sower went forth to sow",
		command: "Sow!",
		controls: [{ keys: ["Space"], touch: "Tap", action: "Scatter seed" }],
		tips: ["Sow only on the good ground", "Not the wayside, the stones or the thorns"],
		seconds: 15,
		minSeconds: 15,
		voice: { intro: 3, win: 8 },
		award: "An Hundredfold",
		grades: { gold: "An Hundredfold", silver: "Sixtyfold", bronze: "Thirtyfold" },
		measure: "seed on good ground",
		emblem: "sprout",
		topics: ["chapter game", "the word"],
	},
	{
		slug: "crest-hopper",
		title: "Crest Hopper",
		tagline: "Hop the swells to Jesus",
		book: MATTHEW,
		chapter: 14,
		verses: [22, 33],
		reference: "Matthew 14:22-33",
		story: "Peter walks on the water",
		command: "Hop!",
		controls: [
			{ keys: ["↑", "Space"], touch: "Tap", action: "Hop forward" },
			{ keys: ["←", "→"], touch: "Swipe", action: "Hop sideways" },
		],
		tips: ["Land on the crests, not the troughs", "Gusts shove you sideways"],
		seconds: 15,
		minSeconds: 3,
		voice: { intro: 29, win: 33 },
		award: "Walked on the Water",
		grades: { gold: "Eyes on Jesus", silver: "Of Good Cheer", bronze: "Be Not Afraid" },
		measure: "faith kept",
		emblem: "wave",
		topics: ["chapter game", "faith"],
	},
	{
		slug: "seven-baskets",
		title: "Seven Baskets Full",
		tagline: "Gather up the broken meat that was left",
		book: MATTHEW,
		chapter: 15,
		verses: [32, 38],
		reference: "Matthew 15:32-38",
		story: "Seven loaves and a few little fishes",
		command: "Gather!",
		controls: [{ keys: ["←", "→"], touch: "Drag", action: "Move the basket" }],
		tips: ["Gather the falling bread and fish", "Fill all seven baskets"],
		seconds: 15,
		minSeconds: 6,
		voice: { intro: 36, win: 37 },
		award: "They Did All Eat",
		grades: { gold: "Seven Baskets Full", silver: "They Were Filled", bronze: "I Have Compassion" },
		measure: "fragments gathered",
		emblem: "basket",
		topics: ["chapter game", "provision"],
	},
	{
		slug: "whom-say-ye",
		title: "Whom Say Ye?",
		tagline: "Keep your eye on the true answer",
		book: MATTHEW,
		chapter: 16,
		verses: [13, 18],
		reference: "Matthew 16:13-18",
		story: "Thou art the Christ",
		command: "Follow it!",
		controls: [{ keys: ["Click", "1", "2", "3", "4"], touch: "Tap", action: "Tap the true answer" }],
		tips: ["Watch the true answer as the scrolls shuffle", "Then tap it"],
		seconds: 15,
		minSeconds: 8,
		voice: { intro: 15, win: 16 },
		award: "Upon This Rock",
		grades: { gold: "The Son of the Living God", silver: "Thou Art Peter", bronze: "Whom Say Ye" },
		measure: "answered true",
		emblem: "key",
		topics: ["chapter game", "confession"],
	},
	{
		slug: "coin-in-the-fish",
		title: "The Coin in the Fish",
		tagline: "Take up the fish that first cometh up",
		book: MATTHEW,
		chapter: 17,
		verses: [24, 27],
		reference: "Matthew 17:24-27",
		story: "A piece of money in the fish's mouth",
		command: "Hook it!",
		controls: [{ keys: ["Space"], touch: "Tap", action: "Strike" }],
		tips: ["Strike the moment the fish bites", "Too soon and it swims away"],
		seconds: 15,
		minSeconds: 4,
		voice: { intro: 24, win: 27 },
		award: "For Me and Thee",
		grades: { gold: "For Me and Thee", silver: "A Piece of Money", bronze: "Cast an Hook" },
		measure: "clean strikes",
		emblem: "coins",
		topics: ["chapter game", "provision"],
	},
	{
		slug: "the-lost-sheep",
		title: "The Lost Sheep",
		tagline: "Leave the ninety and nine and seek the one",
		book: MATTHEW,
		chapter: 18,
		verses: [12, 14],
		reference: "Matthew 18:12-14",
		story: "The one that went astray",
		command: "Seek!",
		controls: [{ ...TAP, action: "Tap the lost sheep" }],
		tips: ["One sheep has gone astray in the mountains", "Find it before nightfall"],
		seconds: 15,
		minSeconds: 3,
		voice: { intro: 12, win: 13 },
		award: "He Rejoiceth More",
		grades: { gold: "He Rejoiceth More", silver: "That Which Is Gone Astray", bronze: "The Ninety and Nine" },
		measure: "found quickly",
		emblem: "search",
		topics: ["chapter game", "the lost"],
	},
	{
		slug: "eye-of-a-needle",
		title: "The Eye of a Needle",
		tagline: "Thread every needle: with God all things are possible",
		book: MATTHEW,
		chapter: 19,
		verses: [23, 26],
		reference: "Matthew 19:23-26",
		story: "With God all things are possible",
		command: "Thread it!",
		controls: [{ keys: ["Space", "↑"], touch: "Hold", action: "Hold to rise, let go to fall" }],
		tips: ["Pass through every needle's eye", "Small taps, not long holds"],
		seconds: 15,
		minSeconds: 15,
		voice: { intro: 24, win: 26 },
		award: "All Things Are Possible",
		grades: { gold: "With God All Things Are Possible", silver: "Exceedingly Amazed", bronze: "The Eye of a Needle" },
		measure: "eyes threaded",
		emblem: "sparkles",
		topics: ["chapter game", "salvation"],
	},
	{
		slug: "have-mercy-on-us",
		title: "Have Mercy on Us",
		tagline: "Cry out above the crowd as Jesus passes by",
		book: MATTHEW,
		chapter: 20,
		verses: [29, 34],
		reference: "Matthew 20:29-34",
		story: "Two blind men by the way side",
		command: "Cry out!",
		controls: [{ keys: ["Space"], touch: "Tap fast", action: "Cry out" }],
		tips: ["Tap fast so Jesus hears", "When the crowd rebukes you, cry the more"],
		seconds: 12,
		minSeconds: 4,
		voice: { intro: 30, win: 34 },
		award: "Their Eyes Received Sight",
		grades: { gold: "And They Followed Him", silver: "That Our Eyes May Be Opened", bronze: "Have Mercy on Us" },
		measure: "heard",
		emblem: "eye",
		topics: ["chapter game", "mercy"],
	},
	{
		slug: "hosanna",
		title: "Hosanna!",
		tagline: "Spread branches in the way",
		book: MATTHEW,
		chapter: 21,
		verses: [1, 11],
		reference: "Matthew 21:1-11",
		story: "Hosanna to the Son of David",
		command: "Spread!",
		controls: [{ keys: ["Space"], touch: "Tap", action: "Lay a branch" }],
		tips: ["Lay a branch when a bare patch is in the glowing zone", "Keep the way covered"],
		seconds: 15,
		minSeconds: 15,
		voice: { intro: 8, win: 9 },
		award: "Hosanna in the Highest",
		grades: { gold: "Hosanna in the Highest", silver: "Blessed Is He That Cometh", bronze: "Branches in the Way" },
		measure: "way covered",
		emblem: "leaf",
		topics: ["chapter game", "praise"],
	},
	{
		slug: "the-wedding-garment",
		title: "The Wedding Garment",
		tagline: "Bid them to the marriage, and clothe them for it",
		book: MATTHEW,
		chapter: 22,
		verses: [1, 14],
		reference: "Matthew 22:1-14",
		story: "The marriage of the king's son",
		command: "Clothe!",
		controls: [{ ...TAP, action: "Give a guest a wedding garment" }],
		tips: ["Guests come in from the highways", "Clothe each one before the door"],
		seconds: 15,
		minSeconds: 15,
		voice: { intro: 9, win: 10 },
		award: "The Wedding Was Furnished",
		grades: { gold: "Furnished with Guests", silver: "Bid to the Marriage", bronze: "Into the Highways" },
		measure: "guests clothed",
		emblem: "shirt",
		topics: ["chapter game", "invitation"],
	},
	{
		slug: "under-her-wings",
		title: "Under Her Wings",
		tagline: "Gather the chickens before the storm",
		book: MATTHEW,
		chapter: 23,
		verses: [37, 39],
		reference: "Matthew 23:37-39",
		story: "As a hen gathereth her chickens",
		command: "Gather!",
		controls: [{ keys: ["←", "→", "↑", "↓"], touch: "Drag", action: "Move the hen" }],
		tips: ["Run to each chick to gather it", "Bring them home under your wings"],
		seconds: 15,
		minSeconds: 5,
		voice: { intro: 37, win: 39 },
		award: "Under Her Wings",
		grades: { gold: "Blessed Is He That Cometh", silver: "Gathered Together", bronze: "How Often Would I" },
		measure: "chickens gathered",
		emblem: "egg",
		topics: ["chapter game", "love"],
	},
	{
		slug: "watch",
		title: "Watch!",
		tagline: "Ye know not what hour",
		book: MATTHEW,
		chapter: 24,
		verses: [42, 44],
		reference: "Matthew 24:42-44",
		story: "Be ye also ready",
		command: "Watch!",
		controls: [{ keys: ["Space"], touch: "Tap", action: "Tap the instant the lightning flashes" }],
		tips: ["Wait for the lightning", "Tap too soon and you miss it"],
		seconds: 14,
		minSeconds: 6,
		voice: { intro: 42, win: 44 },
		award: "Be Ye Also Ready",
		grades: { gold: "Be Ye Also Ready", silver: "As the Lightning", bronze: "Watch Therefore" },
		measure: "ready",
		emblem: "zap",
		topics: ["chapter game", "watchfulness"],
	},
	{
		slug: "sheep-and-goats",
		title: "The Sheep and the Goats",
		tagline: "Sheep on the right hand, goats on the left",
		book: MATTHEW,
		chapter: 25,
		verses: [31, 40],
		reference: "Matthew 25:31-40",
		story: "He shall separate them one from another",
		command: "Separate!",
		controls: [
			{ keys: ["←"], touch: "Swipe left", action: "Goats to the left" },
			{ keys: ["→"], touch: "Swipe right", action: "Sheep to the right" },
		],
		tips: ["Sheep on the right hand, goats on the left", "They come faster and faster"],
		seconds: 15,
		minSeconds: 15,
		voice: { intro: 32, win: 34 },
		award: "Come, Ye Blessed",
		grades: { gold: "Inherit the Kingdom", silver: "On His Right Hand", bronze: "As a Shepherd" },
		measure: "sorted right",
		emblem: "crown",
		topics: ["chapter game", "judgment"],
	},
	{
		slug: "watch-with-me",
		title: "Watch with Me",
		tagline: "Keep Peter, James and John awake",
		book: MATTHEW,
		chapter: 26,
		verses: [36, 41],
		reference: "Matthew 26:36-41",
		story: "Gethsemane",
		command: "Wake!",
		controls: [{ keys: ["1", "2", "3"], touch: "Tap", action: "Wake a disciple" }],
		tips: ["Their eyes grow heavy", "Wake each one before he is fast asleep"],
		seconds: 15,
		minSeconds: 15,
		voice: { intro: 38, win: 41 },
		award: "Watch and Pray",
		grades: { gold: "The Spirit Indeed Is Willing", silver: "Watch with Me", bronze: "Tarry Ye Here" },
		measure: "kept awake",
		emblem: "moon",
		topics: ["chapter game", "prayer"],
	},
	{
		slug: "the-veil-rent",
		title: "The Veil Was Rent",
		tagline: "From the top to the bottom",
		book: MATTHEW,
		chapter: 27,
		verses: [50, 54],
		reference: "Matthew 27:50-54",
		story: "The veil of the temple was rent in twain",
		command: "Trace!",
		controls: [{ keys: ["←", "→"], touch: "Drag", action: "Follow the line down" }],
		tips: ["Follow the line from the top to the bottom", "The earth quakes: hold steady"],
		seconds: 12,
		minSeconds: 4,
		voice: { intro: 51, win: 54 },
		award: "Truly This Was the Son of God",
		grades: { gold: "Truly the Son of God", silver: "Rent in Twain", bronze: "The Earth Did Quake" },
		measure: "line kept",
		emblem: "heart",
		topics: ["chapter game", "the cross"],
	},
	{
		slug: "he-is-risen",
		title: "He Is Risen",
		tagline: "Run and bring his disciples word",
		book: MATTHEW,
		chapter: 28,
		verses: [1, 10],
		reference: "Matthew 28:1-10",
		story: "He is not here: for he is risen",
		command: "Run!",
		controls: [{ keys: ["↑", "Space"], touch: "Tap", action: "Leap" }],
		tips: ["Run and tell his disciples", "Leap the stones on the way"],
		seconds: 15,
		minSeconds: 15,
		voice: { intro: 6, win: 8 },
		award: "He Is Risen",
		grades: { gold: "Fear and Great Joy", silver: "Go Quickly, and Tell", bronze: "Fear Not Ye" },
		measure: "joy",
		emblem: "sun",
		topics: ["chapter game", "resurrection"],
	},
];

export function findChapterGame(slug: string): ChapterGame | null {
	return CHAPTER_GAMES.find((game) => game.slug === slug) ?? null;
}

/** The chapter's game, or null when it has none. */
export function chapterGameFor(book: number, chapter: number): ChapterGame | null {
	return CHAPTER_GAMES.find((game) => game.book === book && game.chapter === chapter) ?? null;
}

/** Where a chapter's game is played: at the end of the chapter in the reader. */
export function gameChapterHref(game: Pick<ChapterGame, "book" | "chapter">): string {
	return `/bible/chapter?book=${game.book}&chapter=${game.chapter}`;
}

/** The round's score decides the grade. */
export function gradeFor(faithKept: number): GameGrade {
	return faithKept >= 70 ? "gold" : faithKept >= 40 ? "silver" : "bronze";
}

const GRADE_RANK: Record<GameGrade, number> = { gold: 3, silver: 2, bronze: 1 };

export function betterGrade(a: GameGrade, b: GameGrade): GameGrade {
	return GRADE_RANK[a] >= GRADE_RANK[b] ? a : b;
}

/** A won round as the client reports it: the 0-100 score, the seconds played and the game's count. */
export interface GameRun {
	faithKept: number;
	seconds: number;
	swellsCleared: number;
}

/**
 * Checks a reported run. `minSeconds` is the soonest the game can be won
 * flat out, so a faster time was not played.
 */
export function checkGameRun(input: unknown, minSeconds: number): { ok: true; value: GameRun } | { ok: false; error: string } {
	if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "expected a run" };
	const { faithKept, seconds, swellsCleared } = input as Record<string, unknown>;
	if (typeof faithKept !== "number" || !Number.isInteger(faithKept) || faithKept < 0 || faithKept > 100) {
		return { ok: false, error: "faithKept must be a whole number from 0 to 100" };
	}
	if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < minSeconds || seconds > 3600) {
		return { ok: false, error: `seconds must be between ${minSeconds} and 3600` };
	}
	if (typeof swellsCleared !== "number" || !Number.isInteger(swellsCleared) || swellsCleared < 0 || swellsCleared > 500) {
		return { ok: false, error: "swellsCleared must be a whole number from 0 to 500" };
	}
	return { ok: true, value: { faithKept, seconds: Math.round(seconds * 10) / 10, swellsCleared } };
}

/** The award as it is kept in the study store's `data`. */
export interface GameAward {
	game: string;
	grade: GameGrade;
	bestFaith: number;
	bestSeconds: number;
	completions: number;
	firstAt: string;
	lastAt: string;
}

/** Reads a stored award back, or null when `data` is not one for `game`. */
export function readGameAward(data: unknown, game: string): GameAward | null {
	if (!data || typeof data !== "object" || Array.isArray(data)) return null;
	const award = data as Record<string, unknown>;
	if (award.game !== game) return null;
	if (award.grade !== "gold" && award.grade !== "silver" && award.grade !== "bronze") return null;
	const numbers = [award.bestFaith, award.bestSeconds, award.completions];
	if (!numbers.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
	if (typeof award.firstAt !== "string" || typeof award.lastAt !== "string") return null;
	return {
		game,
		grade: award.grade,
		bestFaith: award.bestFaith as number,
		bestSeconds: award.bestSeconds as number,
		completions: award.completions as number,
		firstAt: award.firstAt,
		lastAt: award.lastAt,
	};
}

/** Folds a won run into the award: the best grade, score and time stand, completions count up. */
export function mergeGameAward(previous: GameAward | null, game: string, run: GameRun, at: string): GameAward {
	const grade = gradeFor(run.faithKept);
	if (!previous) {
		return { game, grade, bestFaith: run.faithKept, bestSeconds: run.seconds, completions: 1, firstAt: at, lastAt: at };
	}
	return {
		game,
		grade: betterGrade(previous.grade, grade),
		bestFaith: Math.max(previous.bestFaith, run.faithKept),
		bestSeconds: Math.min(previous.bestSeconds, run.seconds),
		completions: previous.completions + 1,
		firstAt: previous.firstAt,
		lastAt: at,
	};
}
