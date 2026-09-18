import { reactive, shallowReactive } from 'vue'

// Open-state for every top-level modal/dialog. Each modal is declared once in
// constants/modalRegistry.js and lives in the single `openModals` map — its key is
// present with its context payload iff it is open. The dispatchers (handleTool /
// handleMenuAction / handleContextAction) open/close via openModal/closeModal; AppModals.vue
// renders whatever is open. App-level singletons open with an empty payload (openModal('about')).
// Session options stay alongside, but separate from, the serializable payload so callbacks
// and reactive props never affect a modal's identity key.

// id -> context payload, key present iff that modal is open.
export const openModals = reactive({})
// Shallow storage preserves callback and ref identity for the generic modal host.
const options = shallowReactive({})

export function openModal(id, payload, sessionOptions = {}) {
  openModals[id] = payload || {}
  options[id] = sessionOptions
}
export function closeModal(id) {
  delete openModals[id]
  delete options[id]
}
export function isModalOpen(id) { return id in openModals }
export function modalOptions(id) { return options[id] || {} }
