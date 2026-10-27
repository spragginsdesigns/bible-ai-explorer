import SwiftUI

/// Native counterpart of Android's Connections ring, with the same chapter
/// data, canon sections and consent-gated explanation endpoint.
struct ConnectionsMapView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.theme) private var theme
    @State private var model = ConnectionsModel()
    @State private var query = ""
    @State private var queryError: String?
    @State private var section: String?
    @State private var texts: [String] = []
    @State private var showingExplanation = false
    @State private var retry = 0

    private var place: ConnectionsPlace { app.connectionPlace }
    private var links: [[Int]] { model.chapter?.ranked(verse: place.verse, section: section) ?? [] }
    private var loadKey: String { "\(place.order):\(place.chapter):\(app.settings.translation.rawValue):\(retry)" }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Spacing.lg) {
                Text("See Scripture illuminate Scripture.")
                    .appFont(.custom(FontFamily.verse, size: 24))
                    .foregroundStyle(theme.text)
                search
                if let error = queryError { Text(error).foregroundStyle(theme.danger).appFont(.callout) }
                scopePickers
                if model.loading { ProgressView("Loading connections…").frame(maxWidth: .infinity) }
                if let error = model.error {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text(error).foregroundStyle(theme.textMuted)
                        Button("Try again") { retry += 1 }
                    }
                }
                if let chapter = model.chapter {
                    ConnectionsRingView(chapter: chapter, overview: model.overview, place: place, section: section) { order in
                        app.connectionPlace = ConnectionsPlace(order: order, chapter: 1, verse: nil)
                    }
                    .frame(maxWidth: 530)
                    .frame(maxWidth: .infinity)
                    .accessibilityLabel("\(links.count) connections from \(place.reference), arranged around all 66 books of the Bible")
                    Text("\(place.reference) · \(links.count) connections")
                        .appFont(.headline).foregroundStyle(theme.text)
                    sectionPicker
                    versePicker(chapter)
                    if let verse = place.verse, texts.indices.contains(verse - 1) {
                        Text(VerseMarkup.plainText(texts[verse - 1]))
                            .appFont(.custom(FontFamily.verse, size: 20))
                            .foregroundStyle(theme.textSecondary)
                    }
                    if place.verse != nil && !links.isEmpty {
                        Button {
                            showingExplanation = true
                            explain()
                        } label: {
                            Label("Ask why these connect", systemImage: "sparkles")
                                .frame(maxWidth: .infinity, minHeight: 46)
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    if links.isEmpty {
                        Text("No connections are listed for this selection. Try another verse or section.")
                            .foregroundStyle(theme.textMuted)
                    }
                    ForEach(Array(links.enumerated()), id: \.offset) { _, link in
                        passageRow(link)
                    }
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 780)
            .frame(maxWidth: .infinity)
        }
        .background { MeshBackground() }
        .navigationTitle("Connections")
        .task(id: loadKey) {
            texts = []
            let translation = app.settings.translation
            let current = place
            async let chapterLoad: Void = model.load(api: app.api, place: current)
            let next = try? await BibleTranslations.chapter(translation, order: current.order, chapter: current.chapter)
            if !Task.isCancelled { texts = next ?? [] }
            await chapterLoad
        }
        .onChange(of: place) { _, _ in section = nil; model.resetExplanation(); showingExplanation = false }
        .onChange(of: section) { _, _ in model.resetExplanation() }
        .onChange(of: app.settings.translation) { _, _ in model.resetExplanation() }
        .sheet(isPresented: $showingExplanation, onDismiss: { model.resetExplanation() }) {
            explanationSheet
        }
    }

    private var search: some View {
        HStack {
            TextField("A passage, e.g. Romans 8:28", text: $query)
                .textFieldStyle(.roundedBorder)
                .onSubmit { searchReference() }
            Button("Go", action: searchReference).buttonStyle(.bordered)
        }
    }

    private func searchReference() {
        guard let reference = Bible.resolveReference(query),
              let next = ConnectionsPlace.validated(order: reference.order, chapter: reference.chapter, verse: reference.verse) else {
            queryError = "Enter a Bible reference such as John 3:16."
            return
        }
        queryError = nil
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

    private var sectionPicker: some View {
        ScrollView(.horizontal) {
            HStack(spacing: Spacing.sm) {
                Button("All sections") { section = nil }.buttonStyle(.bordered)
                    .tint(section == nil ? theme.accent : theme.textMuted)
                ForEach(ConnectionCanonSection.all) { item in
                    let count = model.chapter?.ranked(verse: place.verse, section: item.id).count ?? 0
                    Button("\(item.title) · \(count)") { section = section == item.id ? nil : item.id }
                        .buttonStyle(.bordered).tint(item.color)
                        .accessibilityAddTraits(section == item.id ? .isSelected : [])
                }
            }
        }
    }

    private func versePicker(_ chapter: ConnectionsChapter) -> some View {
        Picker("Focus", selection: Binding(get: { place.verse ?? 0 }, set: {
            app.connectionPlace = ConnectionsPlace(order: place.order, chapter: place.chapter, verse: $0 == 0 ? nil : $0)
        })) {
            Text("Whole chapter").tag(0)
            ForEach(1...chapter.verseCount, id: \.self) { Text("Verse \($0)").tag($0) }
        }
        .pickerStyle(.menu)
    }

    private func passageRow(_ link: [Int]) -> some View {
        let target = ConnectionsPlace(order: link[1], chapter: link[2], verse: link[3])
        let canon = ConnectionCanonSection.containing(link[1])
        return VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack {
                Button(target.reference) { openReader(target) }
                    .appFont(.headline).foregroundStyle(theme.accent)
                Spacer()
                Text(canon.title).appFont(.caption).foregroundStyle(canon.color)
            }
            if place.verse == nil { Text("From verse \(link[0])").appFont(.caption).foregroundStyle(theme.textMuted) }
            ConnectionQuoteView(place: target, translation: app.settings.translation)
            Button("Explore its connections") { app.connectionPlace = target }
                .appFont(.callout).foregroundStyle(theme.accent)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
        .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1) }
    }

    private var explanationSheet: some View {
        let parsed = ConnectionExplanation.parse(model.explanation, complete: !model.explaining)
        return NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    Text(place.reference).appFont(.title2.bold())
                    if model.explaining { ProgressView("Following the connections…") }
                    if !parsed.summary.isEmpty { Text(parsed.summary).textSelection(.enabled) }
                    ForEach(Array(parsed.items.enumerated()), id: \.offset) { _, item in
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            Button(item.reference) {
                                if let target = Bible.resolveReference(item.reference) {
                                    showingExplanation = false
                                    openReader(ConnectionsPlace(order: target.order, chapter: target.chapter, verse: target.verse))
                                }
                            }.appFont(.headline)
                            Text(item.text).textSelection(.enabled)
                        }
                    }
                    if let error = model.explanationError {
                        Text(error).foregroundStyle(theme.danger)
                        Button("Try again", action: explain)
                    }
                    Button("Continue in Chat") { continueInChat() }
                        .buttonStyle(.borderedProminent)
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

    private func explain() { model.explain(api: app.api, place: place, translation: app.settings.translation, section: section) }
    private func openReader(_ target: ConnectionsPlace) {
        app.pendingVerseReference = target.reference
        app.pendingVerseTranslation = app.settings.translation
        app.section = .bible
    }
    private func continueInChat() {
        let references = links.prefix(10).map { ConnectionsPlace(order: $0[1], chapter: $0[2], verse: $0[3]).reference }
        app.chat.input = "Help me understand how \(place.reference) connects to \(references.joined(separator: ", ")). Explain the connections from Scripture."
        app.chat.attachment = nil
        if let verse = place.verse, texts.indices.contains(verse - 1) {
            app.chat.attachment = VerseAttachment(reference: place.reference, text: VerseMarkup.plainText(texts[verse - 1]), translation: app.settings.translation)
        }
        showingExplanation = false
        app.section = .chat
    }
}

private struct ConnectionQuoteView: View {
    @Environment(\.theme) private var theme
    let place: ConnectionsPlace
    let translation: TranslationID
    @State private var quote: String?
    var body: some View {
        Group {
            if let quote { Text(quote).appFont(.custom(FontFamily.verse, size: 17)).foregroundStyle(theme.textSecondary) }
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
    let onSelectBook: (Int) -> Void

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
                context.stroke(arc, with: .color(ConnectionCanonSection.containing(book[0]).color), lineWidth: book[0] == place.order ? 8 : 4)
            }
            // One path per canon section keeps dense chapters responsive.
            for canon in ConnectionCanonSection.all {
                var batch = Path()
                for link in chapter.ranked(verse: place.verse, section: section) where (canon.first...canon.last).contains(link[1]) {
                    batch.addPath(chord(Double(chapter.chapterStart + link[0] - 1), Double(link[4])))
                }
                context.stroke(batch, with: .color(canon.color.opacity(place.verse == nil ? 0.18 : 0.7)), lineWidth: place.verse == nil ? 0.6 : 1.25)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .contentShape(.rect)
        .overlay {
            GeometryReader { proxy in
                Color.clear.contentShape(.rect).onTapGesture { point in
                    let center = CGPoint(x: proxy.size.width / 2, y: proxy.size.height / 2)
                    let dx = point.x - center.x, dy = point.y - center.y
                    let distance = sqrt(dx * dx + dy * dy)
                    guard distance > min(proxy.size.width, proxy.size.height) * 0.34,
                          let index = ConnectionsGeometry.index(angle: atan2(dy, dx), total: chapter.total),
                          let book = ConnectionsGeometry.book(index: index, books: chapter.books) else { return }
                    onSelectBook(book)
                }
            }
        }
        .accessibilityHint("Use the Book and Chapter controls to navigate the map.")
    }
}
