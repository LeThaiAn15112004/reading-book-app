/**
 * Migration planning shared by both runners (spec 009 T031, contracts/sql-drivers.md): which migrations are pending, in
 * which order, and whether the database knows migrations this build does not. The runners (Desktop: better-sqlite3,
 * synchronous; Mobile: host `sql.transaction` batches) only execute the plan.
 */

export interface Migration {
  /** `NNN_name.sql`; applied in this order, each once. */
  name: string
  sql: string
}

export interface MigrationPlan {
  /** Not yet applied, in the order they must run. */
  pending: Migration[]
  /** Listed by this build and already recorded in `schema_migrations`, in list order. */
  alreadyApplied: string[]
  /** Recorded in the database but not listed by this build: written by a newer version. */
  unknown: string[]
}

/** Throws when `available` is not in strictly increasing name order (the order they are applied in). */
export function assertMigrationOrder(available: readonly Migration[]): void {
  const names = available.map((m) => m.name)
  if (names.some((n, i) => i > 0 && n <= names[i - 1]!)) {
    throw new Error(`Migrations must be in strictly increasing order: ${names.join(', ')}`)
  }
}

export function planMigrations(applied: Iterable<string>, available: readonly Migration[]): MigrationPlan {
  assertMigrationOrder(available)
  const done = new Set(applied)
  const names = new Set(available.map((m) => m.name))
  return {
    pending: available.filter((m) => !done.has(m.name)),
    alreadyApplied: available.filter((m) => done.has(m.name)).map((m) => m.name),
    unknown: [...done].filter((n) => !names.has(n)),
  }
}

/**
 * Splits a SQL script into single statements. Aware of quotes ('', "", ``, []), `--` and block comments, and of
 * `BEGIN … END` bodies (triggers), so a `;` inside any of them does not split. Empty statements are dropped.
 */
export function splitSqlStatements(script: string): string[] {
  const out: string[] = []
  let current = ''
  let depth = 0
  let word = ''
  const flushWord = () => {
    const w = word.toUpperCase()
    if (w === 'BEGIN' && /CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER/i.test(current)) depth++
    else if (w === 'END' && depth > 0) depth--
    word = ''
  }
  for (let i = 0; i < script.length; i++) {
    const c = script[i]!
    const next = script[i + 1]
    if (c === '-' && next === '-') {
      flushWord()
      const end = script.indexOf('\n', i)
      i = end < 0 ? script.length : end
      current += '\n'
      continue
    }
    if (c === '/' && next === '*') {
      flushWord()
      const end = script.indexOf('*/', i + 2)
      i = end < 0 ? script.length : end + 1
      current += ' '
      continue
    }
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      flushWord()
      const close = c === '[' ? ']' : c
      let j = i + 1
      while (j < script.length) {
        if (script[j] === close) {
          if (close !== ']' && script[j + 1] === close) j += 2
          else break
        } else j++
      }
      current += script.slice(i, j + 1)
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      word += c
      current += c
      continue
    }
    flushWord()
    if (c === ';' && depth === 0) {
      if (current.trim()) out.push(current.trim())
      current = ''
      continue
    }
    current += c
  }
  flushWord()
  if (current.trim()) out.push(current.trim())
  return out
}
