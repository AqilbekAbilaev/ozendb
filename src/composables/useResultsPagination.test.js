import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { useResultsPagination } from './useResultsPagination'

describe('useResultsPagination', () => {
  it('advances from the current page by the tab limit', () => {
    const tab = reactive({ kind: 'collection', state: { query: { skip: 50, limit: 25 } }, runtime: { results: [] } })
    const requery = vi.fn()
    const pagination = useResultsPagination({
      activeTab: () => tab,
      isAggregate: () => false,
      requery,
      showToast: vi.fn(),
    })

    pagination.goNext()

    expect(tab.state.query.skip).toBe(75)
    expect(requery).toHaveBeenCalledWith(false)
  })
})
