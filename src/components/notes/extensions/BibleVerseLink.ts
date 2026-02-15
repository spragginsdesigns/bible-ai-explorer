import { Mark, mergeAttributes } from "@tiptap/react";

// Matches patterns like "John 3:16", "1 Corinthians 13:4-7", "Genesis 1:1"
const VERSE_REGEX =
	/(?:(?:[1-3]\s)?(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation))\s+\d+:\d+(?:-\d+)?/gi;

export const BibleVerseLink = Mark.create({
	name: "bibleVerseLink",

	addOptions() {
		return {
			HTMLAttributes: {
				class: "bible-verse-link",
			},
		};
	},

	parseHTML() {
		return [
			{
				tag: "span.bible-verse-link",
			},
		];
	},

	renderHTML({ HTMLAttributes }) {
		return [
			"span",
			mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
			0,
		];
	},
});

export { VERSE_REGEX };
