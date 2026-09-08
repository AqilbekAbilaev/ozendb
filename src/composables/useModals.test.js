import { describe, it, expect } from 'vitest'
import { computed, ref } from 'vue'
import { useModals } from './useModals'

// The registry-driven modal API (openModal / closeModal / isModalOpen over a single
// `openModals` map) is what lets AppModals render every modal from one v-for and lets
// a new modal be added as one registry row. These specs pin that behaviour.
describe('useModals — registry-driven open-state', () => {
  it('starts with no registry modal open', () => {
    const modals = useModals()
    expect(modals.isModalOpen('stats')).toBe(false)
    expect(Object.keys(modals.openModals)).toHaveLength(0)
  })

  it('openModal records the payload under the modal id', () => {
    const modals = useModals()
    const payload = { connId: 'c1', connName: 'Local', dbName: 'app', collName: 'users' }
    modals.openModal('stats', payload)
    expect(modals.isModalOpen('stats')).toBe(true)
    expect(modals.openModals.stats).toEqual(payload)
  })

  it('openModal with no payload opens with an empty context', () => {
    const modals = useModals()
    modals.openModal('preferences')
    expect(modals.isModalOpen('preferences')).toBe(true)
    expect(modals.openModals.preferences).toEqual({})
  })

  it('closeModal removes the modal so it renders no more', () => {
    const modals = useModals()
    modals.openModal('stats', { connId: 'c1' })
    modals.closeModal('stats')
    expect(modals.isModalOpen('stats')).toBe(false)
    expect('stats' in modals.openModals).toBe(false)
  })

  it('tracks several modals independently', () => {
    const modals = useModals()
    modals.openModal('stats', { connId: 'a' })
    modals.openModal('schema', { connId: 'b' })
    modals.closeModal('stats')
    expect(modals.isModalOpen('stats')).toBe(false)
    expect(modals.isModalOpen('schema')).toBe(true)
  })

  it('stores per-open props and callbacks separately from the payload', () => {
    const modals = useModals()
    const onSave = () => {}
    modals.openModal('stats', { connId: 'c1' }, { props: { title: 'Stats' }, on: { save: onSave } })

    expect(modals.openModals.stats).toEqual({ connId: 'c1' })
    expect(modals.modalOptions('stats')).toEqual({ props: { title: 'Stats' }, on: { save: onSave } })
    expect(modals.modalOptions('stats').on.save).toBe(onSave)
  })

  it('clears session options when a modal closes', () => {
    const modals = useModals()
    modals.openModal('stats', {}, { props: { title: 'Stats' } })
    modals.closeModal('stats')
    expect(modals.modalOptions('stats')).toEqual({})
  })

  it('replaces payload and options when reopening the same modal', () => {
    const modals = useModals()
    modals.openModal('stats', { connId: 'old' }, { props: { title: 'Old' } })
    modals.openModal('stats', { connId: 'new' }, { props: { title: 'New' } })
    expect(modals.openModals.stats).toEqual({ connId: 'new' })
    expect(modals.modalOptions('stats')).toEqual({ props: { title: 'New' } })
  })

  it('keeps options independent for different modal ids', () => {
    const modals = useModals()
    modals.openModal('stats', {}, { props: { title: 'Stats' } })
    modals.openModal('schema', {}, { props: { title: 'Schema' } })
    expect(modals.modalOptions('stats').props.title).toBe('Stats')
    expect(modals.modalOptions('schema').props.title).toBe('Schema')
  })

  it('preserves reactive props supplied by an opener', () => {
    const modals = useModals()
    const count = ref(1)
    const title = computed(() => `Count ${count.value}`)
    modals.openModal('stats', {}, { props: { title } })
    count.value = 2
    expect(modals.modalOptions('stats').props.title.value).toBe('Count 2')
  })
})
