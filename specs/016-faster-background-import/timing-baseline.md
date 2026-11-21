# Timing baseline and acceptance results (spec 016)

Samples are named by format and size only (FR-001). Machine / device: _not recorded yet_.

## Targets (T020 decision)

| Criterion | Target | Decision |
|---|---|---|
| SC-002 (Desktop, large PDF / EPUB) | ≥ 40 % less import time | **Kept at 40 %** (user, 2026-11-21) |
| SC-009 (phone, large books) | ≥ 30 % less import time | Default kept (not lowered) |

The baseline figures themselves (quickstart §1) are still to be written below; T020 stays open until they are.

## Baseline — before (commit f1246a9)

| Host | Format | Size | Step | Duration |
|---|---|---|---|---|
| _pending_ | | | | |

SC-003 / SC-004 baseline (T014): _pending — method: screen recording at 60 fps, frames counted._

## After (branch 016)

| Host | Format | Size | Step | Duration |
|---|---|---|---|---|
| _pending_ | | | | |

User note (2026-11-21): imports felt "quite fast" on the real machine; no figures yet, so SC-002 / SC-003 / SC-004 /
SC-005 are not marked pass.

## Accessibility (T079)

| Check | Result |
|---|---|
| Contrast ≥ 4.5 : 1, card / pill / list / placeholders, light + dark | **Pass** (user, 2026-11-21) |
| Keyboard: Tab order pill → actions, Esc collapses | _pending_ |
| Screen reader: elapsed counter not read, step changes announced | _pending_ |

## Quickstart acceptance (T082)

Import flow (Add file, background queue, pill / card, cancel, batch summary) **accepted by the user on the real
machine** (2026-11-21). Per-step figures and the SC-007 three-person check are not recorded.
