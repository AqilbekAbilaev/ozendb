import { describe, it, expect } from 'vitest'
import { joinOffers } from './joinOffers.js'

const fk = (from, to) => {
  const [fromSchema, fromTable, fromColumns] = from.split('.')
  const [toSchema, toTable, toColumns] = to.split('.')
  return { fromSchema, fromTable, fromColumns: fromColumns.split('+'), toSchema, toTable, toColumns: toColumns.split('+') }
}
const merchants = { key: '', schema: 'public', table: 'merchants' }
const keysByTable = {
  'public.merchants': [
    fk('public.merchants.region_id', 'public.regions.id'),
    fk('billing.payments.merchant_id', 'public.merchants.id'),
    fk('public.merchants.parent_id', 'public.merchants.id'),
  ],
  'public.regions': [
    fk('public.merchants.region_id', 'public.regions.id'),
    fk('public.regions.country_code', 'public.countries.code'),
  ],
}

describe('joinOffers', () => {
  it('offers each table linked to the browsed one, whichever side holds the key', () => {
    expect(joinOffers([merchants], keysByTable)).toEqual([
      { schema: 'public', table: 'regions', on: [{ column: 'id', equals: 'region_id' }], label: 'regions (linked by merchants.region_id)' },
      { schema: 'billing', table: 'payments', on: [{ column: 'merchant_id', equals: 'id' }], label: 'billing.payments (linked by payments.merchant_id)' },
    ])
  })

  it('follows keys from joined tables too, and never offers a table already in the tab', () => {
    const regions = { key: 'j1', schema: 'public', table: 'regions' }
    expect(joinOffers([merchants, regions], keysByTable).map(o => [o.table, o.on[0].equals])).toEqual([
      ['payments', 'id'],
      ['countries', 'j1.country_code'],
    ])
  })

  it('matches a key over several columns on every pair', () => {
    const keys = { 'public.refs': [fk('public.refs.a+b', 'public.pairs.x+y')] }
    expect(joinOffers([{ key: '', schema: 'public', table: 'refs' }], keys)).toEqual([
      { schema: 'public', table: 'pairs', on: [{ column: 'x', equals: 'a' }, { column: 'y', equals: 'b' }], label: 'pairs (linked by refs.a, b)' },
    ])
  })

  it('offers nothing while a table\'s keys are still unknown', () => {
    expect(joinOffers([merchants], {})).toEqual([])
  })
})
