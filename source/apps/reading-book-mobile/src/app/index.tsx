import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, StyleSheet, Text, View } from 'react-native'
import { NavigationBar } from 'expo-navigation-bar'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

import { externalHostOf, type SystemBarColors } from '../host/app-service'
import { checkSqlite } from '../host/feasibility-sqlite'
import { createHostRuntime, deliveryScript, type HostRuntime } from '../host/host-runtime'
import { isInsideUi, useHostLifecycle } from '../host/lifecycle'
import { RPC_VERSION, WEBVIEW_RECEIVER, type HostEvent, type HostEventName } from '../host/protocol'
import { resolveUiSource, type UiSource } from '../host/ui-source'

const FEASIBILITY = process.env.EXPO_PUBLIC_FEASIBILITY === '1'
// M2 only (T017, native build): load through file:// instead of the local server, to record whether modules and workers run.
const FILE_ROUTE = FEASIBILITY && process.env.EXPO_PUBLIC_UI_ROUTE === 'file'
const FILE_SOURCE: UiSource = { url: 'file:///android_asset/web-ui/index.html', origin: 'file://', baseUrl: null, token: null }

/** Night, the UI's default theme (`--lib-bg-deep`), until the page reports its own edge colours. */
const DEFAULT_BARS: SystemBarColors = { top: '#0f172a', bottom: '#0f172a' }

/** Relative luminance (sRGB) of `#rrggbb`: above 0.5 the bar needs dark icons. */
function isLightColor(hex: string): boolean {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5) > 0.5
}

export default function ReaderHost() {
  const [source, setSource] = useState<UiSource | null>(FILE_ROUTE ? FILE_SOURCE : null)
  const [error, setError] = useState<string | null>(null)
  const [sqlite, setSqlite] = useState<string | null>(null)
  // Bumped to remount the WebView after its process died; the UI then re-reads everything from SQLite.
  const [generation, setGeneration] = useState(0)
  const webView = useRef<WebView>(null)

  const [runtime, setRuntime] = useState<HostRuntime | null>(null)
  // Edge-to-edge: the status and navigation bars are transparent, so the app paints the areas behind them in the
  // colours at the top and bottom edge of the page (`app.setSystemBars`), instead of the system's own colour.
  const [bars, setBars] = useState<SystemBarColors>(DEFAULT_BARS)
  const insets = useSafeAreaInsets()

  useEffect(() => {
    // The root view shows during rotation and keyboard transitions: keep it in the app's colour too.
    void SystemUI.setBackgroundColorAsync(bars.bottom).catch(() => {})
  }, [bars.bottom])

  const post = useCallback((message: unknown) => {
    webView.current?.injectJavaScript(deliveryScript(WEBVIEW_RECEIVER, message))
  }, [])

  useEffect(() => {
    if (!FILE_ROUTE) {
      resolveUiSource().then(
        (resolved) => {
          setSource(resolved)
          setRuntime(
            createHostRuntime(
              resolved,
              (event: HostEvent) => post(event),
              (next) => setBars((current) => (current.top === next.top && current.bottom === next.bottom ? current : next)),
            ),
          )
        },
        (cause) => setError(String(cause)),
      )
    }
    if (FEASIBILITY) void checkSqlite().then(setSqlite)
  }, [post])

  const send = useCallback((event: HostEventName, payload: unknown) => post({ v: RPC_VERSION, event, payload }), [post])
  const lifecycle = useHostLifecycle({ enabled: runtime !== null, usesLocalServer: source?.baseUrl != null, send })

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (!runtime) return
      const { data, url } = event.nativeEvent
      void runtime.handleMessage(data, url).then((response) => {
        if (response) post(response)
      })
    },
    [runtime, post],
  )

  // Icons and buttons readable on the painted colour: dark on a light theme (Paper), light on Night / Sepia.
  // The navigation bar is Android only; the component renders nothing on iOS.
  const statusBar = (
    <>
      <StatusBar style={isLightColor(bars.top) ? 'dark' : 'light'} />
      <NavigationBar style={isLightColor(bars.bottom) ? 'dark' : 'light'} />
    </>
  )

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: bars.bottom }]}>
        {statusBar}
        <Text style={{ color: isLightColor(bars.bottom) ? '#0f172a' : '#f8fafc' }}>Readmate could not start: {error}</Text>
      </View>
    )
  }

  if (!source) return <View style={[styles.fill, { backgroundColor: bars.bottom }]}>{statusBar}</View>

  // Boot values before the UI starts: an object on Android (`injectedJavaScriptBeforeContentLoaded` is not reliable
  // there), a script on iOS; the bridge also falls back to an `app.boot` request.
  const bootScript = runtime ? `window.__READMATE_BOOT__=${JSON.stringify(runtime.boot)};true;` : undefined

  return (
    <View style={[styles.fill, { backgroundColor: bars.bottom, paddingLeft: insets.left, paddingRight: insets.right }]}>
      {statusBar}
      <View style={{ height: insets.top, backgroundColor: bars.top }} />
      {sqlite && <Text selectable style={styles.report}>{sqlite}</Text>}
      <WebView
        key={generation}
        ref={webView}
        style={[styles.fill, { backgroundColor: bars.bottom }]}
        source={{ uri: source.url }}
        originWhitelist={FILE_ROUTE ? ['file://*'] : [source.origin, 'about:*', 'blob:*', 'data:*']}
        onShouldStartLoadWithRequest={({ url }) => {
          if (FILE_ROUTE || isInsideUi(url, source.origin)) return true
          // A link out of the app opens in the system browser, after the same check as `app.openExternal`.
          if (externalHostOf(url)) void Linking.openURL(url)
          return false
        }}
        onMessage={onMessage}
        onNavigationStateChange={(state) => lifecycle.setCanGoBack(state.canGoBack)}
        onRenderProcessGone={() => setGeneration((n) => n + 1)}
        onContentProcessDidTerminate={() => setGeneration((n) => n + 1)}
        injectedJavaScriptObject={runtime?.boot}
        injectedJavaScriptBeforeContentLoaded={bootScript}
        allowFileAccess={FILE_ROUTE}
        allowFileAccessFromFileURLs={FILE_ROUTE}
        allowUniversalAccessFromFileURLs={FILE_ROUTE}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        webviewDebuggingEnabled={__DEV__ || FEASIBILITY}
      />
      <View style={{ height: insets.bottom, backgroundColor: bars.bottom }} />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  report: { fontSize: 11, padding: 4 },
})
