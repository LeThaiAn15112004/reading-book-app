# Import spikes (spec 016)

Standalone checks for the faster background import. They are not part of the app build; run them from the repository
root with `npm run spike:import:<name>`.

| Script | What it checks |
|---|---|
| `run-import-timing.mjs` (`spike:import:timing`) | Reads `{userData}/logs/timing.jsonl` (written when the app runs with `READMATE_TIMING=1`) and prints a table per format, size bucket and step. `--label <name>` tags a run (`baseline`, `after`); `--file <path>` reads another file. Fails when a line has a key outside the `StepTiming` fields (no title, file name or path may appear — FR-001). |
| `capture-baseline-rows.mjs` | Run once on the code before story 2: imports the sample set and writes the `books` rows and cover fingerprints to `fixtures/baseline-rows.json`. Kept after the feature as the reference of FR-007. |
| `run-import-parity.mjs` (`spike:import:parity`) | Imports the sample set with the new pipeline and compares every row and cover with `fixtures/baseline-rows.json` (FR-007 / SC-002). |
| `run-import-queue.mjs` (`spike:import:queue`) | The real `importQueueStore` with a scriptable fake `importApi`: order, cancel, Saving not cancellable, duplicates, batch summary, ZIP job, cancel-all, snapshot restore. Automated only. |
| `run-import-cleanup.mjs` (`spike:import:cleanup`) | 20 cancelled / failed / killed imports, then the startup sweep: no row, no app-owned copy, no cover left, sources unchanged (SC-006). |

Sample files live outside the repository and outside `{userData}`; reports name them only by format and size.
