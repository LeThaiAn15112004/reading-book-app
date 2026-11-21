# Contract: the opening screen (both hosts, every format)

Component `components/reader/ReaderOpeningScreen.tsx`, driven only by `readerOpeningStore` (R1). Used by
`ReaderScreen`, `MobileReaderScreen` and `AudioBookScreen`. Replaces the loading state of `ReaderOpenStatus`, the EPUB
overlay (`opening` / `rendering`) and the PDF loading line.

## Layout

```
┌──────────────────────────────────────────┐
│ ← Back to Library                         │  always (44 × 44 on the phone, focusable on Desktop)
│                                          │
│             ┌────────┐                   │
│             │ cover  │  (BookCover, or   │  still frame at once (≤ 100 ms)
│             └────────┘   generated style)│
│           Book title (2 lines max)       │
│                                          │
│        ▬▬▬▬▬▬▬▬▬▬ (indeterminate)          │  only after 300 ms without a first page
│        Preparing the first page…         │  step line
│        Large books can take a little     │  after 5 s
│        longer.                           │
└──────────────────────────────────────────┘
```

Covers the renderer host (`position: absolute; inset: 0`, opaque `--lib-bg-deep`); the renderer mounts beneath it.
Fades out (opacity 150 ms; none under reduced motion) on `firstPage`; focus then goes to the reading surface.

## Step lines (i18n `reader.opening.*`, en + vi)

| Step | Key | en |
|---|---|---|
| content | `step.content` | Opening the book… |
| prepare | `step.prepare` | Preparing the first page… |
| position | `step.position` | Going back to where you left off… |
| — | `slow` | Large books can take a little longer. |
| — | `positionLost` (note after opening, 6 s, dismissible) | Couldn't return to where you left off. Opened at the start of the chapter. |

Never "loading the file" / "tải tệp" for a book on the device.

## Error state (same screen)

Cover + title stay; the bar is replaced by an icon, a title "Couldn't open this book" and the cause line
(`reader.opening.error.<cause>`), then the actions of `actionsFor(error)` (data-model). First action receives focus.
`role="alert"` on the cause line.

## Back

- On-screen Back, system Back (phone, `useBackClose`-style handler while the screen shows), Esc (Desktop).
- Calls `readerOpeningStore.leave()` → aborts the step signals → navigates as today's `leaveToLibrary` (flush is a
  no-op: nothing was read yet). Within 1 s (SC-003).

## Accessibility

- Container `role="status"` `aria-busy="true"` with an `aria-label` "Opening {title}" announced once; the step line is
  `aria-live="off"` (visible only); error → `role="alert"`.
- Indicator: `motion-safe:animate-…`; under reduced motion a static bar.
- Contrast ≥ 4.5 : 1 with `--lib-*` tokens in both themes.

## Audiobooks

`AudioBookScreen` uses the same screen for its preflight wait and error; the player itself is unchanged.
