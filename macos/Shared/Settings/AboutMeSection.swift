import SwiftUI

/// Settings -> About me, shared by both Apple clients: a paragraph the user
/// writes about themselves that rides every conversation. The counterpart of
/// the Android card in `mobile/app/(app)/settings.tsx` and of the web card in
/// `src/app/settings/page.tsx`.
///
/// Sits under Memory on purpose, and is the opposite half of it: Memory is what
/// SureWord works out on its own, this is what the user says outright. The
/// server reads both into the same turn.
///
/// The editor, draft guard and Save button live in `PersonalTextSection`,
/// which `TestimonySection` shares; this type holds only what is particular to
/// About me.
struct AboutMeSection: View {
    let settings: SettingsStore
    let preferences: PreferencesSyncModel

    /// `MAX_ABOUT_ME_LENGTH` in `src/lib/preferences-contract.ts`. The server
    /// refuses anything longer with a 400 rather than cutting it, so the box
    /// stops accepting text at the same count.
    static let maxLength = 1000

    /// Tall enough for a paragraph without the Form row jumping as it is typed.
    private static let minHeight: CGFloat = 120

    static let description =
        "Tell SureWord about yourself in your own words: where you are in your walk with the "
        + "Lord, your church background, what you are studying, what you want from this app. "
        + "The assistant reads this on every conversation. Leave it blank and it learns only "
        + "from what you say in chat."

    static let placeholder = "Where you are in your walk, your church, what you are studying"

    var body: some View {
        PersonalTextSection(
            field: .aboutMe,
            title: "About me",
            description: Self.description,
            placeholder: Self.placeholder,
            maxLength: Self.maxLength,
            minHeight: Self.minHeight,
            settings: settings,
            preferences: preferences
        )
    }
}
