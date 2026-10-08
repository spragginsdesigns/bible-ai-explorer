import Foundation

#if DEBUG
/// Debug-only canned API answers for the screenshot harness
/// (`UIEvidenceHarness`, `scripts/app-store-screenshots.py`).
///
/// Active only when the app was launched with `-SureWordEvidence YES` **and**
/// a manifest exists at `Documents/evidence-fixtures/routes.json` in the app's
/// own container (the screenshot script copies it there). Each route names a
/// method, a path (query string ignored) and a body file; a request that
/// matches is answered from disk, anything else goes to the network exactly as
/// before. The real views, models and decoders run unchanged on top, so a
/// fixture screen draws what a signed-in session would draw for that data.
/// Release builds compile none of this.
enum EvidenceFixtures {
    struct Route: Decodable {
        let method: String
        let path: String
        let file: String
        let contentType: String?
        let status: Int?
    }

    struct Answer {
        let status: Int
        let contentType: String
        let body: Data
    }

    static let directory: URL? = FileManager.default
        .urls(for: .documentDirectory, in: .userDomainMask).first?
        .appendingPathComponent("evidence-fixtures", isDirectory: true)

    /// Loaded once; empty (and therefore inert) outside evidence runs.
    static let routes: [Route] = {
        guard UserDefaults.standard.bool(forKey: "SureWordEvidence"),
              let directory,
              let data = try? Data(contentsOf: directory.appendingPathComponent("routes.json")),
              let routes = try? JSONDecoder().decode([Route].self, from: data)
        else { return [] }
        return routes
    }()

    static var isActive: Bool { !routes.isEmpty }

    static func answer(for request: URLRequest) -> Answer? {
        guard isActive, let directory, let url = request.url else { return nil }
        let method = (request.httpMethod ?? "GET").uppercased()
        guard let route = routes.first(where: { $0.method.uppercased() == method && $0.path == url.path }),
              let body = try? Data(contentsOf: directory.appendingPathComponent(route.file))
        else { return nil }
        return Answer(status: route.status ?? 200, contentType: route.contentType ?? "application/json", body: body)
    }
}

/// Serves `EvidenceFixtures` to `URLSession`, including streaming routes:
/// the body is delivered in small chunks so `bytes(for:)` consumers read it
/// the way they read a live stream.
final class EvidenceURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool {
        EvidenceFixtures.answer(for: request) != nil
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url, let answer = EvidenceFixtures.answer(for: request),
              let response = HTTPURLResponse(
                url: url,
                statusCode: answer.status,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": answer.contentType]
              )
        else {
            client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        var offset = 0
        let chunk = 4096
        while offset < answer.body.count {
            let end = min(offset + chunk, answer.body.count)
            client?.urlProtocol(self, didLoad: answer.body.subdata(in: offset..<end))
            offset = end
        }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
#endif
