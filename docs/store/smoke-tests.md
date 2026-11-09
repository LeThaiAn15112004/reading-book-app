# Smoke tests for the installed Store package

> Spec 010 (FR-019, T035). Run by hand on the **installed** (test-signed) Store package, on a Windows 10 1809+ / 11
> x64 machine that never had Readmate installed (T040), before every submission. One column per release: `pass`,
> `fail (reason)`, or `—` (not run). E2E stays manual-only; nothing here is automated except where noted.
>
> **Before the first row:** the package must contain spec 010 T026–T027 (own userData `Readmate Reader Store`). A
> package without them writes into the installer build's `%APPDATA%\reading-book-desktop` (found 2026-11-08). Back that
> folder up on a machine that has it.

| # | Check | How | 1.0.0 |
|---|---|---|---|
| 1 | Own data folder | Start the app once, quit. `%LOCALAPPDATA%\Packages\<PFN>\LocalCache\Roaming\Readmate Reader Store\reading-book.db` exists; `%APPDATA%\reading-book-desktop` (if present) has the same file hashes as before (`spike:store:packaged` S1). | pass 2026-11-09 (manual; `.db` hash + LastWriteTime of the whole folder, T038) |
| 2 | Import a local EPUB | Library → Import → a `.epub` from Documents. The book appears; its path stays the original one (book menu → Copy file path). | — |
| 3 | Import a local PDF | Same with a `.pdf`. | — |
| 4 | Import a local TXT | Same with a `.txt`. | — |
| 5 | Import a local MD | Same with a `.md`. | — |
| 6 | Each format opens and remembers its position | Open each book from 2–5, move forward, close the book, reopen: same place. | — |
| 7 | PDF highlight written into the user's own file | Highlight text in the PDF of row 3, wait a few seconds, open the same file in another PDF reader: the highlight is there. | — |
| 8 | PDF attachment opens in the default viewer | Attachment tab of a PDF with an embedded file → double-click → confirm: the default app opens it (path mapped by `pathForOtherApps`, S4). | — |
| 9 | "Show in folder" for a managed (URL-imported) book | Import a book from a URL, book menu → Show in folder: Explorer opens with the file selected (S4). | — |
| 10 | An audiobook plays and seeks | Import an `.mp3` / `.m4b`, play, drag the timeline, pause, resume. | — |
| 11 | Cloud sign-in returns to the app | Settings → Cloud Sources → link Google Drive / Dropbox / OneDrive: the browser hands back to the running app and the account shows as linked (`readmate-reader:` link, S2). | fail 2026-11-09 (client IDs empty in packaged builds — KL-1 in the implementation map) |
| 12 | Tray / run in background | Settings → Background: tray on + Run in Background on, close the window: the tray icon stays; reopen from it; Quit from the tray quits. | — |
| 13 | Reading-reminder toast | Notifications on, Settings → Notifications → send a test reminder: a Windows toast with the name **Readmate Reader** and its icon (package AUMID, S2). | — |
| 14 | Start at Login on | Settings → Background → Start at Login on. Sign out and back in: the app starts hidden in the tray (`--hidden-at-startup` in its command line, S2). | — |
| 15 | Start at Login off in Windows Settings | Windows Settings → Apps → Startup → Readmate Reader off. Back in the app (focus the window): the switch shows off, is locked, says "Turned off in Windows Settings → Startup", and "Open Startup settings" opens that page. | — |
| 16 | Updates screen names the Microsoft Store | Settings → Advanced → Check for Updates: "This copy was installed from the Microsoft Store, which delivers updates…"; no other update route. Current Version = the package version. | — |
| 17 | Icons sharp in light and dark themes | Start menu tile, taskbar, title bar, Alt+Tab — Windows light and dark themes (FR-012). | — |
| 18 | Uninstall leaves the user's files | `Get-AppxPackage *ReadMateReader* \| Remove-AppxPackage`. The books in Documents are still there; the PDF from row 7 still has its highlight; `%APPDATA%\reading-book-desktop` (if present) is unchanged. | — |
