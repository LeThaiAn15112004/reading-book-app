# Quickstart: validating spec 014 (Mobile Settings / "More")

## Prerequisites

- `npm install` at the repo root; an Android phone or emulator for the device pass (native build with the local server:
  `npm run android`). Expo Go is development-only and is not the acceptance target.
- Optional second width: an emulator at 320 px wide and a tablet / landscape at ≥ 900 px.

## Automated checks

```bash
npm run sdk:test        # incl. tests/config/app-links.test.ts, tests/settings/phone-settings-nav.test.ts
npm run mobile:test     # existing Mobile suites stay green
npm run check           # typecheck, lint (no UI literals), boundaries, platform adapters, builds, build split
```

Expected: all green. `check:desktop-baseline` needs no new approval (no Main file changed).

## Device pass (Android) — maps to the spec's stories and FRs

1. **Entry & list (US1, FR-001/002/003/010/018)**: the 4th tab reads "More" (en) with the new icon. Tap it → title
   "More", 4 rows (Appearance, Privacy, Advanced, About) with icon, name, description, chevron; no icon rail; no
   Storage / Notifications / Shortcuts rows.
2. **Open & back (US2, FR-004/005/006/016)**: scroll the list a little, tap Appearance → page slides in from the right
   with back + "Appearance". Tap back → slides out, list at the same scroll position. Repeat with the system Back
   button. On the list, system Back behaves as on the Library tab.
3. **Fast input (FR-016 edge)**: tap a row and press Back immediately, several times → never stuck between pages.
4. **Reduced motion**: Android Settings → Accessibility → Remove animations → pages change instantly.
5. **Tab return (FR-006)**: open Privacy, tap Library, tap More → the list, not Privacy.
6. **Building blocks (FR-014)**: Privacy → tap the row text "Save recent Library searches…" (not the switch) → it toggles; the
   row is ≥ 48 dp. Clear data / Reset buttons are red at rest and ≥ 48 dp. No text smaller than 12 px.
7. **Dialogs (FR-005, FR-014)**: open Clear data → tap anywhere on the "Search history" row toggles the checkbox;
   buttons ≥ 48 dp; system Back closes the dialog and stays on Privacy; a second Back returns to the list.
8. **Density (FR-017)**: Appearance has no Density card.
9. **About (FR-019/020/021)**: version equals the installed build (Android Settings → Apps → Readmate → version);
   "Privacy Policy" opens `https://lethaian15112004.github.io/reading-book-app-privacy-policy/` in the browser; "Store
   page" and the Updates card's "Open in store" open the Play Store page of `com.anle.readmate`; no disabled rows, no
   "Not available" badges, no empty group.
10. **Themes & accent (US3, FR-008)**: switch Dark / Light / Sepia and an accent (e.g. blue) in Appearance, go back →
    list and header follow at once; nothing under the status bar or the tab bar.
11. **Language (US4, FR-009)**: Appearance → App Language → Tiếng Việt → tab "Khác", title "Khác", Vietnamese rows,
    back control announced "Quay lại" by TalkBack.
12. **Widths (FR-013, FR-015, SC-003)**: 320 px → no sideways scroll on any page; ≥ 900 px (landscape / tablet) →
    still list → detail, content centred about 640 px wide.

## Desktop pass (SC-006)

`npm run dev`: menubar entry reads "More" / "Khác"; the Settings sidebar title reads "More"; sidebar collapse, sections
and layout unchanged; Density still present; About shows the app's real version (same as Advanced), "Privacy Policy"
opens in the browser, no Store page row, no disabled rows, Updates card as before.

## Known outside-scope item

`docs/store/privacy-policy.html` (source of the hosted policy) is uncommitted and still has TODO markers — finish it
before store submission.
