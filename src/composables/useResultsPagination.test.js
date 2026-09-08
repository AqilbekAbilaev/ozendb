import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { useResultsPagination } from './useResultsPagination'

describe('useResultsPagination', () => {
  it('advances from the current page by the tab limit', () => {
    const tab = reactive({ kind: 'collection', skip: 50, limit: 25, results: [] })
    const requery = vi.fn()
    const pagination = useResultsPagination({
      activeTab: () => tab,
      isAggregate: () => false,
      requery,
      showToast: vi.fn(),
    })

    pagination.goNext()

    expect(tab.skip).toBe(75)
    expect(requery).toHaveBeenCalledWith(false)
  })
})
