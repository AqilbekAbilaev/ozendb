import { describe, it, expect } from 'vitest'
import { joinOffers } from './joinOffers.js'

const fk = (from, to) => {
  const [fromSchema, fromTable, fromColumn] = from.split('.')
  const [toSchema, toTable, toColumn] = to.split('.')
  return { fromSchema, fromTable, fromColumn, toSchema, toTable, toColumn }
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
      { schema: 'public', table: 'regions', column: 'id', equals: 'region_id', label: 'regions (linked by merchants.region_id)' },
      { schema: 'billing', table: 'payments', column: 'merchant_id', equals: 'id', label: 'billing.payments (linked by payments.merchant_id)' },
    ])
  })

  it('follows keys from joined tables too, and never offers a table already in the tab', () => {
    const regions = { key: 'j1', schema: 'public', table: 'regions' }
    expect(joinOffers([merchants, regions], keysByTable).map(o => [o.table, o.equals])).toEqual([
      ['payments', 'id'],
      ['countries', 'j1.country_code'],
    ])
  })

  it('offers nothing while a table\'s keys are still unknown', () => {
    expect(joinOffers([merchants], {})).toEqual([])
  })
})
