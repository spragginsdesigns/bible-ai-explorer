import SwiftUI

/// Bundled raster files are loaded explicitly, rather than looked up in an asset catalog.
@MainActor
enum ChatArtwork {
    private static let images: [String: Image] = {
        let names = ["sureword-mark", "sureword-sanctuary", "sureword-sanctuary-light",
                     "sureword-companion-idle", "sureword-companion-thinking", "sureword-companion-answering"]
        return Dictionary(uniqueKeysWithValues: names.compactMap { name in
            guard let url = Bundle.main.url(forResource: name, withExtension: "png"),
                  let data = try? Data(contentsOf: url) else { return nil }
            #if os(macOS)
            guard let image = NSImage(data: data) else { return nil }
            return (name, Image(nsImage: image))
            #else
            guard let image = UIImage(data: data) else { return nil }
            return (name, Image(uiImage: image))
            #endif
        })
    }()

    static func image(_ name: String) -> Image {
        images[name] ?? Image("SureWordGuide")
    }
}
