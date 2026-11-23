# Contract: player UI surfaces

All texts from `core/src/i18n/catalogue/{en,vi}/audiobook-player.ts` (and `chrome.ts` for the mini bar), no literal UI
text (`no-ui-literals`), no translated string transformed in code (FR-018). New Vietnamese terms go into
`specs/012-app-ui-i18n/contracts/glossary.md` first:

| English | Tiếng Việt |
|---|---|
| Mini player | Trình phát thu nhỏ |
| Pop out | Mở cửa sổ nổi |
| Return to app | Về ứng dụng |
| Floating window | Cửa sổ nổi |
| Skip back / forward length | Độ dài tua lùi / tới |
| Rewind on resume | Tự lùi khi phát tiếp |

## Full player (`AudioBookScreen`)

- Container `@container` on `<main>`; `@min-[1024px]` → two columns (cover | now-playing, progress summary, scope,
  timeline, notices, transport, secondary row); below → one column.
- `BookProgress` line rendered only when `scope === 'chapter'`; the "x % · time left" text moves next to the scope
  selector in Book scope (single-file only).
- Transport: `⏮  ↺{skipBack}  ▶  {skipForward}↻  ⏭`; skip buttons' label / aria / title use the chosen seconds.
- Secondary row: speed, sleep, "＋ Note", speaker button (mute toggle, `aria-pressed`) + volume slider, and a
  "Listening" menu (skip lengths, rewind on resume).
- Notices use `bg-lib-warning-bg border-lib-warning-border text-lib-warning-text`.
- Note markers drawn in a 10 px strip ABOVE the slider track, 24 × 24 px hit area, never over the thumb.
- Every interactive element carries `focus-ring`.

## Sidebar

- Rail: `SidebarTabIcon` SVGs (shared with the text reader).
- Resize handle: `tabIndex=0`, `role="separator"`, `aria-valuenow/min/max` (px), ← / → ±16 px, Home / End.
- Notes tab: search field (label visible to screen readers, `type="search"`), chapter filter (`AudioSelect`), "Group
  by chapter" toggle (`aria-pressed`), live count `role="status"`, empty state with "Clear".
- Minimum text 12 px.

## Mini player bar (`components/audio/MiniPlayerBar.tsx`)

Height 56 px. `[cover 40px] title · subtitle  [↺n] [▶/⏸] [n↻]  progress  [⧉ Pop out] [✕]`; the whole left part is a
button "Open player" (`aria-label` = title). `role="region"` + `aria-label` "Mini player". A failed track shows the warning colours and the player's actions
"Try again" / "Skip to next track" (when there is one). Hidden when
`miniPlayer:windowChanged { open: true }`.

## Floating window (`?window=mini-player`, own root `screens/MiniPlayerWindow/MiniPlayerWindowRoot.tsx`)

360 × 132 px, draggable body, theme from the DTO: cover, title, subtitle, `↺ ▶ ↻`, a thin seek slider, "Return to
app", ✕. Keyboard: Tab order cover-less; Space = toggle, ← / → = skip while the window is focused. Shows
`trackFailed` with the same warning colours and the player's actions: "Try again", "Skip to next track" (when there
is one) and "Open player". Mounted by `main.tsx` without `App`; reaches Main only through the
`platforms/miniPlayerWindow` adapter.
