<script setup>
import { computed, useSlots, Comment, Text } from 'vue'
import BaseIcon from './BaseIcon.vue'

const props = defineProps({
  variant: { type: String, default: 'default' },
  size: { type: String, default: 'md' },
  bordered: { type: Boolean, default: false },
  active: { type: Boolean, default: false },
  icon: { type: String, default: '' },
  iconSize: { type: Number, default: 0 },
  // Defaults to 'button' so a stray instance inside a form can't submit it.
  type: { type: String, default: 'button' },
  disabled: { type: Boolean, default: false },
})

const slots = useSlots()

// Icon-only detection: comments and whitespace-only text don't count as a label.
const hasLabel = computed(() => {
  const nodes = slots.default ? slots.default() : []
  return nodes.some((node) => {
    if (node.type === Comment) return false
    if (node.type === Text) return String(node.children).trim() !== ''
    return true
  })
})
const isIconOnly = computed(() => Boolean(props.icon) && !hasLabel.value)

// Icons read smaller than BaseIcon's 18px default so they sit inside the 28/24px
// button heights without crowding the label.
const resolvedIconSize = computed(() => props.iconSize || (props.size === 'sm' ? 14 : 16))
</script>

<template>
  <button
    class="base-btn"
    :class="[`v-${variant}`, `s-${size}`, { 'icon-only': isIconOnly, bordered: bordered, active: active }]"
    :type="type"
    :disabled="disabled"
  >
    <BaseIcon v-if="icon" :name="icon" :size="resolvedIconSize" />
    <slot />
  </button>
</template>

<style scoped>
.base-btn {
  height: 28px;
  padding: 0 14px;
  border-radius: 5px;
  border: none;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  background: var(--bg-toolbar);
  color: var(--text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.base-btn:hover:not(:disabled) { background: var(--bg-hover); }
.base-btn:disabled { opacity: .5; cursor: default; }

.base-btn.v-primary { background: var(--accent); color: var(--on-accent); }
.base-btn.v-primary:hover:not(:disabled) { opacity: .88; }
.base-btn.v-danger { background: var(--danger); color: var(--on-accent); }
.base-btn.v-danger:hover:not(:disabled) { background: var(--danger-hover); }

/* Ghost — transparent at rest, fills on hover (toolbar rows). */
.base-btn.v-ghost { background: transparent; }
.base-btn.v-ghost:hover:not(:disabled) { background: var(--bg-hover); }
.base-btn.v-ghost:disabled { color: var(--text-faint); }
.base-btn.v-ghost.active { background: var(--bg-hover); }

.base-btn.s-sm { height: 24px; padding: 0 11px; font-size: 12px; }

.base-btn.bordered {
  background: var(--bg-input);
  border: 1px solid var(--border-soft);
}
.base-btn.bordered:hover:not(:disabled) { background: var(--bg-hover); }
.base-btn.bordered.v-primary { border-color: var(--accent); }
.base-btn.bordered.v-danger { border-color: var(--danger); }

/* Toggled state: the three-class selector beats .bordered without rule order. */
.base-btn.bordered.active { background: var(--bg-hover); border-color: var(--accent); }

.base-btn.icon-only {
  height: auto;
  padding: 5px;
  gap: 0;
  background: none;
  border: 1px solid transparent;
  color: var(--text-dim);
  display: grid;
  place-items: center;
}
.base-btn.icon-only:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
.base-btn.icon-only.s-sm { padding: 4px; }
/* Icon-only colours the glyph rather than filling. */
.base-btn.icon-only.v-danger:hover:not(:disabled) { color: var(--danger-text); }
.base-btn.icon-only.active { background: var(--bg-hover); border-color: var(--accent); color: var(--accent); }
</style>
