/** Fake chapters for T3.0 SCR-03 — not tied to real EPUB/PDF bytes. */

export type FakeChapter = {
  num: string
  title: string
  paragraphs: string[]
}

export const FAKE_CHAPTERS: FakeChapter[] = [
  {
    num: '1',
    title: 'Dynamic Systems',
    paragraphs: [
      'A system appears everywhere around us — from a living organism to the machinery of a city or the climate of the planet. A system is not a random pile of parts; it is an organized whole designed to achieve a function or purpose.',
      'Picture a bathtub with the faucet running and the drain open. Water in the tub is the stock. Water from the faucet is inflow. Water leaving the drain is outflow. Balance depends on the relative rates of those two flows.',
      'Stocks are the foundation of every system. They change slowly and often act as buffers against sudden shocks. Flows, by contrast, move continuously under the control of feedback information.',
      'When you open a book in Readmate Reader, this placeholder text stands in for the real document until the EPUB (or other format) renderer is wired. You can scroll, jump sections from the sidebar, and try reading settings without waiting on file parsing.',
      'The goal of this shell is content-first reading: chrome stays available when you need it, and the page itself remains the focus. Later stages will replace these paragraphs with true document content while keeping the same Reader shell.',
    ],
  },
  {
    num: '2',
    title: 'Feedback Loops',
    paragraphs: [
      'Feedback loops are the self-regulating core of every system. There are two main kinds: balancing feedback and reinforcing feedback.',
      'Balancing feedback works like a room thermostat. When temperature rises past a threshold, cooling turns on and pulls it back down. The loop resists change and steers the system toward a stable target.',
      'Reinforcing feedback does the opposite — it multiplies. Like compound interest or a chain reaction, growth in the stock increases inflow, which grows the stock further. That pattern drives runaway growth or cascading collapse.',
      'Use the location scrubber in the footer to jump between these fake sections. The label shows where you are (section title), not a completion percentage — matching the product rule for last-read location.',
      'Use Hand to browse or Select for native text selection.',
    ],
  },
]

/** Location label for scrubber — section title, not a "chapter" assumption. */
export function chapterLocationLabel(index: number): string {
  const n = Math.min(Math.max(index, 0), FAKE_CHAPTERS.length - 1)
  return FAKE_CHAPTERS[n]?.title ?? `Section ${n + 1}`
}
