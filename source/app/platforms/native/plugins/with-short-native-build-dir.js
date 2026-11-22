// Windows only: keeps every native CMake build under 260 characters (specs/008, T092).
//
// The Android SDK's CMake 3.22.1 ships ninja 1.10.2, which cannot open paths longer than 260 characters on Windows,
// even with LongPathsEnabled. Two places reach that limit:
//
// - Under `node_modules/react-native-reanimated/android/.cxx/…/prefab/…` the prefab config files reach 261–277
//   characters, ninja reports them as missing, re-runs CMake and stops with "manifest 'build.ninja' still dirty after
//   100 tries". `buildStagingDirectory` under `%LOCALAPPDATA%\rmcxx\<module>` brings the longest one to about 200.
// - The app's own CMake build compiles the autolinked codegen of every library, and CMake names each object after the
//   source's ABSOLUTE path (`…/C_/Users/…/node_modules/react-native-reanimated/…/ComponentDescriptors.cpp.o`): that
//   relative name alone is about 266 characters, so no build folder is short enough ("Filename longer than 260
//   characters"). CMake 3.31.6 ships ninja 1.12, which opens long paths. The Android Gradle plugin does NOT install
//   it: add it once with Android Studio → SDK Manager → SDK Tools → CMake 3.31.6, or
//   `sdkmanager "cmake;3.31.6"` (otherwise the build stops with CXX1300 "CMake '3.31.6' was not found").
//   `READMATE_CMAKE_VERSION` overrides the version.
//
// The block goes BEFORE `apply plugin: "com.facebook.react.rootproject"`: that plugin makes every project evaluate
// `:app` first (`evaluationDependsOn`), so a block placed after it reaches `:app` too late and `:app` keeps its own
// `.cxx` folder and CMake version. `READMATE_CXX_DIR` overrides the folder; other systems are not changed.
const { withProjectBuildGradle } = require('expo/config-plugins')

const MARKER = '// readmate: short native build dir'
const END_MARKER = '// readmate: end short native build dir'
const ROOT_PROJECT_APPLY = 'apply plugin: "com.facebook.react.rootproject"'

const BLOCK = `${MARKER} (plugins/with-short-native-build-dir.js)
def readmateWindows = System.getProperty('os.name').toLowerCase().contains('windows')
def readmateCxxRoot = System.getenv('READMATE_CXX_DIR') ?:
  (readmateWindows && System.getenv('LOCALAPPDATA') ? "\${System.getenv('LOCALAPPDATA')}/rmcxx" : null)
def readmateCmakeVersion = System.getenv('READMATE_CMAKE_VERSION') ?: (readmateWindows ? '3.31.6' : null)
if (readmateCxxRoot || readmateCmakeVersion) {
  subprojects { sub ->
    ['com.android.library', 'com.android.application'].each { id ->
      sub.plugins.withId(id) {
        try {
          if (readmateCxxRoot) sub.android.externalNativeBuild.cmake.buildStagingDirectory = new File(readmateCxxRoot, sub.name)
          if (readmateCmakeVersion) sub.android.externalNativeBuild.cmake.version = readmateCmakeVersion
        } catch (Exception e) {
          logger.lifecycle("readmate: \${sub.name} keeps its CMake settings (\${e.message?.readLines()?.first()})")
        }
      }
    }
  }
}
${END_MARKER}
`

/** Removes an earlier copy of the block (with or without its end marker: the first version had none). */
function withoutBlock(contents) {
  const start = contents.indexOf(MARKER)
  if (start < 0) return contents
  const end = contents.indexOf(END_MARKER, start)
  const before = contents.slice(0, start).replace(/\n+$/, '\n')
  // The first version was appended at the end of the file and had no end marker.
  if (end < 0) return before
  return before + contents.slice(end + END_MARKER.length).replace(/^\n+/, '')
}

/** The root build.gradle with the block placed before the React Native root-project plugin. */
function applyShortNativeBuildDir(contents) {
  const clean = withoutBlock(contents)
  const at = clean.indexOf(ROOT_PROJECT_APPLY)
  if (at < 0) return `${clean.replace(/\n*$/, '\n\n')}${BLOCK}`
  return `${clean.slice(0, at).replace(/\n*$/, '\n\n')}${BLOCK}\n${clean.slice(at)}`
}

module.exports = function withShortNativeBuildDir(config) {
  return withProjectBuildGradle(config, (next) => {
    if (next.modResults.language !== 'groovy') throw new Error('with-short-native-build-dir: expected a Groovy build.gradle')
    next.modResults.contents = applyShortNativeBuildDir(next.modResults.contents)
    return next
  })
}
module.exports.applyShortNativeBuildDir = applyShortNativeBuildDir
