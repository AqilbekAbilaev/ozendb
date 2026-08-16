<script setup>
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue'
import BaseIcon from './BaseIcon.vue'

// Themeable dropdown select. Native <select> can't style its option popup — WebKit
// renders it with OS colors that clash with our theme — so this is a custom trigger +
// menu built from theme tokens, matching the app's view-mode / page-size dropdowns.
// The menu is teleported to <body> and positioned with fixed coordinates so a clipping
// ancestor (e.g. a dialog with overflow:hidden) can never cut it off.
// Supports v-model for normal use; for "action" menus, one-way bind :model-value and
// handle @update:model-value (the trigger then stays on the placeholder).
const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  // [{ value, label, disabled? }]
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: 'Select…' },
  disabled: { type: Boolean, default: false },
  // Trigger density: 'md' (default form control) or 'sm' (compact pills / inline).
  size: { type: String, default: 'md' },
})
const emit = defineEmits(['update:modelValue'])

const rootEl = ref(null)
const triggerEl = ref(null)
const menuEl = ref(null)
const open = ref(false)
const menuStyle = ref({})

const selected = computed(() => props.options.find((opt) => opt.value === props.modelValue) || null)
const triggerLabel = computed(() => (selected.value ? selected.value.label : props.placeholder))

// Anchor the teleported menu under the trigger (fixed coords). Flip above if it would
// overflow the viewport bottom and there's more room above.
function positionMenu() {
  const el = triggerEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const base = { position: 'fixed', left: rect.left + 'px', width: rect.width + 'px', top: (rect.bottom + 4) + 'px' }
  menuStyle.value = base
  nextTick(() => {
    const menu = menuEl.value
    if (!menu) return
    const menuHeight = menu.offsetHeight
    const spaceBelow = window.innerHeight - rect.bottom
    if (menuHeight + 8 > spaceBelow && rect.top > spaceBelow) {
      menuStyle.value = { ...base, top: (rect.top - menuHeight - 4) + 'px' }
    }
  })
}

async function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) {
    await nextTick()
    positionMenu()
  }
}

function choose(opt) {
  if (opt.disabled) return
  emit('update:modelValue', opt.value)
  open.value = false
}

// Close when the pointer goes down outside both the trigger and the (teleported) menu,
// or on Escape. Reposition on scroll/resize while open.
function onDocPointer(e) {
  if (!open.value) return
  if (rootEl.value && rootEl.value.contains(e.target)) return
  if (menuEl.value && menuEl.value.contains(e.target)) return
  open.value = false
}
function onKey(e) {
  // Mark the event handled so a surrounding BaseModal doesn't also close on the
  // same Escape — the dropdown backs out first.
  if (e.key === 'Escape' && open.value) {
    open.value = false
    e.preventDefault()
  }
}
function onReflow() {
  if (open.value) positionMenu()
}
// The repositioning listeners only matter while the menu is open — attaching them
// permanently would run a capture-phase scroll handler per scroll event app-wide.
watch(open, (isOpen) => {
  if (isOpen) {
    window.addEventListener('resize', onReflow)
    window.addEventListener('scroll', onReflow, true)
  } else {
    window.removeEventListener('resize', onReflow)
    window.removeEventListener('scroll', onReflow, true)
  }
})
onMounted(() => {
  document.addEventListener('mousedown', onDocPointer, true)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocPointer, true)
  document.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onReflow)
  window.removeEventListener('scroll', onReflow, true)
})
</script>

<template>
  <div ref="rootEl" class="base-select" :class="{ disabled }">
    <button ref="triggerEl" type="button" class="bs-trigger" :class="[`bs-${size}`, { placeholder: !selected, open }]"
      :disabled="disabled" @click="toggle">
      <span class="bs-label">{{ triggerLabel }}</span>
      <BaseIcon name="caretDown" :size="12" class="bs-caret" />
    </button>
    <Teleport to="body">
      <div v-if="open" ref="menuEl" class="bs-menu" :style="menuStyle">
        <div
          v-for="opt in options"
          :key="String(opt.value)"
          class="bs-item"
          :class="{ on: opt.value === modelValue, disabled: opt.disabled }"
          @click="choose(opt)"
        ><slot name="option" :option="opt" :selected="opt.value === modelValue">{{ opt.label }}</slot></div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.base-select { position: relative; }
.base-select.disabled { opacity: .5; }
.bs-trigger {
  width: 100%;
  display: flex; align-items: center; gap: 6px;
  background: var(--bg-input);
  border: 1px solid var(--border-soft);
  border-radius: 5px;
  color: var(--text);
  cursor: pointer;
}
.bs-trigger.bs-md { padding: 5px 8px; font-size: 12.5px; }
.bs-trigger.bs-sm { padding: 3px 7px; font-size: 12px; }
.bs-trigger:hover:not(:disabled) { background: var(--bg-hover); }
.bs-trigger:disabled { cursor: default; }
.bs-trigger.open { border-color: var(--accent); }
.bs-trigger.placeholder .bs-label { color: var(--text-faint); }
.bs-label { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bs-caret { flex: none; color: var(--text-dim); }
/* Teleported to <body>; geometry is set inline. z-index clears modals (60) / banners (70). */
.bs-menu {
  background: var(--bg-menu);
  border: 1px solid var(--border-soft);
  border-radius: 7px;
  box-shadow: 0 14px 34px rgba(0,0,0,.55);
  z-index: 1000;
  padding: 4px;
  max-height: 260px;
  overflow-y: auto;
}
.bs-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 5px;
  font-size: 12.5px;
  color: var(--text-dim);
  cursor: pointer;
}
.bs-item:hover:not(.disabled) { background: var(--bg-hover); color: var(--text); }
.bs-item.on { color: var(--accent); font-weight: 600; }
.bs-item.disabled { opacity: .4; cursor: default; }
</style>
