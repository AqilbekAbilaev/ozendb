import { describe, it, expect } from 'vitest'
import { connectionTargetChanged } from './connectionTarget'

const stored = (over = {}) => ({
  name: 'prod',
  hosts: [{ host: 'db1', port: 27017 }],
  connection_type: 'standalone',
  replica_set_name: null,
  ssh_enabled: false,
  ssh_host: null,
  ssh_port: 22,
  ...over,
})

const form = (over = {}) => ({
  name: 'prod',
  hosts: [{ host: 'db1', port: 27017 }],
  connectionType: 'standalone',
  replicaSetName: null,
  sshEnabled: false,
  sshHost: null,
  sshPort: 22,
  ...over,
})

describe('connectionTargetChanged', () => {
  it('is false when nothing about the target changed', () => {
    expect(connectionTargetChanged(stored(), form())).toBe(false)
  })

  it('sees a different host or port', () => {
    expect(connectionTargetChanged(stored(), form({ hosts: [{ host: 'db2', port: 27017 }] }))).toBe(true)
    expect(connectionTargetChanged(stored(), form({ hosts: [{ host: 'db1', port: 27018 }] }))).toBe(true)
  })

  it('sees a host added to or removed from the seed list', () => {
    const two = [{ host: 'db1', port: 27017 }, { host: 'db2', port: 27017 }]
    expect(connectionTargetChanged(stored(), form({ hosts: two }))).toBe(true)
    expect(connectionTargetChanged(stored({ hosts: two }), form())).toBe(true)
  })

  it('ignores a port that only differs by being a string', () => {
    // The form holds whatever the number input produced; formFields coerces later.
    expect(connectionTargetChanged(stored(), form({ hosts: [{ host: 'db1', port: '27017' }] }))).toBe(false)
  })

  it('sees a different connection type or replica set', () => {
    expect(connectionTargetChanged(stored(), form({ connectionType: 'srv' }))).toBe(true)
    expect(connectionTargetChanged(stored(), form({ replicaSetName: 'rs0' }))).toBe(true)
  })

  it('treats an absent replica set name and an empty one as the same', () => {
    expect(connectionTargetChanged(stored({ replica_set_name: null }), form({ replicaSetName: '' }))).toBe(false)
  })

  it('sees the tunnel being turned on or off, and its endpoint moving', () => {
    // The tunnel decides which machine the driver actually reaches.
    expect(connectionTargetChanged(stored(), form({ sshEnabled: true, sshHost: 'bastion' }))).toBe(true)

    const tunnelled = stored({ ssh_enabled: true, ssh_host: 'bastion', ssh_port: 22 })
    const sameTunnel = form({ sshEnabled: true, sshHost: 'bastion', sshPort: 22 })
    expect(connectionTargetChanged(tunnelled, sameTunnel)).toBe(false)
    expect(connectionTargetChanged(tunnelled, { ...sameTunnel, sshHost: 'other' })).toBe(true)
    expect(connectionTargetChanged(tunnelled, { ...sameTunnel, sshPort: 2222 })).toBe(true)
  })

  it('ignores everything that does not move the connection', () => {
    // A rename, a tag, a timeout or new credentials all apply to a live connection
    // safely: the pool is evicted and the next operation reconnects.
    const unchangedTarget = form({
      name: 'renamed',
      tag: 'red',
      readOnly: true,
      username: 'someone-else',
      options: { socketTimeoutMS: '9000' },
      tls: true,
    })
    expect(connectionTargetChanged(stored(), unchangedTarget)).toBe(false)
  })
})
