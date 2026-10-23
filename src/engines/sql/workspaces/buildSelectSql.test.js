import { describe, it, expect } from 'vitest'
import { buildSelectSql } from './buildSelectSql.js'
import { dialect } from '../../postgresql/sql.js'
import { dialect as mysql } from '../../mysql/sql.js'

const col = (column, table = 0) => ({ table, column })
const base = { schema: 'public', table: 'users', filters: [], orderBy: [], descending: false, limit: 100, offset: 0 }

describe('buildSelectSql', () => {
  it('selects a page of the table', () => {
    expect(buildSelectSql(dialect, base)).toBe('SELECT *\nFROM "public"."users"\nLIMIT 100;')
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
    expect(buildSelectSql(dialect, { ...base, filters })).toBe([
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

  it('writes each value as the dialect reads its column\'s type', () => {
    const filters = [
      { column: 'flag ü', op: 'eq', value: 'true', dataType: 'tinyint(1)' },
      { column: 'amount', op: 'in', value: '1.5, 2e1', dataType: 'decimal(10,2)' },
      { column: 'at', op: 'gt', value: '2024-01-01 05:00:00+05:00', dataType: 'timestamp' },
      { column: 'at', op: 'contains', value: '2024-01-01 05:00:00+05:00', dataType: 'timestamp' },
      { column: 'note', op: 'ne', value: '5', dataType: 'text' },
    ]
    expect(buildSelectSql(mysql, { ...base, schema: 'shop', filters })).toBe([
      'SELECT *',
      'FROM `shop`.`users`',
      'WHERE `flag ü` = 1',
      '  AND `amount` IN (1.5, 20)',
      "  AND `at` > '2024-01-01 00:00:00'",
      "  AND CONVERT(`at` USING utf8mb4) COLLATE utf8mb4_general_ci LIKE '%2024-01-01 00:00:00%'",
      "  AND `note` <> '5'",
      'LIMIT 100;',
    ].join('\n'))
  })

  it('writes PostgreSQL\'s values quoted whatever their type', () => {
    const filters = [{ column: 'ok', op: 'eq', value: 'true', dataType: 'boolean' }, { column: 'n', op: 'in', value: '1, 2', dataType: 'numeric' }]
    expect(buildSelectSql(dialect, { ...base, filters })).toBe('SELECT *\nFROM "public"."users"\nWHERE "ok" = \'true\'\n  AND "n" IN (\'1\', \'2\')\nLIMIT 100;')
  })

  it('orders every sort column in the one direction, and pages with OFFSET', () => {
    const sql = buildSelectSql(dialect, { ...base, orderBy: [col('a'), col('b')], descending: true, offset: 200 })
    expect(sql).toBe('SELECT *\nFROM "public"."users"\nORDER BY "a" DESC, "b" DESC\nLIMIT 100 OFFSET 200;')
  })

  it('selects just the chosen columns, in order', () => {
    expect(buildSelectSql(dialect, { ...base, columns: [col('id'), col('n"ame')] })).toBe('SELECT "id", "n""ame"\nFROM "public"."users"\nLIMIT 100;')
  })

  it('quotes names and values so neither can break out of the query', () => {
    const sql = buildSelectSql(dialect, {
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
    const joins = [{ schema: 'public', table: 'regions', kind: 'left', on: [{ column: 'id', equals: col('region_id') }] }]
    const sql = buildSelectSql(dialect, {
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
    const joins = [{ schema: 'public', table: 'merchants', kind: 'inner', on: [{ column: 'id', equals: col('parent_id') }] }]
    const sql = buildSelectSql(dialect, { ...base, table: 'merchants', joins, columns: [col('name'), col('name', 1)] })
    expect(sql).toBe([
      'SELECT "merchants"."name", "merchants_2"."name"',
      'FROM "public"."merchants"',
      'JOIN "public"."merchants" AS "merchants_2" ON "merchants_2"."id" = "merchants"."parent_id"',
      'LIMIT 100;',
    ].join('\n'))
  })

  it('matches a join on every pair of a key over several columns', () => {
    const joins = [{ schema: 'public', table: 'pairs', kind: 'inner', on: [{ column: 'a', equals: col('x') }, { column: 'b', equals: col('y') }] }]
    expect(buildSelectSql(dialect, { ...base, joins })).toContain('JOIN "public"."pairs" ON "pairs"."a" = "users"."x" AND "pairs"."b" = "users"."y"')
  })
})
