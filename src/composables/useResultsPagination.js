import { computed, ref } from 'vue'
import { countDocuments } from '../engines/mongodb/api/queries'
import { errText } from '../utils/errors'
import { parseField } from '../utils/queryParser'

// Owns collection pagination and the optional server-side count shown in the results footer.
export function useResultsPagination({ activeTab, isAggregate, requery, showToast }) {
  const countMenu = ref(null)
  const isCountDisabled = computed(() =>
    isAggregate() || !activeTab() || activeTab().kind !== 'collection'
  )

  async function fetchCount(tab) {
    const parsed = parseField(tab.state.query.filter || '')
    if (!parsed.ok) throw new Error(parsed.error)
    const total = await countDocuments(
      { connectionId: tab.connectionId, database: tab.dbName, collection: tab.collectionName },
      parsed.ejson,
    )
    tab.total = total
    tab.totalFilter = parsed.ejson
    return total
  }

  function goFirst() { const tab = activeTab(); if (tab) { tab.state.query.skip = 0; requery(false) } }
  function goPrev() { const tab = activeTab(); if (tab) { tab.state.query.skip = Math.max(0, (tab.state.query.skip || 0) - (tab.state.query.limit || 50)); requery(false) } }
  function goNext() { const tab = activeTab(); if (tab) { tab.state.query.skip = (tab.state.query.skip || 0) + (tab.state.query.limit || 50); requery(false) } }
  async function goLast() {
    const tab = activeTab()
    if (!tab) return
    try {
      const total = await fetchCount(tab)
      tab.state.query.skip = total === 0 ? 0 : Math.floor((total - 1) / (tab.state.query.limit || 50)) * (tab.state.query.limit || 50)
      requery(false)
    } catch (e) { showToast('Count failed: ' + errText(e)) }
  }
  async function runCount() {
    const tab = activeTab()
    if (!tab || isCountDisabled.value || tab.isCounting) return
    tab.isCounting = true
    try { await fetchCount(tab); tab.countShown = true }
    catch (e) { showToast('Count failed: ' + errText(e)) }
    finally { tab.isCounting = false }
  }
  function setPageSize(size) {
    const tab = activeTab()
    if (!tab) return
    tab.state.query.limit = size
    requery(true)
  }
  const rangeText = computed(() => {
    const tab = activeTab(); const len = tab?.runtime?.results?.length ?? 0
    if (!len) return '-- to --'
    const base = `${(tab.state.query.skip || 0) + 1} to ${(tab.state.query.skip || 0) + len}`
    const parsed = parseField(tab.state.query.filter || '')
    return tab.total != null && parsed.ok && tab.totalFilter === parsed.ejson ? `${base} of ${tab.total.toLocaleString()}` : base
  })
  const countText = computed(() => {
    const tab = activeTab(); if (!tab || isCountDisabled.value || tab.total == null || !tab.countShown) return null
    const parsed = parseField(tab.state.query.filter || '')
    return parsed.ok && tab.totalFilter === parsed.ejson ? tab.total.toLocaleString() : null
  })
  function onCountContext(e) {
    if (countText.value == null) return
    e.preventDefault()
    countMenu.value = { x: e.clientX, y: e.clientY, items: [{ label: 'Copy value to clipboard', icon: 'copy' }] }
  }
  function copyCountValue() {
    const tab = activeTab(); countMenu.value = null
    if (tab?.total != null) navigator.clipboard.writeText(String(tab.total)).catch(() => {})
  }
  return { countMenu, isCountDisabled, rangeText, countText, goFirst, goPrev, goNext, goLast, runCount, setPageSize, onCountContext, copyCountValue }
}
