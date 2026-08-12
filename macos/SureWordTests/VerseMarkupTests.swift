import Foundation
import Testing
@testable import SureWord

/// Port of `mobile/src/features/bible/verseMarkup.test.ts`.
@Suite("Verse markup")
struct VerseMarkupTests {
    @Test("turns the NKJV supplied-word tag into an italic segment")
    func suppliedWords() {
        #expect(
            VerseMarkup.segments("Blessed <i>be</i> the God and Father") == [
                BibleVerseSegment(text: "Blessed ", italic: false),
                BibleVerseSegment(text: "be", italic: true),
                BibleVerseSegment(text: " the God and Father", italic: false),
            ]
        )
    }

    @Test("supports equivalent emphasis tags and nested emphasis")
    func nestedEmphasis() {
        #expect(
            VerseMarkup.segments("He <em>really <i>is</i></em> risen") == [
                BibleVerseSegment(text: "He ", italic: false),
                BibleVerseSegment(text: "really is", italic: true),
                BibleVerseSegment(text: " risen", italic: false),
            ]
        )
    }

    @Test("keeps emphasis tags that carry attributes")
    func taggedAttributes() {
        #expect(
            VerseMarkup.segments("Now <i class=\"add\">is</i> he risen") == [
                BibleVerseSegment(text: "Now ", italic: false),
                BibleVerseSegment(text: "is", italic: true),
                BibleVerseSegment(text: " he risen", italic: false),
            ]
        )
    }

    @Test("removes unsupported provider tags and decodes common entities")
    func stripsAndDecodes() {
        #expect(VerseMarkup.plainText("A <span>B &amp; C</span> &#39;D&#39;") == "A B & C 'D'")
        #expect(VerseMarkup.plainText("&lt;i&gt; &quot;x&quot; &#x27;y&#x27;") == "<i> \"x\" 'y'")
    }

    @Test("leaves anything that is not an entity alone")
    func leavesPlainAmpersands() {
        #expect(VerseMarkup.plainText("Ahaz & Hezekiah &nope; here") == "Ahaz & Hezekiah &nope; here")
    }

    @Test("does not leak malformed closing tags into visible text")
    func malformedTags() {
        #expect(VerseMarkup.plainText("Blessed <i>be</i></i> the Lord") == "Blessed be the Lord")
    }

    @Test("passes plain KJV text straight through")
    func plainPassthrough() {
        let verse = "For God so loved the world, that he gave his only begotten Son"
        #expect(VerseMarkup.plainText(verse) == verse)
        #expect(VerseMarkup.segments(verse) == [BibleVerseSegment(text: verse, italic: false)])
    }
}
