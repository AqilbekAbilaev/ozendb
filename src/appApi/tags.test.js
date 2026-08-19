import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { getNodeTags, setConnectionTag, setNodeTag, clearNodeTagsUnder } from './tags'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getNodeTags', () => {
  it('invokes get_node_tags without arguments', async () => {
    invoke.mockResolvedValue({})
    await getNodeTags()
    expect(invoke).toHaveBeenCalledWith('get_node_tags')
  })
})

describe('setConnectionTag', () => {
  it('passes the connection id and color through to set_connection_tag', async () => {
    invoke.mockResolvedValue(null)
    await setConnectionTag('c1', 'red')
    expect(invoke).toHaveBeenCalledWith('set_connection_tag', { id: 'c1', color: 'red' })
  })
})

describe('setNodeTag', () => {
  it('passes the key and color through to set_node_tag', async () => {
    invoke.mockResolvedValue(null)
    await setNodeTag('c1::db1', 'blue')
    expect(invoke).toHaveBeenCalledWith('set_node_tag', { key: 'c1::db1', color: 'blue' })
  })
})

describe('clearNodeTagsUnder', () => {
  it('passes the prefix through to clear_node_tags_under', async () => {
    invoke.mockResolvedValue(null)
    await clearNodeTagsUnder('c1::')
    expect(invoke).toHaveBeenCalledWith('clear_node_tags_under', { prefix: 'c1::' })
  })
})