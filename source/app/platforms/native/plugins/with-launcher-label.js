// Android: the short name under the home-screen icon. The app's full name ("Readmate Reader", app.json `name`) stays the
// application label (Settings → Apps, the recents screen); the launcher activity gets its own shorter label, because
// launchers cut a long name under the icon ("Readmate Rea…").
const { AndroidConfig, withAndroidManifest, withStringsXml } = require('expo/config-plugins')

const LAUNCHER_LABEL = 'Readmate'
const RESOURCE = 'launcher_label'

module.exports = function withLauncherLabel(config) {
  config = withStringsXml(config, (next) => {
    next.modResults = AndroidConfig.Strings.setStringItem(
      [{ $: { name: RESOURCE, translatable: 'false' }, _: LAUNCHER_LABEL }],
      next.modResults,
    )
    return next
  })
  return withAndroidManifest(config, (next) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(next.modResults)
    activity.$['android:label'] = `@string/${RESOURCE}`
    return next
  })
}
