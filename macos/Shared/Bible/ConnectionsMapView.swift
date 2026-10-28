import SwiftUI

/// Native counterpart of Android's Connections tab (`mobile/app/(app)/
/// connections.tsx`, the source of truth): one chapter's cross-references
/// drawn around a ring of the whole Bible, the chapter's verses with their
/// counts, a focused verse's linked passages tagged by section, and a short,
/// consent-gated sheet explaining why they connect.
struct ConnectionsMapView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.theme) private var theme
    @State private var model = ConnectionsModel()
    @State private var query = ""
    @State private var queryError = false
    @State private var section: String?
    @State private var texts: [String] = []
    @State private var showingExplanation = false
    @State private var retry = 0

    private var place: ConnectionsPlace { app.connectionPlace }
    private var translation: TranslationID { app.settings.translation }
    private var bookName: String { Bible.book(order: place.order)?.name ?? "" }
    private var loadKey: String { "\(place.order):\(place.chapter):\(translation.rawValue):\(retry)" }
    private var chapterKey: String { "\(place.order):\(place.chapter)" }

    /// The loaded chapter, only when it is the one on screen.
    private var placeData: ConnectionsChapter? {
        guard let chapter = model.chapter, chapter.order == place.order, chapter.chapter == place.chapter else { return nil }
        return chapter
    }
    private var links: [[Int]] { placeData?.ranked(verse: nil, section: nil) ?? [] }
    private var focusLinks: [[Int]] { place.verse.map { verse in links.filter { $0[0] == verse } } ?? [] }
    /// What the chips count: the whole chapter, or the focused verse.
    private var scopeLinks: [[Int]] { place.verse == nil ? links : focusLinks }
    private var counts: [String: Int] { ConnectionsRules.sectionCounts(scopeLinks.map { $0[1] }) }
    private var shownLinks: [[Int]] {
        guard let section else { return focusLinks }
        return focusLinks.filter { ConnectionCanonSection.containing($0[1]).id == section }
    }
    private var sectionLabel: String? { section.flatMap { id in ConnectionCanonSection.all.first { $0.id == id }?.title } }
    private var linkedReferences: [String] {
        shownLinks.map { ConnectionsPlace(order: $0[1], chapter: $0[2], verse: $0[3]).reference }
    }

    var body: some View {
        ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.lg) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("CONNECTIONS").appFont(.caption.weight(.bold)).tracking(2).foregroundStyle(theme.accent)
                        Text("Scripture interprets Scripture")
                            .appFont(.custom(FontFamily.verse, size: 24))
                            .foregroundStyle(theme.text)
                    }
                    .id("top")
                    search
                    if queryError {
                        Text("Try a reference like Romans 8 or John 3:16.").foregroundStyle(theme.danger).appFont(.callout)
                    }
                    scopePickers
                    chapterStepper
                    ring
                    if model.error != nil {
                        Button("Connections could not load. Tap to try again.") { retry += 1 }
                            .buttonStyle(.plain)
                            .appFont(.callout.weight(.semibold))
                            .foregroundStyle(theme.accent)
                            .frame(maxWidth: .infinity)
                    }
                    sectionChips
                    if place.verse != nil {
                        focusPanel
                    } else {
                        chapterPanel
                    }
                }
                .padding(Spacing.lg)
                .frame(maxWidth: 780)
                .frame(maxWidth: .infinity)
            }
            .onChange(of: place) { _, _ in withAnimation { scroll.scrollTo("top", anchor: .top) } }
        }
        .background { MeshBackground() }
        .navigationTitle("Connections")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    openReader(place)
                } label: {
                    Label("Read \(bookName) \(place.chapter)", systemImage: "book")
                }
                .help("Read \(bookName) \(place.chapter)")
            }
        }
        .task(id: loadKey) {
            texts = []
            let translation = translation
            let current = place
            async let chapterLoad: Void = model.load(api: app.api, place: current)
            let next = try? await BibleTranslations.chapter(translation, order: current.order, chapter: current.chapter)
            if !Task.isCancelled { texts = next ?? [] }
            await chapterLoad
        }
        // A new chapter starts unfiltered; focusing a verse keeps the filter,
        // as Android's does.
        .onChange(of: chapterKey) { _, _ in section = nil }
        .onChange(of: place) { _, _ in model.resetExplanation(); showingExplanation = false }
        .onChange(of: section) { _, _ in model.resetExplanation() }
        .onChange(of: app.settings.translation) { _, _ in model.resetExplanation() }
        .sheet(isPresented: $showingExplanation, onDismiss: { model.resetExplanation() }) {
            explanationSheet
        }
    }

    // MARK: Navigation

    private var search: some View {
        HStack {
            TextField("Go to… John 3:16, Psalm 22", text: $query)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .onSubmit { searchReference() }
                .onChange(of: query) { _, _ in queryError = false }
                .accessibilityLabel("Go to a verse or chapter")
            Button("Go", action: searchReference).buttonStyle(.bordered)
        }
    }

    private func searchReference() {
        guard let reference = Bible.resolveReference(query.trimmingCharacters(in: .whitespacesAndNewlines)),
              let next = ConnectionsPlace.validated(order: reference.order, chapter: reference.chapter, verse: reference.verse) else {
            queryError = true
            return
        }
        queryError = false
        query = ""
        section = nil
        app.connectionPlace = next
    }

    private var scopePickers: some View {
        HStack {
            Picker("Book", selection: Binding(get: { place.order }, set: {
                app.connectionPlace = ConnectionsPlace(order: $0, chapter: 1, verse: nil)
            })) {
                ForEach(Bible.books) { book in Text(book.name).tag(book.order) }
            }
            Picker("Chapter", selection: Binding(get: { place.chapter }, set: {
                app.connectionPlace = ConnectionsPlace(order: place.order, chapter: $0, verse: nil)
            })) {
                ForEach(1...(Bible.book(order: place.order)?.chapters ?? 1), id: \.self) { Text("\($0)").tag($0) }
            }
        }
        .pickerStyle(.menu)
    }

    /// Android's chevrons either side of the chapter name, crossing book
    /// boundaries.
    private var chapterStepper: some View {
        HStack(spacing: Spacing.md) {
            Button { step(-1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                .buttonStyle(.plain)
                .disabled(ConnectionsRules.step(place, by: -1) == nil)
                .accessibilityLabel("Previous chapter")
                .help("Previous chapter")
            Text("\(bookName) \(place.chapter)")
                .appFont(.headline)
                .foregroundStyle(theme.textSecondary)
                .frame(minWidth: 140)
            Button { step(1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                .buttonStyle(.plain)
                .disabled(ConnectionsRules.step(place, by: 1) == nil)
                .accessibilityLabel("Next chapter")
                .help("Next chapter")
        }
        .foregroundStyle(theme.text)
        .frame(maxWidth: .infinity)
    }

    private func step(_ delta: Int) {
        guard let next = ConnectionsRules.step(place, by: delta) else { return }
        section = nil
        app.connectionPlace = next
    }

    private func focus(_ verse: Int?) {
        app.connectionPlace = ConnectionsPlace(order: place.order, chapter: place.chapter, verse: verse)
    }

    // MARK: Ring

    private var ringTitle: String {
        place.verse.map { "\(bookName) \(place.chapter):\($0)" } ?? "\(bookName) \(place.chapter)"
    }

    private var ringSubtitle: String {
        if placeData != nil {
            return ConnectionsRules.connectionCount(section.map { counts[$0] ?? 0 } ?? scopeLinks.count)
        }
        return model.error != nil ? "Could not load" : "Loading…"
    }

    @ViewBuilder private var ring: some View {
        ZStack {
            if let chapter = placeData {
                ConnectionsRingView(chapter: chapter, overview: model.overview, place: place, section: section,
                    onSelectBook: { order in
                        // Android: a book on the ring filters to its section;
                        // tapping that section again clears it.
                        let id = ConnectionCanonSection.containing(order).id
                        section = section == id ? nil : id
                    },
                    onCenter: { focus(nil) })
            } else {
                Circle().strokeBorder(theme.border, lineWidth: 4).padding(16).aspectRatio(1, contentMode: .fit)
            }
            VStack(spacing: 2) {
                Text(ringTitle)
                    .appFont(.custom(FontFamily.verse, size: 28))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(ringSubtitle).appFont(.subheadline).foregroundStyle(theme.accent)
                if placeData == nil && model.error == nil { ProgressView().controlSize(.small).padding(.top, Spacing.xs) }
            }
            .padding(.horizontal, 80)
            .allowsHitTesting(false)
        }
        .frame(maxWidth: 530)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(ringTitle), \(ringSubtitle). Tap a book on the ring to filter by its section.")
    }

    /// "All N" and one chip per section that has links; the active chip stays
    /// even at zero so the reader can always see and clear the filter.
    private var sectionChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                chip(label: "All \(scopeLinks.count)", color: nil, active: section == nil) { section = nil }
                ForEach(ConnectionCanonSection.all) { item in
                    let count = counts[item.id] ?? 0
                    let active = section == item.id
                    if count > 0 || active {
                        chip(label: "\(item.title) \(count)", color: item.color, active: active) {
                            section = active ? nil : item.id
                        }
                        .accessibilityLabel("\(item.title), \(count)")
                    }
                }
            }
            .padding(.vertical, Spacing.xs)
        }
    }

    private func chip(label: String, color: Color?, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let color { Circle().fill(color).frame(width: 8, height: 8) }
                Text(label).appFont(.footnote.weight(.semibold))
                    .foregroundStyle(active ? (color ?? theme.accent) : theme.textSecondary)
            }
            .padding(.horizontal, Spacing.md)
            .frame(minHeight: 36)
            .background(active ? (color?.opacity(0.13) ?? theme.accentSoft) : theme.surface, in: .capsule)
            .overlay { Capsule().strokeBorder(active ? (color ?? theme.accentBorder) : theme.borderStrong, lineWidth: 1) }
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    // MARK: Panels

    /// A focused verse: its text, then the passages it links to.
    private var focusPanel: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack {
                Text("\(bookName.uppercased()) \(place.chapter):\(place.verse ?? 1)")
                    .appFont(.caption.weight(.bold)).tracking(2.4).foregroundStyle(theme.accent)
                Spacer()
                Text(translation.name).appFont(.caption).tracking(1).foregroundStyle(theme.textFaint)
            }
            if let verse = place.verse, texts.indices.contains(verse - 1) {
                Text(VerseMarkup.plainText(texts[verse - 1]))
                    .appFont(.custom(FontFamily.verse, size: 24))
                    .foregroundStyle(theme.text)
                    .textSelection(.enabled)
            }
            Divider().overlay(theme.borderStrong)
            HStack {
                Text("CONNECTED VERSES  \(shownLinks.count)")
                    .appFont(.caption.weight(.bold)).tracking(1.6).foregroundStyle(theme.textMuted)
                Spacer()
                Button("Whole chapter") { focus(nil) }
                    .buttonStyle(.plain)
                    .appFont(.footnote.weight(.semibold))
                    .foregroundStyle(theme.accent)
            }
            if shownLinks.isEmpty {
                Text(ConnectionsRules.emptyFocusMessage(loaded: placeData != nil, sectionLabel: sectionLabel, focusCount: focusLinks.count))
                    .foregroundStyle(theme.textMuted)
            }
            ForEach(Array(shownLinks.enumerated()), id: \.offset) { _, link in
                passageRow(link)
            }
            if !shownLinks.isEmpty {
                Button {
                    showingExplanation = true
                    explain()
                } label: {
                    Label("Ask why these connect", systemImage: "sparkles")
                        .frame(maxWidth: .infinity, minHeight: 46)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(Spacing.lg)
        .background(theme.surface, in: .rect(cornerRadius: Radius.xl))
        .overlay { RoundedRectangle(cornerRadius: Radius.xl).strokeBorder(theme.borderStrong, lineWidth: 1) }
    }

    /// The whole chapter: every verse with how many links leave it.
    private var chapterPanel: some View {
        let counts = ConnectionsRules.countsByVerse(links)
        return VStack(alignment: .leading, spacing: Spacing.xs) {
            Text("TAP A VERSE TO SEE ITS CONNECTIONS")
                .appFont(.caption.weight(.bold)).tracking(1.6).foregroundStyle(theme.textMuted)
                .padding(.bottom, Spacing.xs)
            if texts.isEmpty && placeData != nil {
                Button("The chapter text is unavailable. Open it in the reader.") { openReader(place) }
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.textMuted)
            }
            ForEach(Array(texts.enumerated()), id: \.offset) { index, text in
                let verse = index + 1
                let count = counts[verse] ?? 0
                Button { focus(verse) } label: {
                    HStack(spacing: Spacing.md) {
                        Text("\(verse)").appFont(.footnote.weight(.bold)).foregroundStyle(theme.accentDim)
                            .frame(width: 26, alignment: .leading)
                        Text(VerseMarkup.plainText(text))
                            .appFont(.custom(FontFamily.verse, size: 18))
                            .foregroundStyle(theme.textSecondary)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text("\(count)")
                            .appFont(.footnote.weight(.bold))
                            .foregroundStyle(theme.text)
                            .frame(minWidth: 34)
                            .padding(.vertical, 2)
                            .overlay { Capsule().strokeBorder(theme.borderStrong, lineWidth: 1) }
                            .opacity(count == 0 ? 0.4 : 1)
                    }
                    .frame(minHeight: 44)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Verse \(verse), \(count) connections")
            }
        }
        .padding(Spacing.lg)
        .background(theme.surface, in: .rect(cornerRadius: Radius.xl))
        .overlay { RoundedRectangle(cornerRadius: Radius.xl).strokeBorder(theme.borderStrong, lineWidth: 1) }
    }

    private func passageRow(_ link: [Int]) -> some View {
        let target = ConnectionsPlace(order: link[1], chapter: link[2], verse: link[3])
        let canon = ConnectionCanonSection.containing(link[1])
        return VStack(alignment: .leading, spacing: Spacing.sm) {
            Button { openReader(target) } label: {
                HStack(spacing: Spacing.sm) {
                    Circle().fill(canon.color).frame(width: 8, height: 8)
                    Text(target.reference).appFont(.headline).foregroundStyle(theme.text)
                    Spacer()
                    SectionTag(section: canon)
                    Image(systemName: "chevron.right").foregroundStyle(theme.textFaint)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open \(target.reference), \(canon.title)")
            ConnectionQuoteView(place: target, translation: translation)
            Button("Explore its connections") { app.connectionPlace = target }
                .buttonStyle(.plain)
                .appFont(.callout).foregroundStyle(theme.accent)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.surface, in: .rect(cornerRadius: Radius.md))
        .overlay { RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.border, lineWidth: 1) }
    }

    // MARK: Explanation

    private var explanationSheet: some View {
        let parsed = ConnectionExplanation.parse(model.explanation, complete: !model.explaining)
        return NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    (Text(place.reference).foregroundStyle(theme.accent)
                        + Text(sectionLabel.map { "  ·  \($0)" } ?? "").foregroundStyle(theme.textMuted))
                        .appFont(.headline)
                    if let error = model.explanationError {
                        Text(error).foregroundStyle(theme.danger)
                        Button("Try again", action: explain)
                    }
                    if model.explaining && model.explanation.isEmpty {
                        HStack(spacing: Spacing.sm) {
                            ProgressView()
                            Text("Tracing the links through Scripture…").foregroundStyle(theme.textMuted)
                        }
                    }
                    if !parsed.summary.isEmpty {
                        Text(parsed.summary)
                            .appFont(.custom(FontFamily.verse, size: 21))
                            .foregroundStyle(theme.text)
                            .textSelection(.enabled)
                    }
                    ForEach(Array(parsed.items.enumerated()), id: \.offset) { _, item in
                        explanationCard(item)
                    }
                    if model.explaining && !parsed.items.isEmpty { ProgressView().frame(maxWidth: .infinity) }
                    if model.explanationFinished {
                        Button {
                            continueInChat()
                        } label: {
                            Label("Keep studying this in chat", systemImage: "bubble.left.and.text.bubble.right")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }.padding(Spacing.lg).frame(maxWidth: 680)
            }
            .navigationTitle("Why these connect")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showingExplanation = false } } }
            .background(theme.bg)
        }
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 560)
        #endif
    }

    /// One passage of the answer: its section dot and tag, then why it links.
    private func explanationCard(_ item: ConnectionExplanation.Item) -> some View {
        let target = ConnectionsRules.explainedTarget(item.reference)
        let canon = target.map { ConnectionCanonSection.containing($0.order) }
        return Button {
            guard let target else { return }
            showingExplanation = false
            openReader(target)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: Spacing.sm) {
                    if let canon { Circle().fill(canon.color).frame(width: 8, height: 8) }
                    Text(item.reference).appFont(.headline).foregroundStyle(theme.text)
                    Spacer()
                    if let canon { SectionTag(section: canon) }
                }
                Text(item.text)
                    .foregroundStyle(theme.textSecondary)
                    .multilineTextAlignment(.leading)
            }
            .padding(Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.surface, in: .rect(cornerRadius: Radius.md))
            .overlay { RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.borderStrong, lineWidth: 1) }
            .contentShape(.rect(cornerRadius: Radius.md))
        }
        .buttonStyle(.plain)
        .disabled(target == nil)
        .accessibilityLabel("Open \(item.reference)")
    }

    private func explain() { model.explain(api: app.api, place: place, translation: translation, section: section) }

    private func openReader(_ target: ConnectionsPlace) {
        app.pendingVerseReference = target.reference
        app.pendingVerseTranslation = translation
        app.section = .bible
    }

    private func continueInChat() {
        guard place.verse != nil else { return }
        app.chat.input = ConnectionsRules.askPrompt(reference: place.reference, linked: linkedReferences)
        app.chat.attachment = nil
        if let verse = place.verse, texts.indices.contains(verse - 1) {
            app.chat.attachment = VerseAttachment(reference: place.reference, text: VerseMarkup.plainText(texts[verse - 1]), translation: translation)
        }
        showingExplanation = false
        app.section = .chat
    }
}

/// The small outlined section name on a passage, in the section's colour.
private struct SectionTag: View {
    let section: ConnectionCanonSection
    var body: some View {
        Text(section.title)
            .appFont(.caption2.weight(.bold))
            .foregroundStyle(section.color)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .overlay { Capsule().strokeBorder(section.color.opacity(0.55), lineWidth: 1) }
    }
}

private struct ConnectionQuoteView: View {
    @Environment(\.theme) private var theme
    let place: ConnectionsPlace
    let translation: TranslationID
    @State private var quote: String?
    var body: some View {
        Group {
            if let quote {
                Text("“\(quote)”")
                    .appFont(.custom(FontFamily.verse, size: 17).italic())
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(3)
            }
        }
        .task(id: "\(place.reference):\(translation.rawValue)") {
            quote = nil
            guard let verse = place.verse,
                  let chapter = try? await BibleTranslations.chapter(translation, order: place.order, chapter: place.chapter),
                  chapter.indices.contains(verse - 1), !Task.isCancelled else { return }
            quote = VerseMarkup.plainText(chapter[verse - 1])
        }
    }
}

struct ConnectionsRingView: View {
    let chapter: ConnectionsChapter
    let overview: ConnectionsOverview?
    let place: ConnectionsPlace
    let section: String?
    /// A book on the ring: Android filters to that book's section.
    let onSelectBook: (Int) -> Void
    /// The middle of the ring: back to the whole chapter.
    let onCenter: () -> Void

    var body: some View {
        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let radius = min(size.width, size.height) / 2 - 16
            func point(_ index: Double, inset: Double = 0) -> CGPoint {
                let angle = ConnectionsGeometry.angle(index: index, total: chapter.total)
                return CGPoint(x: center.x + cos(angle) * (radius - inset), y: center.y + sin(angle) * (radius - inset))
            }
            func chord(_ from: Double, _ to: Double) -> Path {
                let p = point(from, inset: 8), q = point(to, inset: 8)
                let middle = CGPoint(x: (p.x + q.x) / 2, y: (p.y + q.y) / 2)
                let control = CGPoint(x: middle.x + (center.x - middle.x) * 0.82, y: middle.y + (center.y - middle.y) * 0.82)
                var path = Path(); path.move(to: p); path.addQuadCurve(to: q, control: control); return path
            }
            if let overview, overview.bins > 0 {
                var weave = Path()
                for pair in overview.pairs where pair.count == 3 {
                    let a = (Double(pair[0]) + 0.5) / Double(overview.bins) * Double(chapter.total)
                    let b = (Double(pair[1]) + 0.5) / Double(overview.bins) * Double(chapter.total)
                    weave.addPath(chord(a, b))
                }
                context.stroke(weave, with: .color(.secondary.opacity(0.045)), lineWidth: 0.5)
            }
            for book in chapter.books where book.count == 3 {
                var arc = Path()
                let start = ConnectionsGeometry.angle(index: Double(book[1]) - 0.5, total: chapter.total)
                let end = ConnectionsGeometry.angle(index: Double(book[1] + book[2]) - 0.5, total: chapter.total)
                let trim = min(0.004, (end - start) * 0.2)
                arc.addArc(center: center, radius: radius, startAngle: .radians(start + trim), endAngle: .radians(end - trim), clockwise: false)
                let dimmed = section != nil && ConnectionCanonSection.containing(book[0]).id != section
                context.stroke(arc, with: .color(ConnectionCanonSection.containing(book[0]).color.opacity(dimmed ? 0.4 : 1)),
                               lineWidth: book[0] == place.order ? 8 : 4)
            }
            // The whole chapter behind (dimmed while a verse is focused), the
            // focused verse's links bright on top - one path per canon section
            // and layer keeps dense chapters responsive.
            let focused = place.verse != nil
            for canon in ConnectionCanonSection.all {
                var back = Path()
                var front = Path()
                for link in chapter.ranked(verse: nil, section: section) where (canon.first...canon.last).contains(link[1]) {
                    let path = chord(Double(chapter.chapterStart + link[0] - 1), Double(link[4]))
                    if focused && link[0] == place.verse { front.addPath(path) } else { back.addPath(path) }
                }
                context.stroke(back, with: .color(canon.color.opacity(focused ? 0.14 : 0.45)), lineWidth: 0.9)
                context.stroke(front, with: .color(canon.color.opacity(0.28)), lineWidth: 4)
                context.stroke(front, with: .color(canon.color.opacity(0.95)), lineWidth: 1.4)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .contentShape(.rect)
        .overlay {
            GeometryReader { proxy in
                Color.clear.contentShape(.rect).onTapGesture { point in
                    let center = CGPoint(x: proxy.size.width / 2, y: proxy.size.height / 2)
                    let radius = min(proxy.size.width, proxy.size.height) / 2 - 16
                    let dx = point.x - center.x, dy = point.y - center.y
                    let distance = sqrt(dx * dx + dy * dy)
                    if distance < radius * 0.42 {
                        onCenter()
                        return
                    }
                    guard abs(distance - radius) <= 26,
                          let index = ConnectionsGeometry.index(angle: atan2(dy, dx), total: chapter.total),
                          let book = ConnectionsGeometry.book(index: index, books: chapter.books) else { return }
                    onSelectBook(book)
                }
            }
        }
        .accessibilityHint("Tap a book on the ring to filter by its section, or the middle for the whole chapter.")
    }
}
