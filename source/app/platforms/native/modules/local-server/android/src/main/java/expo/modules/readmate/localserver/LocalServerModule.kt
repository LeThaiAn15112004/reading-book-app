package expo.modules.readmate.localserver

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileNotFoundException
import java.net.URI
import java.security.SecureRandom
import java.io.InputStream

class LocalServerModule : Module() {
  private var server: LoopbackServer? = null

  /** Per launch: kept across a restart after the app returns to the foreground, so the WebView's URLs stay valid. */
  private val token: String by lazy {
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    bytes.joinToString("") { "%02x".format(it) }
  }

  override fun definition() = ModuleDefinition {
    Name("LocalServer")

    AsyncFunction("start") { port: Int, documentDirUri: String ->
      val documents = try { File(URI(documentDirUri)) } catch (_: Exception) {
        throw CodedException("BAD_DOCUMENT_DIR", "The app document folder is not a file URI", null)
      }
      val assets = appContext.reactContext?.assets ?: throw Exceptions.ReactContextLost()
      if (assets.list("web-ui")?.contains("index.html") != true) {
        throw CodedException("UI_MISSING", "The bundled web UI is missing; run npm run build:web before a native build", null)
      }
      val running = server?.takeIf { it.isRunning }
      if (running == null) {
        val ui = object : UiFiles {
          override fun open(path: String): InputStream? = try {
            assets.open("web-ui/$path")
          } catch (_: FileNotFoundException) {
            null
          }
        }
        // Ids reach here only after appRoute() matched a UUID, so these paths cannot leave books/ or covers/.
        val appFiles = object : AppFiles {
          override fun book(id: String) = File(File(File(documents, "books"), id), "file")
          override fun cover(id: String) = File(File(documents, "covers"), "$id.png")
        }
        val next = LoopbackServer(port, ui, appFiles, token)
        try {
          next.start()
        } catch (error: PortInUseException) {
          throw CodedException("PORT_IN_USE", error.message ?: "Port in use", error)
        }
        server = next
      }
      mapOf("baseUrl" to "http://127.0.0.1:$port", "token" to token)
    }

    AsyncFunction("stop") {
      server?.stop()
      server = null
    }

    Function("isRunning") { server?.isRunning == true }

    OnDestroy {
      server?.stop()
      server = null
    }
  }
}
