import ExpoModulesCore
import Foundation
import Network
import Security

// NOT COMPILED OR RUN YET: Swift cannot be built on Windows. Checked in M6 (specs/008, T018).
public class LocalServerModule: Module {
  private var server: LoopbackServer?

  /// Per launch, kept across a restart after the app returns to the foreground (same rule as Android).
  private lazy var token: String = {
    var bytes = [UInt8](repeating: 0, count: 32)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return bytes.map { String(format: "%02x", $0) }.joined()
  }()

  public func definition() -> ModuleDefinition {
    Name("LocalServer")

    AsyncFunction("start") { (port: UInt16, documentDirUri: String, promise: Promise) in
      let baseUrl = "http://127.0.0.1:\(port)"
      if self.server?.isRunning == true {
        promise.resolve(["baseUrl": baseUrl, "token": self.token])
        return
      }
      guard let root = Bundle.main.url(forResource: "web-ui", withExtension: nil) else {
        promise.reject("UI_MISSING", "The bundled web UI is missing")
        return
      }
      guard let documents = URL(string: documentDirUri), documents.isFileURL else {
        promise.reject("BAD_DOCUMENT_DIR", "The app document folder is not a file URI")
        return
      }
      let next = LoopbackServer(port: port, root: root, documents: documents, token: self.token)
      next.start { error in
        if let error {
          promise.reject("PORT_IN_USE", error.localizedDescription)
        } else {
          self.server = next
          promise.resolve(["baseUrl": baseUrl, "token": self.token])
        }
      }
    }

    AsyncFunction("stop") {
      self.server?.stop()
      self.server = nil
    }

    Function("isRunning") { self.server?.isRunning == true }

    OnDestroy {
      self.server?.stop()
      self.server = nil
    }
  }
}

/// Same rules as Android's LoopbackServer.kt: loopback only, GET only, single ranges, one request per connection.
final class LoopbackServer {
  private static let bufferBytes = 64 * 1024
  private static let maxHeadBytes = 16 * 1024

  private let port: UInt16
  private let root: URL
  private let documents: URL
  private let token: String
  private let queue = DispatchQueue(label: "readmate-ui-server", attributes: .concurrent)
  private var listener: NWListener?
  private(set) var isRunning = false

  init(port: UInt16, root: URL, documents: URL, token: String) {
    self.port = port
    self.root = root.standardizedFileURL
    self.documents = documents.standardizedFileURL
    self.token = token
  }

  func start(completion: @escaping (Error?) -> Void) {
    do {
      let parameters = NWParameters.tcp
      parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
      parameters.allowLocalEndpointReuse = true
      let listener = try NWListener(using: parameters)
      var reported = false
      listener.stateUpdateHandler = { [weak self] state in
        switch state {
        case .ready:
          self?.isRunning = true
          if !reported { reported = true; completion(nil) }
        // `waiting` before the first `ready` means the port cannot be bound; without this, `start` never settles.
        case .failed(let error), .waiting(let error):
          self?.isRunning = false
          if !reported { reported = true; completion(error) }
          listener.cancel()
        case .cancelled:
          self?.isRunning = false
        default:
          break
        }
      }
      listener.newConnectionHandler = { [weak self] connection in
        guard let self else { return connection.cancel() }
        connection.start(queue: self.queue)
        self.readHead(connection, Data())
      }
      listener.start(queue: queue)
      self.listener = listener
    } catch {
      completion(error)
    }
  }

  func stop() {
    listener?.cancel()
    listener = nil
    isRunning = false
  }

  private func readHead(_ connection: NWConnection, _ received: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, isComplete, error in
      guard let self, error == nil else { return connection.cancel() }
      var head = received
      if let data { head.append(data) }
      if head.range(of: Data("\r\n\r\n".utf8)) != nil {
        self.respond(connection, String(decoding: head, as: UTF8.self))
      } else if isComplete || head.count > Self.maxHeadBytes {
        connection.cancel()
      } else {
        self.readHead(connection, head)
      }
    }
  }

  private func respond(_ connection: NWConnection, _ head: String) {
    let lines = head.components(separatedBy: "\r\n")
    let parts = lines[0].split(separator: " ").map(String.init)
    guard parts.count == 3 else { return connection.cancel() }
    func header(_ name: String) -> String? {
      lines.dropFirst().first { $0.lowercased().hasPrefix(name + ":") }.map {
        String($0.dropFirst(name.count + 1)).trimmingCharacters(in: .whitespaces)
      }
    }
    guard header("host") == "127.0.0.1:\(port)" else { return sendEmpty(connection, "403 Forbidden") }
    guard parts[0] == "GET" else { return sendEmpty(connection, "405 Method Not Allowed", "Allow: GET\r\n") }

    // `/books/{uuid}` and `/covers/{uuid}` (spec 008, T054): token as `?t=`, no-store, matched on the raw path.
    if let route = Self.appRoute(parts[1]) {
      guard let given = Self.queryParam(parts[1], "t"), Self.constantTimeEquals(given, token) else {
        return sendEmpty(connection, "403 Forbidden")
      }
      let file = route.kind == "books"
        ? documents.appendingPathComponent("books").appendingPathComponent(route.id).appendingPathComponent("file")
        : documents.appendingPathComponent("covers").appendingPathComponent("\(route.id).png")
      let mime = route.kind == "covers" ? "image/png" : "application/octet-stream"
      return serve(connection, file, mime, header("range"), "Cache-Control: no-store\r\n")
    }

    guard let file = resolve(parts[1]) else { return sendEmpty(connection, "404 Not Found") }
    serve(connection, file, Self.mimeType(file.pathExtension), header("range"), "")
  }

  private func serve(_ connection: NWConnection, _ file: URL, _ mime: String, _ range: String?, _ extra: String) {
    guard let length = (try? file.resourceValues(forKeys: [.fileSizeKey]))?.fileSize.map(Int64.init),
      let handle = try? FileHandle(forReadingFrom: file)
    else { return sendEmpty(connection, "404 Not Found") }

    switch Self.parseRange(range, length) {
    case .unsatisfiable:
      try? handle.close()
      sendEmpty(connection, "416 Range Not Satisfiable", "Content-Range: bytes */\(length)\r\n\(extra)")
    case .whole:
      stream(connection, handle, "200 OK", mime, 0, length, extra)
    case .part(let start, let end):
      stream(connection, handle, "206 Partial Content", mime, start, end - start + 1, "Content-Range: bytes \(start)-\(end)/\(length)\r\n\(extra)")
    }
  }

  private struct AppRoute {
    let kind: String
    let id: String
  }

  private static func appRoute(_ target: String) -> AppRoute? {
    let path = String(target.split(separator: "?", omittingEmptySubsequences: false)[0])
    let pattern = "^/(books|covers)/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"
    guard let regex = try? NSRegularExpression(pattern: pattern),
      let match = regex.firstMatch(in: path, range: NSRange(path.startIndex..., in: path)),
      let kind = Range(match.range(at: 1), in: path), let id = Range(match.range(at: 2), in: path)
    else { return nil }
    return AppRoute(kind: String(path[kind]), id: path[id].lowercased())
  }

  private static func queryParam(_ target: String, _ name: String) -> String? {
    let pieces = target.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
    guard pieces.count == 2 else { return nil }
    return pieces[1].split(separator: "&").first { $0.hasPrefix("\(name)=") }.map { String($0.dropFirst(name.count + 1)) }
  }

  private static func constantTimeEquals(_ a: String, _ b: String) -> Bool {
    let x = Array(a.utf8), y = Array(b.utf8)
    guard x.count == y.count else { return false }
    var diff: UInt8 = 0
    for i in 0..<x.count { diff |= x[i] ^ y[i] }
    return diff == 0
  }

  private func resolve(_ target: String) -> URL? {
    let raw = target.split(separator: "?", omittingEmptySubsequences: false)[0]
    guard raw.hasPrefix("/"), let decoded = String(raw).removingPercentEncoding,
      !decoded.contains("\\"), !decoded.contains("\0")
    else { return nil }
    var segments = decoded.split(separator: "/").map(String.init)
    if segments.contains(".") || segments.contains("..") { return nil }
    if segments.isEmpty || decoded.hasSuffix("/") { segments.append("index.html") }
    let file = segments.reduce(root) { $0.appendingPathComponent($1) }.standardizedFileURL
    return file.path.hasPrefix(root.path + "/") ? file : nil
  }

  private func headers(_ status: String, _ mime: String, _ length: Int64, _ extra: String) -> Data {
    Data(
      ("HTTP/1.1 \(status)\r\nContent-Type: \(mime)\r\nContent-Length: \(length)\r\nAccept-Ranges: bytes\r\n"
        + "X-Content-Type-Options: nosniff\r\nConnection: close\r\n\(extra)\r\n").utf8)
  }

  private func sendEmpty(_ connection: NWConnection, _ status: String, _ extra: String = "") {
    connection.send(content: headers(status, "text/plain", 0, extra), isComplete: true, completion: .contentProcessed { _ in connection.cancel() })
  }

  private func stream(_ connection: NWConnection, _ handle: FileHandle, _ status: String, _ mime: String, _ start: Int64, _ size: Int64, _ extra: String) {
    try? handle.seek(toOffset: UInt64(start))
    connection.send(content: headers(status, mime, size, extra), completion: .contentProcessed { [weak self] error in
      guard error == nil else {
        try? handle.close()
        return connection.cancel()
      }
      self?.pump(connection, handle, size)
    })
  }

  private func pump(_ connection: NWConnection, _ handle: FileHandle, _ remaining: Int64) {
    let chunk = remaining > 0 ? (try? handle.read(upToCount: Int(min(remaining, Int64(Self.bufferBytes))))) ?? nil : nil
    guard let chunk, !chunk.isEmpty else {
      try? handle.close()
      connection.send(content: nil, isComplete: true, completion: .contentProcessed { _ in connection.cancel() })
      return
    }
    connection.send(content: chunk, completion: .contentProcessed { [weak self] error in
      guard error == nil else {
        try? handle.close()
        return connection.cancel()
      }
      self?.pump(connection, handle, remaining - Int64(chunk.count))
    })
  }

  private enum ByteRange {
    case whole, unsatisfiable, part(Int64, Int64)
  }

  private static func parseRange(_ header: String?, _ length: Int64) -> ByteRange {
    guard let header, header.hasPrefix("bytes=") else { return .whole }
    let parts = header.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false).map(String.init)
    guard parts.count == 2, parts.allSatisfy({ $0.allSatisfy(\.isNumber) }) else { return .whole }
    if parts[0].isEmpty && parts[1].isEmpty { return .whole }
    if parts[0].isEmpty {
      guard let suffix = Int64(parts[1]), suffix > 0, length > 0 else { return .unsatisfiable }
      return .part(max(length - suffix, 0), length - 1)
    }
    guard let start = Int64(parts[0]), start < length else { return .unsatisfiable }
    let end = parts[1].isEmpty ? length - 1 : min(Int64(parts[1]) ?? length - 1, length - 1)
    return end < start ? .unsatisfiable : .part(start, end)
  }

  private static func mimeType(_ fileExtension: String) -> String {
    switch fileExtension.lowercased() {
    case "html": return "text/html; charset=utf-8"
    case "js", "mjs": return "text/javascript; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "json", "map": return "application/json"
    case "svg": return "image/svg+xml"
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    case "webp": return "image/webp"
    case "woff2": return "font/woff2"
    case "woff": return "font/woff"
    case "ttf": return "font/ttf"
    case "otf": return "font/otf"
    case "wasm": return "application/wasm"
    case "pdf": return "application/pdf"
    case "epub": return "application/epub+zip"
    case "txt": return "text/plain; charset=utf-8"
    case "md": return "text/markdown; charset=utf-8"
    default: return "application/octet-stream"
    }
  }
}
