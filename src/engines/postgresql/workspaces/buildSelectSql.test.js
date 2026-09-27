import { describe, it, expect } from 'vitest'
import { buildSelectSql } from './buildSelectSql.js'

const col = (column, table = 0) => ({ table, column })
const base = { schema: 'public', table: 'users', filters: [], orderBy: [], descending: false, limit: 100, offset: 0 }

describe('buildSelectSql', () => {
  it('selects a page of the table', () => {
    expect(buildSelectSql(base)).toBe('SELECT *\nFROM "public"."users"\nLIMIT 100;')
  })

  it('writes each filter as a condition, all of which must hold', () => {
    const filters = [
      { column: 'age', op: 'gte', value: '30' },
      { column: 'name', op: 'contains', value: 'ad' },
      { column: 'email', op: 'isNull' },
      { column: 'role', op: 'ne', value: 'admin' },
      { column: 'ok', op: 'notNull' },
      { column: 'code', op: 'startsWith', value: '5_' },
      { column: 'mcc', op: 'in', value: '5411, 5812,' },
    ]
    expect(buildSelectSql({ ...base, filters })).toBe([
      'SELECT *',
      'FROM "public"."users"',
      'WHERE "age" >= \'30\'',
      '  AND "name"::text ILIKE \'%ad%\'',
      '  AND "email" IS NULL',
      '  AND "role" <> \'admin\'',
      '  AND "ok" IS NOT NULL',
      '  AND "code"::text ILIKE \'5\\_%\'',
      '  AND "mcc" IN (\'5411\', \'5812\')',
      'LIMIT 100;',
    ].join('\n'))
  })

  it('orders every sort column in the one direction, and pages with OFFSET', () => {
    const sql = buildSelectSql({ ...base, orderBy: [col('a'), col('b')], descending: true, offset: 200 })
    expect(sql).toBe('SELECT *\nFROM "public"."users"\nORDER BY "a" DESC, "b" DESC\nLIMIT 100 OFFSET 200;')
  })

  it('selects just the chosen columns, in order', () => {
    expect(buildSelectSql({ ...base, columns: [col('id'), col('n"ame')] })).toBe('SELECT "id", "n""ame"\nFROM "public"."users"\nLIMIT 100;')
  })

  it('quotes names and values so neither can break out of the query', () => {
    const sql = buildSelectSql({
      ...base,
      table: 'we"ird',
      filters: [{ column: 'n"ame', op: 'eq', value: "O'Brien" }, { column: 'note', op: 'contains', value: "50%_off\\'" }],
    })
    expect(sql).toContain('FROM "public"."we""ird"')
    expect(sql).toContain('WHERE "n""ame" = \'O\'\'Brien\'')
    // Contains matches literally, as the table's own filter does.
    expect(sql).toContain('AND "note"::text ILIKE \'%50\\%\\_off\\\\\'\'%\'')
  })

  it('joins related tables, naming every column by its table', () => {
    const joins = [{ schema: 'public', table: 'regions', kind: 'left', column: 'id', equals: col('region_id') }]
    const sql = buildSelectSql({
      ...base, table: 'merchants', joins,
      filters: [{ table: 1, column: 'name', op: 'contains', value: 'so' }],
      orderBy: [col('name', 1)],
    })
    expect(sql).toBe([
      'SELECT "merchants".*, "regions".*',
      'FROM "public"."merchants"',
      'LEFT JOIN "public"."regions" ON "regions"."id" = "merchants"."region_id"',
      'WHERE "regions"."name"::text ILIKE \'%so%\'',
      'ORDER BY "regions"."name" ASC',
      'LIMIT 100;',
    ].join('\n'))
  })

  it('gives a table joined twice a name of its own, and selects chosen columns by table', () => {
    const joins = [{ schema: 'public', table: 'merchants', kind: 'inner', column: 'id', equals: col('parent_id') }]
    const sql = buildSelectSql({ ...base, table: 'merchants', joins, columns: [col('name'), col('name', 1)] })
    expect(sql).toBe([
      'SELECT "merchants"."name", "merchants_2"."name"',
      'FROM "public"."merchants"',
      'JOIN "public"."merchants" AS "merchants_2" ON "merchants_2"."id" = "merchants"."parent_id"',
      'LIMIT 100;',
    ].join('\n'))
  })
})
