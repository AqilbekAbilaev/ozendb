import { describe, expect, it } from 'vitest'
import { setCollectionQueryMode } from './queryMode'

describe('setCollectionQueryMode', () => {
  it('keeps query mode and workspace type aligned', () => {
    const workspace = { mode: 'find', type: 'mongodb.find' }

    setCollectionQueryMode(workspace, 'aggregate')

    expect(workspace).toEqual({ mode: 'aggregate', type: 'mongodb.aggregate' })
  })

  it('ignores unsupported modes', () => {
    const workspace = { mode: 'find', type: 'mongodb.find' }

    setCollectionQueryMode(workspace, 'sql')

    expect(workspace).toEqual({ mode: 'find', type: 'mongodb.find' })
  })
})
