import { describe, it, expect } from 'vitest'
import { buildInsertSql, buildUpdateSql, buildDeleteSql } from './buildStagedSql.js'

describe('buildInsertSql', () => {
  it('lays out columns and values one per line, indented under their clause', () => {
    expect(buildInsertSql('public.users', ['id', 'name', 'email'], ['42', "'Ann'", "'ann@example.com'"])).toBe([
      'INSERT INTO public.users (',
      '  id,',
      '  name,',
      '  email',
      ') VALUES (',
      '  42,',
      "  'Ann',",
      "  'ann@example.com'",
      ');',
    ].join('\n'))
  })

  it('still works for a single column', () => {
    expect(buildInsertSql('public.users', ['id'], ['1'])).toBe('INSERT INTO public.users (\n  id\n) VALUES (\n  1\n);')
  })

  it("leaves a multi-line value's own lines alone, so the literal reads as it will be stored", () => {
    expect(buildInsertSql('public.notes', ['body'], ["'line one\nline two'"])).toBe(
      "INSERT INTO public.notes (\n  body\n) VALUES (\n  'line one\nline two'\n);",
    )
  })
})

describe('buildUpdateSql', () => {
  it('puts SET on its own line with one indented assignment per line', () => {
    expect(buildUpdateSql('public.users', ["name = 'Ann'", "email = 'x'"], 'id = 42')).toBe([
      'UPDATE public.users',
      'SET',
      "  name = 'Ann',",
      "  email = 'x'",
      'WHERE id = 42;',
    ].join('\n'))
  })

  it('still works for a single SET clause', () => {
    expect(buildUpdateSql('public.users', ["qty = 1"], 'id = 1')).toBe('UPDATE public.users\nSET\n  qty = 1\nWHERE id = 1;')
  })
})

describe('buildDeleteSql', () => {
  it('lays out one deleted row per line, indented', () => {
    expect(buildDeleteSql('public.users', 'id', ['(1)', '(2)'])).toBe([
      'DELETE FROM public.users',
      'WHERE (id) IN (',
      '  (1),',
      '  (2)',
      ');',
    ].join('\n'))
  })

  it('handles a composite key', () => {
    expect(buildDeleteSql('public.line_items', 'order_id, line_no', ['(1, 1)'])).toBe(
      'DELETE FROM public.line_items\nWHERE (order_id, line_no) IN (\n  (1, 1)\n);',
    )
  })
})
