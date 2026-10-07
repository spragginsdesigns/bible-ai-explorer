import SwiftUI

/// Settings -> My testimony, shared by both Apple clients: how the user came to
/// faith, in their own words. The counterpart of the Android and web cards of
/// the same name.
///
/// Private by design. Only the assistant reads it, so an answer can connect to
/// what God has done in this person's life; it is never shown to anyone or
/// shared. Mounted straight after About me, which it otherwise mirrors: the
/// editor, draft guard and Save button are `PersonalTextSection`.
struct TestimonySection: View {
    let settings: SettingsStore
    let preferences: PreferencesSyncModel

    /// `MAX_TESTIMONY_LENGTH` in `src/lib/preferences-contract.ts`, twice About
    /// me's: a testimony is a story, not a profile line. The server refuses
    /// anything longer with a 400, so the box stops at the same count.
    static let maxLength = 2000

    /// Taller than About me's box, since the text it expects is longer.
    private static let minHeight: CGFloat = 200

    static let description =
        "How you came to faith, in your own words. Private: only SureWord reads it, so its "
        + "answers can connect to what God has done in your life. It is never shown to anyone "
        + "or shared."

    static let placeholder = "Where you were, how the Lord reached you, and what has changed since"

    var body: some View {
        PersonalTextSection(
            field: .testimony,
            title: "My testimony",
            description: Self.description,
            placeholder: Self.placeholder,
            maxLength: Self.maxLength,
            minHeight: Self.minHeight,
            settings: settings,
            preferences: preferences
        )
    }
}
