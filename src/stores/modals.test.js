import { describe, it, expect, beforeEach } from 'vitest'
import { computed, ref } from 'vue'
import { openModals, openModal, closeModal, isModalOpen, modalOptions } from './modals'

// The registry-driven modal API (openModal / closeModal / isModalOpen over a single
// `openModals` map) is what lets AppModals render every modal from one v-for and lets
// a new modal be added as one registry row. These specs pin that behaviour.
//
// The store's state is a module-scope singleton, so each test clears it first.
beforeEach(() => {
  Object.keys(openModals).forEach(id => closeModal(id))
})

describe('modals store — registry-driven open-state', () => {
  it('starts with no registry modal open', () => {
    expect(isModalOpen('stats')).toBe(false)
    expect(Object.keys(openModals)).toHaveLength(0)
  })

  it('openModal records the payload under the modal id', () => {
    const payload = { connId: 'c1', connName: 'Local', dbName: 'app', collName: 'users' }
    openModal('stats', payload)
    expect(isModalOpen('stats')).toBe(true)
    expect(openModals.stats).toEqual(payload)
  })

  it('openModal with no payload opens with an empty context', () => {
    openModal('preferences')
    expect(isModalOpen('preferences')).toBe(true)
    expect(openModals.preferences).toEqual({})
  })

  it('closeModal removes the modal so it renders no more', () => {
    openModal('stats', { connId: 'c1' })
    closeModal('stats')
    expect(isModalOpen('stats')).toBe(false)
    expect('stats' in openModals).toBe(false)
  })

  it('tracks several modals independently', () => {
    openModal('stats', { connId: 'a' })
    openModal('schema', { connId: 'b' })
    closeModal('stats')
    expect(isModalOpen('stats')).toBe(false)
    expect(isModalOpen('schema')).toBe(true)
  })

  it('stores per-open props and callbacks separately from the payload', () => {
    const onSave = () => {}
    openModal('stats', { connId: 'c1' }, { props: { title: 'Stats' }, on: { save: onSave } })

    expect(openModals.stats).toEqual({ connId: 'c1' })
    expect(modalOptions('stats')).toEqual({ props: { title: 'Stats' }, on: { save: onSave } })
    expect(modalOptions('stats').on.save).toBe(onSave)
  })

  it('clears session options when a modal closes', () => {
    openModal('stats', {}, { props: { title: 'Stats' } })
    closeModal('stats')
    expect(modalOptions('stats')).toEqual({})
  })

  it('replaces payload and options when reopening the same modal', () => {
    openModal('stats', { connId: 'old' }, { props: { title: 'Old' } })
    openModal('stats', { connId: 'new' }, { props: { title: 'New' } })
    expect(openModals.stats).toEqual({ connId: 'new' })
    expect(modalOptions('stats')).toEqual({ props: { title: 'New' } })
  })

  it('keeps options independent for different modal ids', () => {
    openModal('stats', {}, { props: { title: 'Stats' } })
    openModal('schema', {}, { props: { title: 'Schema' } })
    expect(modalOptions('stats').props.title).toBe('Stats')
    expect(modalOptions('schema').props.title).toBe('Schema')
  })

  it('preserves reactive props supplied by an opener', () => {
    const count = ref(1)
    const title = computed(() => `Count ${count.value}`)
    openModal('stats', {}, { props: { title } })
    count.value = 2
    expect(modalOptions('stats').props.title.value).toBe('Count 2')
  })
})
