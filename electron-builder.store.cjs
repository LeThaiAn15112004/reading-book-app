// Spec 010 (research R1, contracts/store-build.md): the Microsoft Store package (.msix, x64).
//
// Extends the base electron-builder.json5, so the Store package gets exactly the same `files` allowlist, FFmpeg
// `extraResources` and `afterPack` check as the NSIS installer (FR-005). Build it through `npm run package:store`,
// which validates the identity first and runs electron-builder with `--win appx` (CLI targets replace the base
// `win.target`; config arrays would be concatenated, not replaced).
//
// Merge rule (electron-builder deepAssign): objects merge, ARRAYS ARE CONCATENATED. So `win.extraResources` below
// only ADDS the startup-task script; the base FFmpeg entry is inherited and must not be repeated.
const path = require('node:path')
const identity = require('./source/app/platforms/electron/store/store-identity.json')

const STORE_DIR = 'source/app/platforms/electron/store'

const { _doc, ...appxIdentity } = identity

module.exports = {
  extends: './electron-builder.json5',
  // Windows Kits 10.0.26100 (signtool / makeappx / makepri), checksum-pinned by app-builder-lib. The default toolset
  // (winCodeSign-2.6.0) ships a 2016 signtool that cannot sign an .msix ("A required function is not present").
  // Store config only: the NSIS build keeps the default toolset. Labelled beta by electron-builder 26.18.
  toolsets: { winCodeSign: '1.1.0' },
  win: {
    // PowerShell cannot read inside app.asar, so the startup-task bridge ships as a real file:
    // {resources}/store/startup-task.ps1 (background/store-startup-task.ts).
    extraResources: [{ from: `${STORE_DIR}/startup-task.ps1`, to: 'store/startup-task.ps1' }],
    // Test signing (--test-sign) only: electron-builder picks SHA-256-only signing for files named *.appx, not *.msix,
    // and an MSIX cannot carry the default SHA-1 + SHA-256 dual signature.
    signtoolOptions: { signingHashAlgorithms: ['sha256'] },
  },
  appx: {
    ...appxIdentity,
    // Our own startup task (electron-builder's built-in one is hard-coded TaskId="SlackStartup").
    customExtensionsPath: `${STORE_DIR}/appx-extensions.xml`,
    // electron-builder's template + the uap10 namespace. getResource() falls back to a project-relative path, so
    // the file stays in store/ and is not copied into build-resources/.
    customManifestPath: path.posix.join(STORE_DIR, 'appxmanifest.xml'),
    artifactName: '${productName}-Windows-${version}-Store.msix',
  },
}
