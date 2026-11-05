# Decision: `expo-navigation-bar` for the Android navigation bar buttons

**Date**: 2026-11-05 | **Status**: Accepted, not tested on a device | **Needed for**: the system bars follow the app's colours (user request, 2026-11-05)

Version `~57.0.3`, the one Expo 57 pins in `expo/bundledNativeModules.json`. Installed with `npx expo install` (version) and `npm install` in `source/` (the one lockfile).

## Need

With edge-to-edge the status and navigation bars are transparent, and the host already paints the areas behind them in the page's edge colours (`app.setSystemBars`). Two things are left that only the system can do:

- the navigation bar **buttons** must be light on a dark theme (Night, Sepia) and dark on a light one (Paper);
- on 3-button navigation Android draws its own translucent scrim over the bar ("enforce contrast"), which tints the app's colour.

## Alternatives

| Option | Why not |
|---|---|
| Nothing (system default) | Buttons may be unreadable on Paper, and the scrim shows a strip of another colour: the problem the user reported |
| A config plugin of our own setting `windowLightNavigationBar` / `enforceNavigationBarContrast` | Static only (cannot follow the theme at run time); duplicates an Expo-maintained module |
| `react-native-edge-to-edge` `SystemBars` | Outside Expo's pinned set; `expo-status-bar` already covers the status bar |

## Compatibility

| Item | Finding | Source or test |
|---|---|---|
| Expo 57, React Native 0.86 | Pinned for this SDK | `bundledNativeModules.json` |
| Android | `NavigationBar` component (`style`, `hidden`); `style` applies with button navigation when the plugin's `enforceContrast` is `false` | Type declarations in the installed package (`NavigationBar.types.d.ts`, `plugin/build/withNavigationBar.d.ts`) |
| iOS | `expo-module.config.json` lists `android` only; iOS has no navigation bar, and the component renders nothing there. The compatibility rule against Android-only dependencies does not apply: nothing on iOS depends on it | Installed package |
| Expo Go | The component runs; the plugin option (`enforceContrast: false`) needs a native build, so Expo Go may still show the system scrim on 3-button navigation | **Not tested** |
| Apple-silicon build | No iOS code | n/a |

## Licence and maintenance

MIT (npm registry), maintained in the Expo repository.

## Decision and trade-offs

Accepted. `app.json` adds the plugin with `enforceContrast: false` and an initial `style: light` (the default Night theme); `src/app/index.tsx` sets `style` from the luminance of the bottom edge colour, as it does for the status bar icons. Trade-off: with the scrim off, contrast is ours to keep, which the luminance rule does.
