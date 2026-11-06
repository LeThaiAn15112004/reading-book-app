import { describe, expect, it } from 'vitest'
import { assertMigrationOrder, planMigrations, splitSqlStatements, type Migration } from '../../src/index.js'

const m = (name: string): Migration => ({ name, sql: `-- ${name}` })
const all = [m('001_a.sql'), m('002_b.sql'), m('003_c.sql')]

describe('planMigrations', () => {
  it('a fresh database gets everything, in order', () => {
    const plan = planMigrations([], all)
    expect(plan.pending.map((x) => x.name)).toEqual(['001_a.sql', '002_b.sql', '003_c.sql'])
    expect(plan.alreadyApplied).toEqual([])
    expect(plan.unknown).toEqual([])
  })

  it('skips what is recorded and keeps the list order, whatever the record order', () => {
    const plan = planMigrations(['002_b.sql', '001_a.sql'], all)
    expect(plan.pending.map((x) => x.name)).toEqual(['003_c.sql'])
    expect(plan.alreadyApplied).toEqual(['001_a.sql', '002_b.sql'])
  })

  it('an up-to-date database has nothing pending', () => {
    expect(planMigrations(new Set(all.map((x) => x.name)), all).pending).toEqual([])
  })

  it('reports recorded migrations this build does not list (a newer app wrote the file) without dropping the rest', () => {
    const plan = planMigrations(['001_a.sql', '099_future.sql'], all)
    expect(plan.unknown).toEqual(['099_future.sql'])
    expect(plan.pending.map((x) => x.name)).toEqual(['002_b.sql', '003_c.sql'])
  })

  it('refuses a list that is not in strictly increasing order', () => {
    expect(() => planMigrations([], [m('002_b.sql'), m('001_a.sql')])).toThrow(/strictly increasing/)
    expect(() => assertMigrationOrder([m('001_a.sql'), m('001_a.sql')])).toThrow(/strictly increasing/)
    expect(() => assertMigrationOrder(all)).not.toThrow()
  })
})

describe('splitSqlStatements', () => {
  it('splits on ; and drops empty statements', () => {
    expect(splitSqlStatements('CREATE TABLE a (x);;\n INSERT INTO a VALUES (1);')).toEqual(['CREATE TABLE a (x)', 'INSERT INTO a VALUES (1)'])
  })

  it('ignores ; inside quotes and comments', () => {
    expect(splitSqlStatements(`INSERT INTO a VALUES ('x;y'); -- tail; comment\n/* a; b */ SELECT 1;`)).toEqual([`INSERT INTO a VALUES ('x;y')`, 'SELECT 1'])
  })

  it('keeps a trigger body in one statement', () => {
    const trigger = 'CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET n = n + 1; DELETE FROM c; END'
    expect(splitSqlStatements(`${trigger};\nSELECT 1;`)).toEqual([trigger, 'SELECT 1'])
  })
})
