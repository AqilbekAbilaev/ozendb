import { describe, expect, it, vi } from 'vitest'
import { computed, reactive } from 'vue'

vi.mock('../engines/mongodb/api/transfer', () => ({
  importPreview: vi.fn(),
}))

import { importPreview } from '../engines/mongodb/api/transfer'
import { PREVIEW_LIMIT } from '../constants/dataTools'
import { useImportPreview } from './useImportPreview'

describe('useImportPreview', () => {
  it('loads the selected source into the preview', async () => {
    const tab = reactive({
      id: 'import-1',
      format: 'json',
      selectedSource: 0,
      previewOpen: false,
      sources: [{ path: '/tmp/people.json' }],
    })
    const request = { path: '/tmp/people.json', format: 'json' }
    const lifecycle = {
      beginPreview: vi.fn(() => request),
      cancelPreview: vi.fn(),
      isCurrentPreview: vi.fn(() => true),
    }
    vi.mocked(importPreview).mockResolvedValue({
      columns: ['name'],
      rows: [{ name: 'Ada' }],
    })

    const preview = useImportPreview({
      tab: computed(() => tab),
      activeTab: () => tab,
      lifecycle,
    })
    await preview.loadPreview()

    expect(importPreview).toHaveBeenCalledWith('/tmp/people.json', 'json', PREVIEW_LIMIT)
    expect(preview.columns.value).toEqual(['name'])
    expect(preview.rows.value).toEqual([{ name: 'Ada' }])
    expect(preview.loading.value).toBe(false)
  })
})
