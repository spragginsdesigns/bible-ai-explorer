import SwiftUI

/// Settings → Web Search, shared by both Apple clients - the counterpart of the
/// web app's `#web-search` card in `src/app/settings/page.tsx` and of Android's
/// row. The label and the sentence under it are the web copy verbatim, because
/// a setting that reads differently per client reads as a different setting.
///
/// Modelled on the Memory toggle next to it: the switch is disabled until the
/// server has said what the value is, moves optimistically on a tap, and rolls
/// back with an alert if the PATCH fails.
struct WebSearchSection: View {
    @Environment(\.theme) private var theme

    let preferences: PreferencesSyncModel

    var body: some View {
        Section("Web search") {
            Toggle(
                "Enable web search",
                isOn: Binding(
                    get: { preferences.webSearchEnabled ?? false },
                    set: { enabled in Task { await preferences.setWebSearchEnabled(enabled) } }
                )
            )
            .disabled(preferences.webSearchEnabled == nil || preferences.isWebSearchPending)
            Text(
                "Lets SureWord look up supplementary material online (church history, "
                    + "archaeology, current events). Scripture stays the final authority."
            )
            .font(.system(size: 11))
            .foregroundStyle(theme.textGhost)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

extension View {
    /// The alert a failed `PATCH /api/preferences` raises, in the same shape as
    /// `memoryErrorAlert`.
    ///
    /// `isActive` exists for the same reason it does there: two views observing
    /// one model must not both try to present it, and an alert attached under a
    /// sheet that is currently up never appears.
    ///
    /// The model is optional so a view that reaches it through
    /// `SettingsStore.sync` rather than the environment can attach this without
    /// a `guard` - with no session there is simply nothing to present.
    func preferencesErrorAlert(_ model: PreferencesSyncModel?, isActive: Bool = true) -> some View {
        alert(
            model?.errorAlert?.title ?? "",
            isPresented: Binding(
                get: { isActive && model?.errorAlert != nil },
                set: { if !$0 { model?.errorAlert = nil } }
            ),
            presenting: model?.errorAlert
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { alert in
            Text(alert.message)
        }
    }
}
