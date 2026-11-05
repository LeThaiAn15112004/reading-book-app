# Contract: SQL Driver Ports and Database Logic in Core

Implements the user's "core holds DB SQLite" (spec Clarifications) under FR-011 (core imports no driver). Research R3.

## Ports (`source/core/src/db/driver.ts`)

```ts
type SqlValue = string | number | bigint | null | Uint8Array
interface Statement { sql: string; params: readonly SqlValue[] }

interface SyncSqlDriver {                 // Desktop: better-sqlite3, in Electron Main
  run(s: Statement): { changes: number; lastInsertRowid: number | bigint }
  all<Row>(s: Statement): Row[]
  get<Row>(s: Statement): Row | undefined
  transaction<T>(work: () => T, mode?: 'deferred' | 'immediate'): T   // no await inside, ever
}

interface AsyncSqlDriver {                // Mobile: host services over postMessage
  run(s: Statement): Promise<{ changes: number; lastInsertRowId: number }>
  all<Row>(s: Statement): Promise<Row[]>
  transaction(statements: readonly Statement[]): Promise<void>        // all or nothing on the host
}
```

## What core holds

| In `source/core/src/db/` | Example |
|---|---|
| Migrations per app, byte-identical to today | `desktop/migrations/001_initial.sql` … `030_*.sql`; `mobile/migrations/001_baseline.sql` |
| Migration runner logic (pure: which files, in which order, version check) | `planMigrations(applied, available)` |
| Statement builders, one module per store | `library/statements.ts`: `selectBookById(id): Statement` |
| Row ⇄ domain codecs | `library/codec.ts`: `bookFromRow(row)`, `bookToRow(book)` |
| Write planning (what to insert / update / delete) | overlay merge-patch of `reading_state_json`, content keys |

## What stays in `platforms/`

The driver implementation, the connection, the control flow of each store method (sync on Desktop, async on Mobile),
transactions (Desktop: `driver.transaction(() => …)` with the synchronous import commit unchanged; Mobile: a statement
batch), file access, and anything that needs `fs`, `better-sqlite3`, `expo-sqlite`, Electron or React Native.

## Rules

- Core never imports a driver package, `node:*`, Electron, React Native or the DOM (checked by `check:boundaries`).
- A Desktop migration file is never edited; its SHA-256 is listed in `check:desktop-baseline`.
- A store moved to core statements must keep its existing spikes and Mobile tests green in the same step.
