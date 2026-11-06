// Allows http only to the app's own loopback server: never global cleartext (specs/008, T019).
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

const RELEASE_RULES = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
`

// Debug builds only: this file overrides the rule above, because Metro is reached over the LAN.
const DEBUG_RULES = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`

function writeRules(projectRoot, sourceSet, contents) {
  const dir = path.join(projectRoot, 'app', 'src', sourceSet, 'res', 'xml')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'network_security_config.xml'), contents)
}

module.exports = function withLoopbackCleartext(config) {
  config = withAndroidManifest(config, (next) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(next.modResults)
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config'
    return next
  })
  return withDangerousMod(config, [
    'android',
    (next) => {
      writeRules(next.modRequest.platformProjectRoot, 'main', RELEASE_RULES)
      writeRules(next.modRequest.platformProjectRoot, 'debug', DEBUG_RULES)
      return next
    },
  ])
}
