// Windows only: moves every native module's CMake build folder (`.cxx`) to a short path (specs/008, T092).
//
// The Android SDK's CMake 3.22.1 ships ninja 1.10.2, which cannot open paths longer than 260 characters on Windows,
// even with LongPathsEnabled. Under `node_modules/react-native-reanimated/android/.cxx/…/prefab/…` the prefab config
// files reach 261–277 characters, ninja reports them as missing, re-runs CMake and stops with
// "manifest 'build.ninja' still dirty after 100 tries". `buildStagingDirectory` under `%LOCALAPPDATA%\rmcxx\<module>`
// brings the longest one to about 200. `READMATE_CXX_DIR` overrides the folder; other systems are not changed.
const { withProjectBuildGradle } = require('expo/config-plugins')

const MARKER = '// readmate: short native build dir'

const BLOCK = `
${MARKER} (plugins/with-short-native-build-dir.js)
def readmateCxxRoot = System.getenv('READMATE_CXX_DIR') ?:
  (System.getProperty('os.name').toLowerCase().contains('windows') && System.getenv('LOCALAPPDATA')
    ? "\${System.getenv('LOCALAPPDATA')}/rmcxx" : null)
if (readmateCxxRoot) {
  subprojects { sub ->
    ['com.android.library', 'com.android.application'].each { id ->
      sub.plugins.withId(id) {
        try {
          sub.android.externalNativeBuild.cmake.buildStagingDirectory = new File(readmateCxxRoot, sub.name)
        } catch (Exception e) {
          // A project that another one evaluated early (evaluationDependsOn) keeps its own .cxx folder.
          logger.lifecycle("readmate: \${sub.name} keeps its .cxx folder (\${e.message?.readLines()?.first()})")
        }
      }
    }
  }
}
`

module.exports = function withShortNativeBuildDir(config) {
  return withProjectBuildGradle(config, (next) => {
    if (next.modResults.language !== 'groovy') throw new Error('with-short-native-build-dir: expected a Groovy build.gradle')
    if (!next.modResults.contents.includes(MARKER)) next.modResults.contents += BLOCK
    return next
  })
}
