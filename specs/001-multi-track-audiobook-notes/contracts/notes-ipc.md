# Contract: audiobook Notes over IPC (changed semantics, no new channel)

Channels (unchanged names, `electron/ipc/channels.ts` → `AudioChannels`): `audio:getBookmarks`, `audio:saveBookmarks`. Preload and `src/bridge/audio.ts` already forward them untouched.

## Type change (`electron/ipc/api-types.ts`)

```ts
export interface AudioBookmarkDto {
  id: string
  label: string
  positionSeconds: number      // single-file: seconds in the file; track Note: seconds inside its track
  note?: string
  chapterId?: string           // single-file only
  chapterOffsetSeconds?: number
  createdAt: string
  trackId?: string             // NEW — present on multi-track audiobook Notes only
}
```

## `audio:getBookmarks(bookId: string) → AudioBookmarkDto[]`

| Book | Result |
|---|---|
| empty / unknown id, not an audiobook | `[]` (unchanged) |
| single-file audiobook | stored Notes, sanitized, sorted by position — **identical to today**; any stray `trackId` is not returned |
| multi-track audiobook | the raw stored array is partitioned first; entries with a missing or foreign `trackId` are skipped (they do not count towards the 500), the owned ones are sanitized and capped at 500. Order is not part of the contract (the renderer orders). |

Never throws for damaged JSON; returns what is valid. A rejected call is treated by the renderer as "Notes unavailable", not as an empty list.

## `audio:saveBookmarks({ bookId, bookmarks }) → { ok: boolean }`

The handler sanitizes `bookmarks` (now keeping `trackId`), then Main applies the ownership rule. The list **replaces** the stored one.

| Book | Accepted when | Otherwise |
|---|---|---|
| single-file audiobook | no Note has a `trackId` | `{ ok:false }`, nothing written |
| multi-track audiobook | every incoming Note has a `trackId` that is a track of **this** book | `{ ok:false }`, nothing written (atomic) |
| not an audiobook / unknown id | — | `{ ok:false }` (unchanged) |

**Cap**: for a multi-track book, a raw `bookmarks` array longer than 500 is refused as a whole (`{ ok:false }`, nothing written, no truncation) — the check must see the raw array, so the handler passes it to the store, which sanitizes itself (today the handler sanitizes first, `audio.ipc.ts` line ~62, and the store again at `sqlite-audio-store.ts` line ~35, and the sanitizer would silently cut to 500). Exactly 500 is accepted. Single-file: unchanged silent truncation to the first 500.

Multi-track success writes `incoming + stored foreign entries`: stored entries whose `trackId` is missing or not owned are carried over — the raw stored array is partitioned into owned and foreign entries before either set is sanitized, and the foreign set is sanitized on its own, so it is preserved in canonical form and never cut by the 500 cap of the owned set (they were never returned by `audio:getBookmarks`, so the renderer cannot have removed them). Single-file success replaces the list as before.

Side effects on success: only `reading_state_json.audioBookmarks` and `updated_at` change; `audioProgress` and every other key are preserved (`json_patch`).

This replaces the previous multi-track behaviour (`getBookmarks → []`, `saveBookmarks → ok:false` for every multi-track book).

## Renderer obligations

- Multi-track: after `ok:false`, reload via `getBookmarks` and tell the user; do not keep showing unsaved Notes.
- Single-file: unchanged (result not inspected).
- Never send paths; only ids, seconds and text cross IPC.

## Out of contract (explicitly not added)

No export, share, sync, import or download channel; no per-track query; no pagination (≤ 500 entries).
