package expo.modules.readmate.localserver

import java.io.ByteArrayInputStream
import java.io.File
import java.nio.file.Files
import java.io.InputStream
import java.net.ServerSocket
import java.net.Socket
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LoopbackServerTest {
  private val body = ByteArray(1000) { (it % 251).toByte() }
  private val files = object : UiFiles {
    override fun open(path: String): InputStream? = when (path) {
      "index.html", "book.pdf" -> ByteArrayInputStream(body)
      else -> null
    }
  }
  private val port = ServerSocket(0).use { it.localPort }
  private val bookId = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
  private val documents: File = Files.createTempDirectory("readmate-docs").toFile().apply {
    File(this, "books/$bookId").mkdirs()
    File(this, "books/$bookId/file").writeBytes(body)
  }
  private val appFiles = object : AppFiles {
    override fun book(id: String) = File(documents, "books/$id/file")
    override fun cover(id: String) = File(documents, "covers/$id.png")
  }
  private val server = LoopbackServer(port, files, appFiles, "secret").apply { start() }

  @After fun stop() {
    server.stop()
    documents.deleteRecursively()
  }

  private class Reply(val status: Int, val headers: String, val body: ByteArray)

  private fun request(target: String, extra: String = "", method: String = "GET", host: String = "127.0.0.1:$port"): Reply {
    Socket("127.0.0.1", port).use { socket ->
      socket.getOutputStream().write("$method $target HTTP/1.1\r\nHost: $host\r\n$extra\r\n".toByteArray())
      val all = socket.getInputStream().readBytes()
      val split = String(all, Charsets.ISO_8859_1).indexOf("\r\n\r\n")
      val head = String(all, 0, split, Charsets.ISO_8859_1)
      return Reply(head.split(' ')[1].toInt(), head, all.copyOfRange(split + 4, all.size))
    }
  }

  @Test fun servesIndexAtRoot() {
    val reply = request("/")
    assertEquals(200, reply.status)
    assertTrue(reply.headers.contains("text/html"))
    assertArrayEquals(body, reply.body)
  }

  @Test fun rangeGives206WithExactBytes() {
    val reply = request("/book.pdf", "Range: bytes=10-19\r\n")
    assertEquals(206, reply.status)
    assertTrue(reply.headers.contains("Content-Range: bytes 10-19/1000"))
    assertArrayEquals(body.copyOfRange(10, 20), reply.body)
  }

  @Test fun suffixAndOpenRanges() {
    assertArrayEquals(body.copyOfRange(990, 1000), request("/book.pdf", "Range: bytes=-10\r\n").body)
    assertArrayEquals(body.copyOfRange(995, 1000), request("/book.pdf", "Range: bytes=995-\r\n").body)
  }

  @Test fun rangePastEndGives416() {
    val reply = request("/book.pdf", "Range: bytes=1000-\r\n")
    assertEquals(416, reply.status)
    assertTrue(reply.headers.contains("Content-Range: bytes */1000"))
  }

  @Test fun onlyGet() = assertEquals(405, request("/book.pdf", method = "POST").status)

  @Test fun unknownFileIs404() = assertEquals(404, request("/nope.js").status)

  @Test fun traversalIs404() {
    assertEquals(404, request("/../secret").status)
    assertEquals(404, request("/%2e%2e/secret").status)
    assertEquals(404, request("/a%5c..%5csecret").status)
  }

  @Test fun foreignHostIsRefused() = assertEquals(403, request("/", host = "evil.example").status)

  @Test fun safePathRules() {
    assertEquals("index.html", safePath("/"))
    assertEquals("assets/a b.js", safePath("/assets/a%20b.js?x=1"))
    assertNull(safePath("no-slash"))
  }

  @Test fun secondStartOnTakenPortFails() {
    var failed = false
    try {
      LoopbackServer(port, files).start()
    } catch (_: PortInUseException) {
      failed = true
    }
    assertTrue(failed)
  }

  @Test fun bookRouteNeedsTheToken() {
    assertEquals(403, request("/books/$bookId").status)
    assertEquals(403, request("/books/$bookId?t=wrong").status)
    val reply = request("/books/$bookId?t=secret")
    assertEquals(200, reply.status)
    assertTrue(reply.headers.contains("Cache-Control: no-store"))
    assertArrayEquals(body, reply.body)
  }

  @Test fun bookRouteRanges() {
    val reply = request("/books/$bookId?t=secret", "Range: bytes=100-109\r\n")
    assertEquals(206, reply.status)
    assertArrayEquals(body.copyOfRange(100, 110), reply.body)
    assertEquals(416, request("/books/$bookId?t=secret", "Range: bytes=5000-\r\n").status)
  }

  @Test fun appRoutesNameOnlyUuids() {
    assertEquals(404, request("/books/not-a-uuid?t=secret").status)
    assertEquals(404, request("/books/..%2f..%2fsecret?t=secret").status)
    assertEquals(404, request("/covers/$bookId?t=secret").status)
    assertNull(appRoute("/books/$bookId/extra"))
  }
}
