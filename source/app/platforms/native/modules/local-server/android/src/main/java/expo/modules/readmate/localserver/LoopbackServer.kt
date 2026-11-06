package expo.modules.readmate.localserver

import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.BindException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** Read-only files the server may send, addressed by a path already checked by [safePath]. */
interface UiFiles {
  fun open(path: String): InputStream?
}

/** Imported books and covers in app-private storage, addressed by a validated UUID only (spec 008, T054). */
interface AppFiles {
  fun book(id: String): File?
  fun cover(id: String): File?
}

class PortInUseException(port: Int, cause: Throwable) : Exception("Port $port is in use", cause)

/**
 * Minimal HTTP/1.1 server for the bundled UI: loopback only, GET only, one request per connection.
 * Single `Range` requests get `206` / `416`, as PDF.js and media elements expect.
 *
 * `/books/{uuid}` and `/covers/{uuid}` (spec 008, T054) serve app-private files to the WebView and need the
 * per-launch token as `?t=`: another app on the device can reach loopback, but cannot know the token. They answer
 * `Cache-Control: no-store`, so no copy of a book stays in the WebView's cache.
 */
class LoopbackServer(
  private val port: Int,
  private val files: UiFiles,
  private val appFiles: AppFiles? = null,
  private val token: String? = null,
) {
  private val pool = Executors.newCachedThreadPool { task -> Thread(task, "readmate-ui-server").apply { isDaemon = true } }
  private val lengths = ConcurrentHashMap<String, Long>()
  private val allowedHost = "127.0.0.1:$port"
  @Volatile private var socket: ServerSocket? = null

  val isRunning: Boolean
    get() = socket?.isClosed == false

  fun start() {
    if (isRunning) return
    val bound = try {
      ServerSocket(port, 50, InetAddress.getByName("127.0.0.1"))
    } catch (error: BindException) {
      throw PortInUseException(port, error)
    }
    socket = bound
    pool.execute {
      while (!bound.isClosed) {
        val client = try { bound.accept() } catch (_: Exception) { break }
        pool.execute { client.use(::serve) }
      }
    }
  }

  fun stop() {
    socket?.close()
    socket = null
  }

  private fun serve(client: Socket) {
    try {
      client.soTimeout = READ_TIMEOUT_MS
      val head = readHead(client.getInputStream()) ?: return
      val out = BufferedOutputStream(client.getOutputStream())
      respond(head, out)
      out.flush()
    } catch (_: java.io.IOException) {
      // The WebView dropped the connection, as it does after enough of a ranged read.
    }
  }

  private fun respond(head: RequestHead, out: OutputStream) {
    // A page on another origin can reach loopback through a rebound name; only our own Host is served.
    if (head.host != allowedHost) return writeEmpty(out, 403, "Forbidden")
    if (head.method != "GET") return writeEmpty(out, 405, "Method Not Allowed", "Allow: GET\r\n")
    appRoute(head.target)?.let { route -> return respondAppFile(head, out, route) }
    val path = safePath(head.target) ?: return writeEmpty(out, 404, "Not Found")
    val length = lengthOf(path) ?: return writeEmpty(out, 404, "Not Found")
    sendRanged(out, head.range, length, mimeType(path), "") { files.open(path) }
  }

  private fun respondAppFile(head: RequestHead, out: OutputStream, route: AppRoute) {
    val expected = token ?: return writeEmpty(out, 404, "Not Found")
    val given = queryParam(head.target, "t") ?: return writeEmpty(out, 403, "Forbidden")
    if (!constantTimeEquals(given, expected)) return writeEmpty(out, 403, "Forbidden")
    val store = appFiles ?: return writeEmpty(out, 404, "Not Found")
    val file = (if (route.kind == "books") store.book(route.id) else store.cover(route.id))
      ?.takeIf { it.isFile } ?: return writeEmpty(out, 404, "Not Found")
    val mime = if (route.kind == "covers") "image/png" else "application/octet-stream"
    sendRanged(out, head.range, file.length(), mime, "Cache-Control: no-store\r\n") { FileInputStream(file) }
  }

  private fun sendRanged(out: OutputStream, rangeHeader: String?, length: Long, mime: String, extra: String, open: () -> InputStream?) {
    when (val range = parseRange(rangeHeader, length)) {
      is ByteRange.Unsatisfiable -> writeEmpty(out, 416, "Range Not Satisfiable", "Content-Range: bytes */$length\r\n$extra")
      is ByteRange.Whole -> {
        writeHeaders(out, 200, "OK", mime, length, extra)
        open()?.use { copy(it, out, 0, length) }
      }
      is ByteRange.Part -> {
        val size = range.end - range.start + 1
        writeHeaders(out, 206, "Partial Content", mime, size, "Content-Range: bytes ${range.start}-${range.end}/$length\r\n$extra")
        open()?.use { copy(it, out, range.start, size) }
      }
    }
  }

  // Android assets may be compressed, so a length is known only by reading to the end once.
  private fun lengthOf(path: String): Long? {
    lengths[path]?.let { return it }
    val stream = files.open(path) ?: return null
    val length = stream.use { input ->
      val buffer = ByteArray(BUFFER_BYTES)
      var total = 0L
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        total += read
      }
      total
    }
    lengths[path] = length
    return length
  }

  private fun copy(input: InputStream, out: OutputStream, start: Long, size: Long) {
    var toSkip = start
    while (toSkip > 0) {
      val skipped = input.skip(toSkip)
      if (skipped <= 0) {
        if (input.read() < 0) return
        toSkip -= 1
      } else {
        toSkip -= skipped
      }
    }
    val buffer = ByteArray(BUFFER_BYTES)
    var remaining = size
    while (remaining > 0) {
      val read = input.read(buffer, 0, minOf(remaining, buffer.size.toLong()).toInt())
      if (read < 0) return
      out.write(buffer, 0, read)
      remaining -= read
    }
  }

  private fun writeHeaders(out: OutputStream, status: Int, reason: String, mime: String, length: Long, extra: String) {
    val text = "HTTP/1.1 $status $reason\r\n" +
      "Content-Type: $mime\r\n" +
      "Content-Length: $length\r\n" +
      "Accept-Ranges: bytes\r\n" +
      "X-Content-Type-Options: nosniff\r\n" +
      "Connection: close\r\n" +
      extra +
      "\r\n"
    out.write(text.toByteArray(Charsets.US_ASCII))
  }

  private fun writeEmpty(out: OutputStream, status: Int, reason: String, extra: String = "") {
    writeHeaders(out, status, reason, "text/plain", 0, extra)
  }

  private companion object {
    const val READ_TIMEOUT_MS = 30_000
    const val BUFFER_BYTES = 64 * 1024
  }
}

data class RequestHead(val method: String, val target: String, val host: String?, val range: String?)

private const val MAX_HEAD_BYTES = 16 * 1024

fun readHead(input: InputStream): RequestHead? {
  val bytes = StringBuilder()
  while (!bytes.endsWith("\r\n\r\n")) {
    if (bytes.length >= MAX_HEAD_BYTES) return null
    val next = input.read()
    if (next < 0) return null
    bytes.append(next.toChar())
  }
  val lines = bytes.split("\r\n")
  val parts = lines[0].split(' ')
  if (parts.size != 3) return null
  fun header(name: String) = lines.drop(1).firstOrNull { it.startsWith("$name:", ignoreCase = true) }
    ?.substringAfter(':')?.trim()
  return RequestHead(parts[0], parts[1], header("Host"), header("Range"))
}

/** The asset path for a request target, or null when it could leave the UI folder. */
fun safePath(target: String): String? {
  val rawPath = target.substringBefore('?').substringBefore('#')
  if (!rawPath.startsWith("/") || rawPath.contains('+')) return null
  val decoded = try { URLDecoder.decode(rawPath, "UTF-8") } catch (_: IllegalArgumentException) { return null }
  if (decoded.contains('\\') || decoded.contains('\u0000')) return null
  val segments = decoded.split('/').filter { it.isNotEmpty() }
  if (segments.any { it == "." || it == ".." }) return null
  return if (segments.isEmpty() || decoded.endsWith("/")) (segments + "index.html").joinToString("/") else segments.joinToString("/")
}

data class AppRoute(val kind: String, val id: String)

private val APP_ROUTE = Regex("""^/(books|covers)/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$""")

/** `/books/{uuid}` or `/covers/{uuid}`, matched on the raw path: no decoding, so nothing else can be named. */
fun appRoute(target: String): AppRoute? {
  val match = APP_ROUTE.matchEntire(target.substringBefore('?').substringBefore('#')) ?: return null
  return AppRoute(match.groupValues[1], match.groupValues[2].lowercase())
}

fun queryParam(target: String, name: String): String? {
  val query = target.substringAfter('?', "").substringBefore('#')
  return query.split('&').firstOrNull { it.startsWith("$name=") }?.substringAfter('=')
}

fun constantTimeEquals(a: String, b: String): Boolean {
  if (a.length != b.length) return false
  var diff = 0
  for (i in a.indices) diff = diff or (a[i].code xor b[i].code)
  return diff == 0
}

sealed class ByteRange {
  object Whole : ByteRange()
  object Unsatisfiable : ByteRange()
  data class Part(val start: Long, val end: Long) : ByteRange()
}

/** Single ranges only; anything else that is not understood gets the whole file, as RFC 9110 allows. */
fun parseRange(header: String?, length: Long): ByteRange {
  val match = Regex("""^bytes=(\d*)-(\d*)$""").matchEntire(header?.trim() ?: return ByteRange.Whole) ?: return ByteRange.Whole
  val (first, last) = match.destructured
  if (first.isEmpty() && last.isEmpty()) return ByteRange.Whole
  if (first.length > 18 || last.length > 18) return ByteRange.Unsatisfiable
  if (first.isEmpty()) {
    val suffix = last.toLong()
    if (suffix == 0L || length == 0L) return ByteRange.Unsatisfiable
    return ByteRange.Part(maxOf(length - suffix, 0), length - 1)
  }
  val start = first.toLong()
  if (start >= length) return ByteRange.Unsatisfiable
  val end = if (last.isEmpty()) length - 1 else minOf(last.toLong(), length - 1)
  if (end < start) return ByteRange.Unsatisfiable
  return ByteRange.Part(start, end)
}

fun mimeType(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
  "html" -> "text/html; charset=utf-8"
  "js", "mjs" -> "text/javascript; charset=utf-8"
  "css" -> "text/css; charset=utf-8"
  "json", "map" -> "application/json"
  "svg" -> "image/svg+xml"
  "png" -> "image/png"
  "jpg", "jpeg" -> "image/jpeg"
  "webp" -> "image/webp"
  "woff2" -> "font/woff2"
  "woff" -> "font/woff"
  "ttf" -> "font/ttf"
  "otf" -> "font/otf"
  "wasm" -> "application/wasm"
  "pdf" -> "application/pdf"
  "epub" -> "application/epub+zip"
  "txt" -> "text/plain; charset=utf-8"
  "md" -> "text/markdown; charset=utf-8"
  else -> "application/octet-stream"
}
