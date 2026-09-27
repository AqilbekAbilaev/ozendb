<script setup>
import BaseIcon from './BaseIcon.vue'
import EngineBadge from './EngineBadge.vue'

// The crumb row across the top of every workspace: the engine's badge, then what the
// workspace is looking at, deepest last and emphasised. `items` come from
// utils/crumbSegments.js.
defineProps({
  engine: { type: String, required: true },
  // [{ icon, label }]
  items:  { type: Array,  required: true },
})
</script>

<template>
  <div class="crumbs">
    <EngineBadge :engine="engine" />
    <template v-for="(item, i) in items" :key="i">
      <BaseIcon v-if="i" name="caret" :size="11" class="c-ic" />
      <BaseIcon v-if="item.icon" :name="item.icon" :size="15" class="c-ic" />
      <span :class="{ last: i === items.length - 1 }">{{ item.label }}</span>
    </template>
  </div>
</template>

<style scoped>
.crumbs {
  display: flex; align-items: center; gap: 7px; flex: none; min-height: 34px;
  padding: 4px 14px; font-size: 12.5px; color: var(--text-dim);
  border-bottom: 1px solid var(--border);
}
.c-ic { color: var(--text-faint); flex: none; }
.last { color: var(--text); }
</style>
