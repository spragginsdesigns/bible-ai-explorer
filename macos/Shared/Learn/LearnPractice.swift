import Foundation

/// Practice modes for Learn: four ways the same verse can come back - a port of
/// `mobile/src/features/learn/practice.ts` (mirrored on web at
/// `src/components/learn/practice.ts`).
///
/// The ladder in `LearnCard.swift` decides how well a verse is known; this
/// decides how it is practised today. Nothing here reaches the server: the
/// review still sends "again" or "good". The seeded shuffle reproduces the TS
/// generator bit for bit (UInt32 wrapping arithmetic standing in for
/// `Math.imul` and `>>> 0`), so a card offers the same tile order on every
/// client. Pinned by `SureWord-iOSTests/LearnPracticeTests.swift`, which mirrors
/// `mobile/src/features/learn/practice.test.ts`.
enum LearnMode: String, CaseIterable, Sendable, Equatable {
    case blanks, letters, order, typed

    var label: String {
        switch self {
        case .blanks: "Fill the blanks"
        case .letters: "First letters"
        case .order: "Tap the next word"
        case .typed: "Type it out"
        }
    }
}

struct VerseToken: Equatable, Sendable {
    let text: String
    let prefix: String
    let core: String
    let suffix: String
}

struct LetterWord: Equatable, Sendable {
    let text: String
    let clue: String
}

struct OrderRound: Equatable, Sendable {
    let answer: [String]
    let choices: [String]
    let partial: Bool
    let start: Int
}

struct OrderTap: Equatable, Sendable {
    let correct: Bool
    let placed: [Int]
    let expected: Int?
    let done: Bool
}

enum TypedWordResult: String, Sendable, Equatable { case match, missed, extra }

struct TypedWord: Equatable, Sendable {
    let result: TypedWordResult
    let expected: String?
    let typed: String?
}

struct TypedScore: Equatable, Sendable {
    let words: [TypedWord]
    let perfect: Bool
    let empty: Bool
}

struct LearnModeSelection: Equatable, Sendable {
    let cardId: String
    let revision: Int
    let mode: LearnMode
    let chosen: Bool
}

enum LearnPractice {
    /// Switcher order: the same four modes, in the same places, on every client.
    static let modes: [LearnMode] = [.blanks, .letters, .order, .typed]

    static let orderWordCap = 24

    /// `\p{L}` / `\p{N}` - what the TS regexes treat as part of a word.
    static func isWordCharacter(_ character: Character) -> Bool {
        character.isLetter || character.isNumber
    }

    static func isHyphen(_ character: Character) -> Bool {
        character == "-" || character == "\u{2010}" || character == "\u{2011}"
    }

    static func hint(_ mode: LearnMode, stage: Int) -> String {
        switch mode {
        case .letters: "Say the verse from its first letters. Tap a word to see it."
        case .order: "Tap the words in the order they are written. A wrong tap shows the right word."
        case .typed: "Type the verse, then check it. Capitals and punctuation do not count."
        case .blanks:
            stage == 0
                ? "Read the verse, then continue."
                : stage == 3
                    ? "Say the verse from its reference. Tap a blank for help."
                    : "Recall the missing words. Tap a blank for help, then continue."
        }
    }

    /// Leading punctuation, the word, trailing punctuation.
    static func split(_ word: String) -> VerseToken {
        let prefix = String(word.prefix(while: { !isWordCharacter($0) }))
        let rest = word.dropFirst(prefix.count)
        var suffixCount = 0
        for character in rest.reversed() {
            guard !isWordCharacter(character) else { break }
            suffixCount += 1
        }
        let suffix = String(rest.suffix(suffixCount))
        let core = String(rest.dropLast(suffixCount))
        return VerseToken(text: word, prefix: prefix, core: core, suffix: suffix)
    }

    static func verseTokens(_ text: String) -> [VerseToken] {
        Learn.words(of: text).map(split)
    }

    /// Capitals, punctuation and hyphenation are how a verse is printed, not
    /// what it says.
    static func normalizeWord(_ word: String) -> String {
        String(word.lowercased().filter(isWordCharacter))
    }

    /// Every word collapses to its first letter; punctuation and hyphens stay put.
    static func firstLetterWords(_ text: String) -> [LetterWord] {
        verseTokens(text).map { token in
            var clue = ""
            var hasLetter = false
            for character in token.core {
                if isHyphen(character) {
                    clue.append(character)
                    hasLetter = false
                } else if !hasLetter, isWordCharacter(character) {
                    clue.append(character)
                    hasLetter = true
                }
            }
            return LetterWord(text: token.text, clue: "\(token.prefix)\(clue)\(token.suffix)")
        }
    }

    // MARK: - Tap the next word

    static func safeSeed(_ seed: Int) -> Int { abs(seed) }

    /// The TS generator, word for word (a mulberry32 variant).
    private struct Randomizer {
        var state: UInt32

        init(seed: Int) {
            state = UInt32(truncatingIfNeeded: Int64(safeSeed(seed)) &+ 0x6d2b79f5)
        }

        mutating func next() -> Double {
            state = state &+ 0x6d2b79f5
            var value = (state ^ (state >> 15)) &* (1 | state)
            value = (value &+ ((value ^ (value >> 7)) &* (61 | value))) ^ value
            return Double(value ^ (value >> 14)) / 4_294_967_296
        }
    }

    private static func shuffle(_ words: [String], seed: Int) -> [String] {
        var random = Randomizer(seed: seed)
        var shuffled = words
        var index = shuffled.count - 1
        while index > 0 {
            let target = Int((random.next() * Double(index + 1)).rounded(.down))
            shuffled.swapAt(index, target)
            index -= 1
        }
        // Offering the verse already in order is not a round.
        if shuffled.count > 1, shuffled == words {
            return Array(shuffled.dropFirst()) + [shuffled[0]]
        }
        return shuffled
    }

    static func orderRound(_ text: String, seed: Int) -> OrderRound {
        let words = verseTokens(text).map(\.text)
        let parts = max(1, Int((Double(words.count) / Double(orderWordCap)).rounded(.up)))
        // Even parts, so a verse one word over the cap does not end in a round of one.
        let size = max(1, Int((Double(words.count) / Double(parts)).rounded(.up)))
        let start = (safeSeed(seed) % parts) * size
        let answer = start < words.count ? Array(words[start..<min(start + size, words.count)]) : []
        return OrderRound(answer: answer, choices: shuffle(answer, seed: seed), partial: parts > 1, start: start)
    }

    /// A wrong tap shows the word that belongs next and leaves the round standing.
    static func tapOrderWord(_ round: OrderRound, placed: [Int], choice: Int) -> OrderTap {
        let expectedWord = placed.count < round.answer.count ? round.answer[placed.count] : nil
        let taken = Set(placed)
        let chosenWord = round.choices.indices.contains(choice) ? round.choices[choice] : ""
        let correct = expectedWord != nil && !taken.contains(choice)
            && normalizeWord(chosenWord) == normalizeWord(expectedWord!)
        let next = correct ? placed + [choice] : placed
        var expected: Int?
        if !correct, let expectedWord {
            expected = round.choices.indices.first { index in
                !taken.contains(index) && normalizeWord(round.choices[index]) == normalizeWord(expectedWord)
            }
        }
        return OrderTap(
            correct: correct,
            placed: next,
            expected: expected,
            done: next.count == round.answer.count && !round.answer.isEmpty
        )
    }

    // MARK: - Type it out

    /// Hyphens separate words here so "wellbeloved" and "well beloved" both land.
    private static func comparableWords(_ text: String) -> [String] {
        text.split(whereSeparator: { $0.isWhitespace || isHyphen($0) })
            .map(String.init)
            .filter { !normalizeWord($0).isEmpty }
    }

    /// Word by word against the verse, aligned by longest common subsequence so
    /// one missing word does not mark every word after it wrong.
    static func scoreTypedVerse(_ text: String, typed: String) -> TypedScore {
        let expected = comparableWords(text)
        let written = comparableWords(typed)
        let expectedKeys = expected.map(normalizeWord)
        let writtenKeys = written.map(normalizeWord)
        var table = Array(repeating: Array(repeating: 0, count: written.count + 1), count: expected.count + 1)
        if !expected.isEmpty, !written.isEmpty {
            for row in stride(from: expected.count - 1, through: 0, by: -1) {
                for column in stride(from: written.count - 1, through: 0, by: -1) {
                    table[row][column] = expectedKeys[row] == writtenKeys[column]
                        ? table[row + 1][column + 1] + 1
                        : max(table[row + 1][column], table[row][column + 1])
                }
            }
        }
        var words: [TypedWord] = []
        var row = 0
        var column = 0
        while row < expected.count, column < written.count {
            if expectedKeys[row] == writtenKeys[column] {
                words.append(TypedWord(result: .match, expected: expected[row], typed: written[column]))
                row += 1
                column += 1
            } else if table[row + 1][column] >= table[row][column + 1] {
                words.append(TypedWord(result: .missed, expected: expected[row], typed: nil))
                row += 1
            } else {
                words.append(TypedWord(result: .extra, expected: nil, typed: written[column]))
                column += 1
            }
        }
        while row < expected.count {
            words.append(TypedWord(result: .missed, expected: expected[row], typed: nil))
            row += 1
        }
        while column < written.count {
            words.append(TypedWord(result: .extra, expected: nil, typed: written[column]))
            column += 1
        }
        return TypedScore(
            words: words,
            perfect: !expected.isEmpty && words.allSatisfy { $0.result == .match },
            empty: written.isEmpty
        )
    }

    // MARK: - Which mode

    /// `cardSeed`: a Java-style string hash over UTF-16 units, then `Math.abs`.
    static func cardSeed(_ id: String) -> Int {
        var seed: Int32 = 0
        for unit in id.utf16 {
            seed = (seed &* 31) &+ Int32(unit)
        }
        return Int(seed.magnitude)
    }

    /// A verse being met opens in blanks; one being recalled alternates the two
    /// recall modes; one that is nearly known is written out.
    static func defaultMode(id: String, revision: Int, stage: Int) -> LearnMode {
        if stage == 3 { return .typed }
        if stage != 2 { return .blanks }
        return (cardSeed(id) + safeSeed(revision)) % 2 == 0 ? .letters : .order
    }

    static func defaultMode(_ card: LearnCard) -> LearnMode {
        defaultMode(id: card.id, revision: card.revision, stage: card.stage)
    }

    /// A hand-picked mode lasts as long as the card in front of the reader.
    static func resolveMode(
        id: String,
        revision: Int,
        stage: Int,
        previous: LearnModeSelection?
    ) -> LearnModeSelection {
        if let previous, previous.chosen, previous.cardId == id, previous.revision == revision {
            return previous
        }
        return LearnModeSelection(
            cardId: id,
            revision: revision,
            mode: defaultMode(id: id, revision: revision, stage: stage),
            chosen: false
        )
    }

    static func chooseMode(id: String, revision: Int, mode: LearnMode) -> LearnModeSelection {
        LearnModeSelection(cardId: id, revision: revision, mode: mode, chosen: true)
    }
}
