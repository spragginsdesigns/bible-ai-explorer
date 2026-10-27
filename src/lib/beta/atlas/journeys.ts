/**
 * The journeys SureWord Beta's Atlas & Timeline plays stop by stop
 * (LC-17655, docs/beta/atlas.md).
 *
 * Every stop names a place (a corpus id from `src/data/bible-atlas/places.json`
 * or a waypoint in `places.ts`), the verses that put the journey there, and a
 * short note that says only what those verses say. `tests/beta-atlas.test.mjs`
 * holds them to the corpus rules: every reference resolves in the bundled KJV,
 * and at least one of a stop's verses names its place (by its name, an alias,
 * or `as`, the word the verse itself uses). `event` links a stop to the corpus
 * event that happened there; `by: "sea"` marks a leg Scripture says was
 * sailed, which the map draws dashed.
 *
 * The dates come from the corpus events in `when`, so a journey is dated
 * exactly as the timeline dates it.
 *
 * No imports on purpose: the tests load this file with Node's type stripping.
 */

export interface BetaJourneyStop {
	place: string;
	refs: readonly string[];
	note: string;
	/** How the journey reached this stop, when Scripture says it sailed. */
	by?: "sea";
	/** The corpus event that happened at this stop. */
	event?: string;
	/** The name the verses use here when it is not the place's own name or alias. */
	as?: string;
}

export interface BetaJourney {
	id: string;
	title: string;
	/** A short label for chips. */
	short: string;
	/** Corpus people ids. */
	people: readonly string[];
	/** Corpus event ids whose dates bound the journey. */
	when: { from: string; to: string };
	summary: string;
	stops: readonly BetaJourneyStop[];
}

export const BETA_JOURNEYS: readonly BetaJourney[] = [
	{
		id: "abraham",
		title: "Abraham's travels",
		short: "Abraham",
		people: ["abraham", "sarah", "lot"],
		when: { from: "call-of-abram", to: "sarah-buried-at-hebron" },
		summary:
			"From Ur of the Chaldees to Haran, through the land the LORD promised him, down into Egypt and back, to Mamre, Gerar, Beersheba and mount Moriah.",
		stops: [
			{ place: "ur", refs: ["Genesis 11:31", "Genesis 15:7"], event: "call-of-abram", note: "Terah took Abram, Lot and Sarai, and they went forth from Ur of the Chaldees to go into the land of Canaan. The LORD later told Abram, I am the LORD that brought thee out of Ur of the Chaldees." },
			{ place: "haran", refs: ["Genesis 11:31", "Genesis 11:32", "Genesis 12:4"], note: "They came unto Haran and dwelt there, and Terah died in Haran. Abram departed out of Haran at the LORD's word, when he was seventy and five years old." },
			{ place: "shechem", refs: ["Genesis 12:6", "Genesis 12:7"], event: "call-of-abram", note: "Abram passed through the land unto the place of Sichem. There the LORD appeared unto him and said, Unto thy seed will I give this land, and he builded an altar." },
			{ place: "bethel", refs: ["Genesis 12:8"], note: "He removed unto a mountain on the east of Bethel, with Hai on the east, and there he builded an altar and called upon the name of the LORD." },
			{ place: "egypt", refs: ["Genesis 12:10", "Genesis 12:20"], note: "There was a famine in the land, and Abram went down into Egypt to sojourn there. Pharaoh afterward sent him away, and his wife, and all that he had." },
			{ place: "bethel", refs: ["Genesis 13:3", "Genesis 13:4"], event: "abram-and-lot-part", note: "He went on his journeys from the south even to Bethel, unto the place of the altar which he had made there at the first, and called on the name of the LORD." },
			{ place: "hebron", refs: ["Genesis 13:11", "Genesis 13:18"], event: "abram-and-lot-part", note: "After Lot chose him all the plain of Jordan, Abram removed his tent and dwelt in the plain of Mamre, which is in Hebron, and built there an altar unto the LORD." },
			{ place: "dan", refs: ["Genesis 14:14"], note: "When Abram heard that Lot was taken captive, he armed his trained servants, three hundred and eighteen, and pursued them unto Dan." },
			{ place: "damascus", refs: ["Genesis 14:15", "Genesis 14:16"], note: "He smote them and pursued them unto Hobah, which is on the left hand of Damascus, and brought back Lot and all the goods." },
			{ place: "jerusalem", refs: ["Genesis 14:18", "Genesis 14:19", "Psalms 76:2"], event: "melchizedek-blesses-abram", note: "Melchizedek king of Salem, the priest of the most high God, brought forth bread and wine and blessed Abram. The psalm sets Salem beside Zion: In Salem also is his tabernacle." },
			{ place: "hebron", refs: ["Genesis 18:1", "Genesis 18:10"], note: "The LORD appeared unto him in the plains of Mamre as he sat in the tent door, and promised that Sarah his wife should have a son." },
			{ place: "gerar", refs: ["Genesis 20:1"], note: "Abraham journeyed toward the south country, dwelled between Kadesh and Shur, and sojourned in Gerar." },
			{ place: "beersheba", refs: ["Genesis 21:31", "Genesis 21:33"], note: "He called the place Beersheba, because there they sware both of them, and he planted a grove there and called on the name of the LORD, the everlasting God." },
			{ place: "moriah", refs: ["Genesis 22:2", "Genesis 22:14"], event: "offering-of-isaac", note: "God bade him take Isaac into the land of Moriah and offer him there. Abraham called the name of that place Jehovahjireh: In the mount of the LORD it shall be seen." },
			{ place: "beersheba", refs: ["Genesis 22:19"], note: "So Abraham returned unto his young men, and they rose up and went together to Beersheba; and Abraham dwelt at Beersheba." },
			{ place: "hebron", refs: ["Genesis 23:2", "Genesis 23:19", "Genesis 25:9"], event: "sarah-buried-at-hebron", note: "Sarah died in Kirjatharba; the same is Hebron. Abraham buried her in the cave of the field of Machpelah before Mamre, and there Isaac and Ishmael buried him." },
		],
	},
	{
		id: "exodus",
		title: "The Exodus",
		short: "Exodus",
		people: ["moses", "aaron", "joshua"],
		when: { from: "the-exodus", to: "fall-of-jericho" },
		summary:
			"Out of Egypt on the morrow after the passover, through the Red sea to Sinai, forty years in the wilderness, and over Jordan to Jericho. Many wilderness camps cannot be placed with certainty: this follows the traditional route, and each stop says how sure its spot is.",
		stops: [
			{ place: "rameses", refs: ["Exodus 12:37", "Numbers 33:3"], event: "the-exodus", note: "They departed from Rameses on the fifteenth day of the first month. On the morrow after the passover the children of Israel went out with an high hand in the sight of all the Egyptians." },
			{ place: "succoth-of-egypt", refs: ["Exodus 12:37", "Exodus 12:38"], note: "The children of Israel journeyed from Rameses to Succoth, about six hundred thousand on foot that were men, beside children, and a mixed multitude went up also with them." },
			{ place: "etham", refs: ["Exodus 13:20", "Exodus 13:21"], note: "They encamped in Etham, in the edge of the wilderness, and the LORD went before them by day in a pillar of a cloud, and by night in a pillar of fire." },
			{ place: "pihahiroth", refs: ["Exodus 14:2", "Exodus 14:9"], note: "The LORD bade them turn and encamp before Pi-hahiroth, between Migdol and the sea. There the horses and chariots of Pharaoh overtook them." },
			{ place: "red-sea", refs: ["Exodus 14:21", "Exodus 14:22", "Exodus 15:4"], event: "crossing-the-red-sea", note: "Moses stretched out his hand over the sea, and the LORD caused the sea to go back by a strong east wind. The children of Israel went into the midst of the sea upon the dry ground." },
			{ place: "marah", refs: ["Exodus 15:23", "Exodus 15:25"], event: "bitter-waters-made-sweet", note: "They could not drink of the waters of Marah, for they were bitter. The LORD shewed Moses a tree, which when he had cast into the waters, the waters were made sweet." },
			{ place: "elim", refs: ["Exodus 15:27"], event: "bitter-waters-made-sweet", note: "At Elim were twelve wells of water and threescore and ten palm trees, and they encamped there by the waters." },
			{ place: "wilderness-of-sin", refs: ["Exodus 16:1", "Exodus 16:4"], event: "manna-and-quails", note: "The whole congregation came unto the wilderness of Sin and murmured. The LORD said, Behold, I will rain bread from heaven for you." },
			{ place: "rephidim", refs: ["Exodus 17:1", "Exodus 17:6", "Exodus 17:8"], event: "water-from-the-rock", note: "There was no water for the people to drink. The LORD gave water out of the rock in Horeb, and Amalek came and fought with Israel in Rephidim." },
			{ place: "mount-sinai", refs: ["Exodus 19:1", "Exodus 19:20", "Exodus 20:1"], event: "the-law-at-sinai", note: "In the third month Israel came into the wilderness of Sinai and camped before the mount. The LORD came down upon mount Sinai and spake all these words." },
			{ place: "kadeshbarnea", refs: ["Numbers 13:26", "Numbers 14:33"], event: "the-twelve-spies", note: "The spies came back to the congregation at Kadesh in the wilderness of Paran. Because the people would not go up, their children should wander in the wilderness forty years." },
			{ place: "eziongaber", refs: ["Numbers 33:35", "Numbers 33:36"], event: "forty-years-in-the-wilderness", note: "In their wanderings they encamped at Eziongaber, and removed from there and pitched in the wilderness of Zin, which is Kadesh." },
			{ place: "mount-hor", refs: ["Numbers 20:22", "Numbers 20:28"], note: "The whole congregation came unto mount Hor. Moses stripped Aaron of his garments and put them upon Eleazar his son, and Aaron died there in the top of the mount." },
			{ place: "moab", refs: ["Numbers 22:1", "Numbers 33:48"], event: "balaam-and-balak", note: "The children of Israel set forward and pitched in the plains of Moab on this side Jordan by Jericho." },
			{ place: "mount-nebo", refs: ["Deuteronomy 34:1", "Deuteronomy 34:5"], event: "moses-dies-on-nebo", note: "Moses went up from the plains of Moab unto the mountain of Nebo, and the LORD shewed him all the land. So Moses the servant of the LORD died there in the land of Moab." },
			{ place: "gilgal", refs: ["Joshua 3:17", "Joshua 4:19"], event: "crossing-the-jordan", note: "The priests that bare the ark stood firm on dry ground in the midst of Jordan until all the people were passed clean over, and they encamped in Gilgal." },
			{ place: "jericho", refs: ["Joshua 6:2", "Joshua 6:20"], event: "fall-of-jericho", note: "The LORD said, I have given into thine hand Jericho. The people shouted with a great shout, and the wall fell down flat." },
		],
	},
	{
		id: "gospels",
		title: "The Gospels' ministry",
		short: "Gospels",
		people: ["jesus-christ"],
		when: { from: "the-birth-of-christ", to: "the-ascension" },
		summary:
			"From Bethlehem to the mount of Olives: the places of the Lord's birth, ministry, death, resurrection and ascension, in the order the timeline gives them. The Gospels do not give one itinerary, so this is a harmony, not a route.",
		stops: [
			{ place: "bethlehem", refs: ["Luke 2:4", "Luke 2:7", "Matthew 2:1"], event: "the-birth-of-christ", note: "Joseph went up from Galilee unto the city of David, which is called Bethlehem, and Mary brought forth her firstborn son and laid him in a manger." },
			{ place: "egypt", refs: ["Matthew 2:13", "Matthew 2:14", "Matthew 2:15"], event: "wise-men-and-flight-into-egypt", note: "The angel of the Lord warned Joseph to flee into Egypt from Herod. He was there until the death of Herod, that it might be fulfilled, Out of Egypt have I called my son." },
			{ place: "nazareth", refs: ["Matthew 2:23", "Luke 2:39", "Luke 2:40"], note: "They returned into Galilee, to their own city Nazareth, and the child grew, and waxed strong in spirit, filled with wisdom." },
			{ place: "jerusalem", refs: ["Luke 2:42", "Luke 2:46", "Luke 2:49"], event: "jesus-at-twelve", note: "When he was twelve years old they went up to Jerusalem after the custom of the feast, and found him in the temple, sitting in the midst of the doctors: I must be about my Father's business." },
			{ place: "bethabara", refs: ["Matthew 3:13", "John 1:28", "Matthew 3:16"], event: "the-baptism-of-jesus", note: "Jesus came from Galilee to Jordan unto John to be baptized of him, and the Spirit of God descended like a dove upon him." },
			{ place: "cana", refs: ["John 2:1", "John 2:11"], event: "water-turned-to-wine", note: "At a marriage in Cana of Galilee he turned the water into wine. This beginning of miracles did Jesus, and manifested forth his glory." },
			{ place: "sychar", refs: ["John 4:5", "John 4:6", "John 4:14"], event: "the-woman-at-the-well", note: "He came to a city of Samaria called Sychar, where Jacob's well was, and told the woman of the water that springs up into everlasting life." },
			{ place: "capernaum", refs: ["Matthew 4:13", "Matthew 4:17"], note: "Leaving Nazareth, he came and dwelt in Capernaum, upon the sea coast. From that time Jesus began to preach, Repent: for the kingdom of heaven is at hand." },
			{ place: "sea-of-galilee", refs: ["Matthew 4:18", "Matthew 4:19", "Matthew 8:26"], event: "calling-of-the-first-disciples", note: "Walking by the sea of Galilee he called Peter and Andrew: Follow me, and I will make you fishers of men. On the same sea he rebuked the winds, and there was a great calm." },
			{ place: "nain", refs: ["Luke 7:11", "Luke 7:14", "Luke 7:15"], note: "Near the gate of the city a dead man was carried out, the only son of his mother. The Lord touched the bier and said, Young man, Arise, and delivered him to his mother." },
			{ place: "gadarenes", refs: ["Mark 5:1", "Mark 5:13", "Mark 5:19"], by: "sea", note: "Over the sea he cast the unclean spirits out of a man among the tombs, and sent him home to tell how great things the Lord had done for him." },
			{ place: "bethsaida", refs: ["Luke 9:10", "Luke 9:16", "Luke 9:17"], by: "sea", event: "feeding-the-five-thousand", note: "He went aside into a desert place belonging to Bethsaida, blessed the five loaves and two fishes, and they did all eat, and were filled." },
			{ place: "tyre", refs: ["Matthew 15:21", "Matthew 15:28"], note: "He departed into the coasts of Tyre and Sidon and healed the daughter of a woman of Canaan: O woman, great is thy faith." },
			{ place: "caesarea-philippi", refs: ["Matthew 16:13", "Matthew 16:16", "Matthew 16:18"], event: "peters-confession", note: "In the coasts of Caesarea Philippi he asked, Whom say ye that I am? Peter answered, Thou art the Christ, the Son of the living God." },
			{ place: "bethany", refs: ["John 11:1", "John 11:43", "John 11:44"], event: "lazarus-raised", note: "At Bethany, the town of Mary and her sister Martha, he cried with a loud voice, Lazarus, come forth, and he that was dead came forth." },
			{ place: "jericho", refs: ["Luke 19:1", "Luke 19:5", "Luke 19:10"], event: "zacchaeus-in-the-sycomore", note: "Passing through Jericho he called Zacchaeus down from the sycomore tree: the Son of man is come to seek and to save that which was lost." },
			{ place: "mount-of-olives", refs: ["Matthew 21:1", "Matthew 21:9"], event: "the-triumphal-entry", note: "Drawing nigh unto Jerusalem, at the mount of Olives, he sent for the ass and the colt, and the multitudes cried, Hosanna to the Son of David." },
			{ place: "jerusalem", refs: ["Matthew 21:10", "Matthew 26:26"], event: "the-last-supper", note: "All the city was moved, saying, Who is this? There he ate the passover with his disciples, and took bread, and blessed it, and brake it." },
			{ place: "gethsemane", refs: ["Matthew 26:36", "Matthew 26:39", "Matthew 26:47"], event: "gethsemane-and-the-betrayal", note: "He came with them unto a place called Gethsemane and prayed, Not as I will, but as thou wilt. There Judas came with a great multitude." },
			{ place: "golgotha", refs: ["John 19:17", "John 19:18", "John 19:30"], event: "the-crucifixion", note: "He went forth bearing his cross into the place of a skull, which is called in the Hebrew Golgotha, where they crucified him. He said, It is finished." },
			{ place: "emmaus", refs: ["Luke 24:13", "Luke 24:31"], event: "the-road-to-emmaus", note: "On the first day of the week two disciples walked to Emmaus. The risen Lord drew near and went with them, and they knew him in the breaking of bread." },
			{ place: "sea-of-galilee", refs: ["John 21:1", "Matthew 28:16", "Matthew 28:19"], event: "the-great-commission", note: "He shewed himself again to the disciples at the sea of Tiberias, and in Galilee he sent them: Go ye therefore, and teach all nations." },
			{ place: "mount-of-olives", refs: ["Luke 24:50", "Acts 1:9", "Acts 1:12"], event: "the-ascension", note: "He led them out as far as to Bethany and was taken up, and they returned unto Jerusalem from the mount called Olivet." },
		],
	},
	{
		id: "paul-1",
		title: "Paul's first journey",
		short: "Paul I",
		people: ["paul", "barnabas"],
		when: { from: "first-missionary-journey", to: "first-missionary-journey" },
		summary:
			"Sent out from Antioch by the Holy Ghost with Barnabas: Cyprus, Pamphylia, Pisidia and Lycaonia, and home again to tell how God had opened the door of faith unto the Gentiles.",
		stops: [
			{ place: "antioch", refs: ["Acts 13:1", "Acts 13:2", "Acts 13:3"], event: "first-missionary-journey", note: "As the church at Antioch ministered to the Lord and fasted, the Holy Ghost said, Separate me Barnabas and Saul for the work whereunto I have called them." },
			{ place: "seleucia", refs: ["Acts 13:4"], note: "Sent forth by the Holy Ghost, they departed unto Seleucia, and from thence they sailed to Cyprus." },
			{ place: "salamis", refs: ["Acts 13:5"], by: "sea", note: "At Salamis they preached the word of God in the synagogues of the Jews, and they had also John to their minister." },
			{ place: "paphos", refs: ["Acts 13:6", "Acts 13:9", "Acts 13:12"], note: "They went through the isle unto Paphos. Saul, who also is called Paul, set his eyes on Elymas the sorcerer, and the deputy believed." },
			{ place: "perga", refs: ["Acts 13:13"], by: "sea", note: "Loosing from Paphos they came to Perga in Pamphylia, and John departing from them returned to Jerusalem." },
			{ place: "antioch-in-pisidia", refs: ["Acts 13:14", "Acts 13:38", "Acts 13:46"], note: "In the synagogue on the sabbath Paul preached forgiveness of sins through this man. When the Jews contradicted, they said, Lo, we turn to the Gentiles." },
			{ place: "iconium", refs: ["Acts 13:51", "Acts 14:1", "Acts 14:5"], note: "They so spake that a great multitude both of the Jews and also of the Greeks believed, until an assault was made to stone them." },
			{ place: "lystra", refs: ["Acts 14:6", "Acts 14:8", "Acts 14:19"], event: "paul-stoned-at-lystra", note: "A man impotent in his feet was healed, and the people would have done sacrifice to them. Afterward Jews from Antioch and Iconium persuaded them, and they stoned Paul." },
			{ place: "derbe", refs: ["Acts 14:20", "Acts 14:21"], note: "The next day he departed with Barnabas to Derbe, and they preached the gospel to that city and taught many." },
			{ place: "lystra", refs: ["Acts 14:21", "Acts 14:22"], note: "They returned again to Lystra, confirming the souls of the disciples: we must through much tribulation enter into the kingdom of God." },
			{ place: "iconium", refs: ["Acts 14:21", "Acts 14:23"], note: "And to Iconium, ordaining elders in every church and praying with fasting." },
			{ place: "antioch-in-pisidia", refs: ["Acts 14:21", "Acts 14:24"], as: "Antioch", note: "And to Antioch in Pisidia, commending them to the Lord, on whom they believed." },
			{ place: "perga", refs: ["Acts 14:24", "Acts 14:25"], note: "Passing throughout Pisidia they came to Pamphylia, and preached the word in Perga." },
			{ place: "attalia", refs: ["Acts 14:25"], note: "Then they went down into Attalia." },
			{ place: "antioch", refs: ["Acts 14:26", "Acts 14:27"], by: "sea", note: "They sailed to Antioch, gathered the church together, and rehearsed all that God had done with them, and how he had opened the door of faith unto the Gentiles." },
		],
	},
	{
		id: "paul-2",
		title: "Paul's second journey",
		short: "Paul II",
		people: ["paul", "silas", "timothy"],
		when: { from: "the-man-of-macedonia", to: "eighteen-months-at-corinth" },
		summary:
			"With Silas, through the churches of the first journey, then over into Europe at the call of the man of Macedonia: Philippi, Thessalonica, Berea, Athens and a year and six months at Corinth.",
		stops: [
			{ place: "antioch", refs: ["Acts 15:35", "Acts 15:36", "Acts 15:40"], note: "Paul said to Barnabas, Let us go again and visit our brethren in every city. After their contention Paul chose Silas and departed, recommended unto the grace of God." },
			{ place: "derbe", refs: ["Acts 15:41", "Acts 16:1"], note: "He went through Syria and Cilicia, confirming the churches, and came to Derbe and Lystra." },
			{ place: "lystra", refs: ["Acts 16:1", "Acts 16:2", "Acts 16:3"], note: "A certain disciple was there, named Timotheus, well reported of by the brethren; him would Paul have to go forth with him." },
			{ place: "phrygia", refs: ["Acts 16:5", "Acts 16:6"], note: "The churches were established in the faith. They went throughout Phrygia and the region of Galatia, and were forbidden of the Holy Ghost to preach the word in Asia." },
			{ place: "mysia", refs: ["Acts 16:7", "Acts 16:8"], note: "After they were come to Mysia they assayed to go into Bithynia, but the Spirit suffered them not, and passing by Mysia they came down to Troas." },
			{ place: "troas", refs: ["Acts 16:8", "Acts 16:9", "Acts 16:10"], event: "the-man-of-macedonia", note: "A vision appeared to Paul in the night: a man of Macedonia prayed him, saying, Come over into Macedonia, and help us." },
			{ place: "samothracia", refs: ["Acts 16:11"], by: "sea", note: "Loosing from Troas, we came with a straight course to Samothracia." },
			{ place: "neapolis", refs: ["Acts 16:11"], by: "sea", note: "And the next day to Neapolis." },
			{ place: "philippi", refs: ["Acts 16:12", "Acts 16:14", "Acts 16:31"], event: "lydia-and-the-philippian-jailor", note: "At Philippi the Lord opened the heart of Lydia. In prison at midnight Paul and Silas prayed and sang praises, and they told the jailor, Believe on the Lord Jesus Christ, and thou shalt be saved." },
			{ place: "amphipolis", refs: ["Acts 17:1"], note: "They passed through Amphipolis..." },
			{ place: "apollonia", refs: ["Acts 17:1"], note: "...and Apollonia, and came to Thessalonica." },
			{ place: "thessalonica", refs: ["Acts 17:1", "Acts 17:2", "Acts 17:4"], event: "thessalonica-and-berea", note: "Three sabbath days Paul reasoned with them out of the scriptures, that Christ must needs have suffered and risen again, and some believed and consorted with Paul and Silas." },
			{ place: "berea", refs: ["Acts 17:10", "Acts 17:11"], event: "thessalonica-and-berea", note: "The brethren sent them away by night unto Berea, whose people received the word with all readiness of mind, and searched the scriptures daily." },
			{ place: "athens", refs: ["Acts 17:15", "Acts 17:22", "Acts 17:23"], event: "paul-on-mars-hill", note: "Paul stood in the midst of Mars' hill and declared to them the God they ignorantly worshipped, the God that made the world and all things therein." },
			{ place: "corinth", refs: ["Acts 18:1", "Acts 18:9", "Acts 18:11"], event: "eighteen-months-at-corinth", note: "The Lord spake to Paul in the night by a vision, Be not afraid, but speak, and he continued there a year and six months, teaching the word of God among them." },
			{ place: "cenchrea", refs: ["Acts 18:18"], note: "Having shorn his head in Cenchrea, for he had a vow, he sailed thence into Syria, and with him Priscilla and Aquila." },
			{ place: "ephesus", refs: ["Acts 18:19", "Acts 18:21"], by: "sea", note: "He came to Ephesus and reasoned with the Jews in the synagogue, but bade them farewell, saying, I will return again unto you, if God will." },
			{ place: "caesarea", refs: ["Acts 18:22"], by: "sea", note: "When he had landed at Caesarea, and gone up, and saluted the church..." },
			{ place: "antioch", refs: ["Acts 18:22"], note: "...he went down to Antioch." },
		],
	},
	{
		id: "paul-3",
		title: "Paul's third journey",
		short: "Paul III",
		people: ["paul", "luke"],
		when: { from: "two-years-at-ephesus", to: "paul-arrested-in-jerusalem" },
		summary:
			"Through Galatia and Phrygia to two years at Ephesus, over Macedonia and Greece, then by ship down the coast of Asia, with the farewell at Miletus, to Jerusalem.",
		stops: [
			{ place: "antioch", refs: ["Acts 18:22", "Acts 18:23"], note: "After he had spent some time at Antioch, he departed." },
			{ place: "galatia", refs: ["Acts 18:23"], note: "He went over all the country of Galatia and Phrygia in order, strengthening all the disciples." },
			{ place: "ephesus", refs: ["Acts 19:1", "Acts 19:10", "Acts 19:20"], event: "two-years-at-ephesus", note: "For two years he disputed daily in the school of Tyrannus, so that all they which dwelt in Asia heard the word of the Lord Jesus. So mightily grew the word of God and prevailed." },
			{ place: "macedonia", refs: ["Acts 20:1"], note: "After the uproar was ceased, Paul called unto him the disciples, embraced them, and departed for to go into Macedonia." },
			{ place: "greece", refs: ["Acts 20:2", "Acts 20:3"], note: "When he had gone over those parts and given them much exhortation, he came into Greece and there abode three months." },
			{ place: "philippi", refs: ["Acts 20:6"], note: "We sailed away from Philippi after the days of unleavened bread." },
			{ place: "troas", refs: ["Acts 20:6", "Acts 20:7", "Acts 20:12"], by: "sea", event: "eutychus-raised", note: "In five days they came to Troas. On the first day of the week the disciples came together to break bread, and the young man Eutychus was brought alive." },
			{ place: "assos", refs: ["Acts 20:13", "Acts 20:14"], note: "Paul, minding himself to go afoot, met them at Assos, and they took him in." },
			{ place: "mitylene", refs: ["Acts 20:14"], by: "sea", note: "They came to Mitylene." },
			{ place: "chios", refs: ["Acts 20:15"], by: "sea", note: "They sailed thence, and came the next day over against Chios." },
			{ place: "samos", refs: ["Acts 20:15"], by: "sea", note: "The next day they arrived at Samos." },
			{ place: "trogyllium", refs: ["Acts 20:15"], by: "sea", note: "And tarried at Trogyllium." },
			{ place: "miletus", refs: ["Acts 20:15", "Acts 20:17", "Acts 20:36"], by: "sea", note: "From Miletus he sent to Ephesus for the elders of the church, commended them to God, and kneeled down and prayed with them all." },
			{ place: "coos", refs: ["Acts 21:1"], by: "sea", note: "They came with a straight course unto Coos..." },
			{ place: "rhodes", refs: ["Acts 21:1"], by: "sea", note: "...and the day following unto Rhodes..." },
			{ place: "patara", refs: ["Acts 21:1", "Acts 21:2"], by: "sea", note: "...and from thence unto Patara, where they found a ship sailing over unto Phenicia." },
			{ place: "tyre", refs: ["Acts 21:3", "Acts 21:4", "Acts 21:5"], by: "sea", note: "Leaving Cyprus on the left hand they landed at Tyre. The disciples said to Paul through the Spirit that he should not go up to Jerusalem, and they kneeled down on the shore, and prayed." },
			{ place: "ptolemais", refs: ["Acts 21:7"], by: "sea", note: "They finished their course from Tyre and came to Ptolemais, saluted the brethren, and abode with them one day." },
			{ place: "caesarea", refs: ["Acts 21:8", "Acts 21:11", "Acts 21:13"], note: "In the house of Philip the evangelist, Agabus bound his own hands and feet with Paul's girdle. Paul answered, I am ready not to be bound only, but also to die at Jerusalem for the name of the Lord Jesus." },
			{ place: "jerusalem", refs: ["Acts 21:15", "Acts 21:17"], event: "paul-arrested-in-jerusalem", note: "They took up their carriages and went up to Jerusalem, and the brethren received them gladly." },
		],
	},
	{
		id: "rome",
		title: "The voyage to Rome",
		short: "To Rome",
		people: ["paul", "luke"],
		when: { from: "shipwreck-on-melita", to: "paul-preaching-at-rome" },
		summary:
			"A prisoner who had appealed unto Caesar, Paul sails from Caesarea through the tempest Euroclydon, is shipwrecked on Melita, and comes at last to Rome, preaching the kingdom of God.",
		stops: [
			{ place: "caesarea", refs: ["Acts 25:6", "Acts 25:11", "Acts 27:1"], event: "paul-before-felix-festus-agrippa", note: "Kept at Caesarea, Paul appealed unto Caesar. When it was determined that they should sail into Italy, he was delivered unto Julius, a centurion of Augustus' band." },
			{ place: "sidon", refs: ["Acts 27:3"], by: "sea", note: "The next day they touched at Sidon, and Julius courteously entreated Paul, and gave him liberty to go unto his friends to refresh himself." },
			{ place: "myra", refs: ["Acts 27:4", "Acts 27:5", "Acts 27:6"], by: "sea", note: "They sailed under Cyprus because the winds were contrary, and came to Myra, a city of Lycia, where the centurion found a ship of Alexandria sailing into Italy." },
			{ place: "cnidus", refs: ["Acts 27:7"], by: "sea", note: "They sailed slowly many days, and scarce were come over against Cnidus, the wind not suffering them." },
			{ place: "salmone", refs: ["Acts 27:7"], by: "sea", note: "They sailed under Crete, over against Salmone." },
			{ place: "fair-havens", refs: ["Acts 27:8", "Acts 27:10"], by: "sea", note: "Paul admonished them, Sirs, I perceive that this voyage will be with hurt and much damage, not only of the lading and ship, but also of our lives." },
			{ place: "clauda", refs: ["Acts 27:14", "Acts 27:16", "Acts 27:20"], by: "sea", note: "There arose against it a tempestuous wind, called Euroclydon. Running under Clauda they undergirded the ship, and all hope that they should be saved was then taken away." },
			{ place: "melita", refs: ["Acts 27:24", "Acts 27:44", "Acts 28:1", "Acts 28:5"], by: "sea", event: "shipwreck-on-melita", note: "The angel of God stood by Paul: Fear not. So it came to pass that they escaped all safe to land, on the island called Melita, where Paul shook the viper off into the fire and felt no harm." },
			{ place: "syracuse", refs: ["Acts 28:11", "Acts 28:12"], by: "sea", note: "After three months they departed in a ship of Alexandria, which had wintered in the isle, and landing at Syracuse they tarried there three days." },
			{ place: "rhegium", refs: ["Acts 28:13"], by: "sea", note: "From thence they fetched a compass and came to Rhegium." },
			{ place: "puteoli", refs: ["Acts 28:13", "Acts 28:14"], by: "sea", note: "At Puteoli they found brethren and were desired to tarry with them seven days, and so they went toward Rome." },
			{ place: "appii-forum", refs: ["Acts 28:15"], note: "The brethren from Rome, when they heard of them, came to meet them as far as Appii forum..." },
			{ place: "three-taverns", refs: ["Acts 28:15"], note: "...and The three taverns: whom when Paul saw, he thanked God, and took courage." },
			{ place: "rome", refs: ["Acts 28:16", "Acts 28:30", "Acts 28:31"], event: "paul-preaching-at-rome", note: "At Rome Paul was suffered to dwell by himself with a soldier that kept him, and for two whole years he received all that came in unto him, preaching the kingdom of God." },
		],
	},
];
