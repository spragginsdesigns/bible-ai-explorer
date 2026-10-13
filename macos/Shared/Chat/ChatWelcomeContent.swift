import SwiftUI

struct ChatWelcomeContent: View {
    @Environment(\.theme) private var theme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let headline: String
    let questions: [SuggestedQuestionItem]
    var isLoading: Bool
    var onSelect: (String) -> Void
    @State private var showAll = false
    private var visible: [SuggestedQuestionItem] { showAll ? questions : Array(questions.prefix(4)) }
    private var hiddenCount: Int { max(0, questions.count - 4) }
    var body: some View {
        GeometryReader { geometry in
            let columns = geometry.size.width < 350 || dynamicTypeSize >= .xxxLarge ? 1 : 2
            ScrollView {
                VStack(spacing: 0) {
                    SureWordGuideAvatar(size: 190, hero: true)
                        .padding(.vertical, -18)
                    Text(headline.replacingOccurrences(of: " for ", with: "\nfor "))
                        .font(.title.bold())
                        .foregroundStyle(theme.text)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 310)
                        .padding(.top, -8)
                        .padding(.bottom, 24)
                        .accessibilityAddTraits(.isHeader)
                    Text("CHOSEN FROM YOUR STUDY")
                        .font(.caption.weight(.semibold)).tracking(1.7)
                        .foregroundStyle(theme.textMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.bottom, 16)
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: columns), spacing: 10) {
                        if isLoading {
                            ForEach(0..<4) { _ in
                                VStack(alignment: .leading, spacing: 12) {
                                    RoundedRectangle(cornerRadius: 4).fill(theme.borderStrong).frame(height: 12)
                                    RoundedRectangle(cornerRadius: 4).fill(theme.borderStrong).frame(width: 90, height: 12)
                                    Spacer(minLength: 24)
                                }.padding(14).frame(minHeight: 124).background(theme.surface, in: .rect(cornerRadius: 16))
                                    .accessibilityHidden(true)
                            }
                        } else {
                            ForEach(visible) { item in
                                Button { onSelect(item.question) } label: {
                                    VStack(alignment: .leading, spacing: 16) {
                                        Text(item.question).font(.body).foregroundStyle(theme.text)
                                            .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                        Spacer(minLength: 0)
                                        HStack(alignment: .bottom) {
                                            if let label = item.label {
                                                Text(QuestionPresentation.parseReferenceLabel(label) ?? label)
                                                    .font(.caption).foregroundStyle(theme.accent)
                                            }
                                            Spacer(minLength: 8)
                                            Image(systemName: "arrow.up.right").foregroundStyle(theme.accent).accessibilityHidden(true)
                                        }
                                    }.padding(14).frame(maxWidth: .infinity, minHeight: 124, alignment: .leading)
                                        .background(theme.surface, in: .rect(cornerRadius: 16))
                                        .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(theme.accentBorder, lineWidth: 1) }
                                        .contentShape(.rect(cornerRadius: 16))
                                }.buttonStyle(.plain).accessibilityLabel(item.question)
                            }
                        }
                    }.accessibilityLabel(isLoading ? "Preparing your questions" : "Suggested questions")
                    if !showAll && hiddenCount > 0 && !isLoading {
                        Button { showAll = true } label: {
                            HStack(spacing: 8) { Text("\(hiddenCount) more questions"); Image(systemName: "chevron.down") }
                                .font(.subheadline.weight(.semibold)).foregroundStyle(theme.accent)
                                .frame(minHeight: 48)
                        }.buttonStyle(.plain).padding(.top, 12)
                            .accessibilityLabel("Show \(hiddenCount) more questions from your study")
                    }
                }.padding(.horizontal, 16).padding(.bottom, 24).frame(maxWidth: 720).frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(alignment: .top) {
                ChatArtwork.image(theme.isDark ? "sureword-sanctuary" : "sureword-sanctuary-light")
                    .resizable().scaledToFill().frame(width: geometry.size.width, height: 344).clipped()
                    .opacity(theme.isDark ? 0.65 : 0.18).accessibilityHidden(true).allowsHitTesting(false)
            }
        }
    }
}
