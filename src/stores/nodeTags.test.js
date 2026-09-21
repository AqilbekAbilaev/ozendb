import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('../engines/mongodb/api/connections', () => ({ listConnections: vi.fn() }))
vi.mock('../appApi/tags', () => ({ getNodeTags: vi.fn() }))

import { listConnections } from '../engines/mongodb/api/connections'
import { getNodeTags } from '../appApi/tags'
import { tagOverrides, loadNodeTags } from './nodeTags'

beforeEach(() => {
  vi.resetAllMocks()
  tagOverrides.value = {}
})

it('loads database/collection tags from the node-tag store and connection tags from the configs', async () => {
  getNodeTags.mockResolvedValue({ 'c1/db': 'green', 'c1/db/orders': 'red' })
  listConnections.mockResolvedValue([{ id: 'c1', tag: 'blue' }, { id: 'c2' }])
  await loadNodeTags()
  expect(tagOverrides.value).toEqual({ 'c1/db': 'green', 'c1/db/orders': 'red', c1: 'blue' })
})

// The two sources are independent stores; one being unreadable must not lose the other.
it('still loads connection tags when the node-tag store fails', async () => {
  getNodeTags.mockRejectedValue(new Error('nope'))
  listConnections.mockResolvedValue([{ id: 'c1', tag: 'blue' }])
  await loadNodeTags()
  expect(tagOverrides.value).toEqual({ c1: 'blue' })
})

it('still loads node tags when the connection list fails', async () => {
  getNodeTags.mockResolvedValue({ 'c1/db': 'green' })
  listConnections.mockRejectedValue(new Error('nope'))
  await loadNodeTags()
  expect(tagOverrides.value).toEqual({ 'c1/db': 'green' })
})

it('keeps a tag applied before the load finished', async () => {
  getNodeTags.mockResolvedValue({ 'c1/db': 'stale' })
  listConnections.mockResolvedValue([])
  tagOverrides.value = { 'c1/db': 'fresh' }
  await loadNodeTags()
  expect(tagOverrides.value['c1/db']).toBe('fresh')
})
