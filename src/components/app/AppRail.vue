<script setup>
// The narrow left rail: vertical toggles for the connections sidebar and the
// operations dock. Both panes are owned by App.vue, so the rail only flips them.
defineProps({
  sidebarOpen:    { type: Boolean, default: true },
  operationsOpen: { type: Boolean, default: false },
  runningCount:   { type: Number,  default: 0 },
})
const emit = defineEmits(['update:sidebarOpen', 'update:operationsOpen'])
</script>

<template>
  <div class="rail-left">
    <button
      class="rail-toggle"
      :class="{ active: sidebarOpen }"
      type="button"
      :title="sidebarOpen ? 'Hide connections' : 'Show connections'"
      @click="emit('update:sidebarOpen', !sidebarOpen)"
    >
      <span class="rail-label">{{ sidebarOpen ? 'Hide connections' : 'Show connections' }}</span>
    </button>
    <button
      class="rail-toggle"
      :class="{ active: operationsOpen }"
      style="margin-top:auto"
      type="button"
      :title="operationsOpen ? 'Hide operations' : 'Show operations'"
      @click="emit('update:operationsOpen', !operationsOpen)"
    >
      <span class="rail-label">Operations</span>
      <span v-if="runningCount" class="rail-badge">{{ runningCount }}</span>
    </button>
  </div>
</template>

<style scoped>
.rail-left {
  width: 26px;
  flex: none;
  background: var(--bg-panel-2);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 0;
}
.rail-label {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 11px;
  color: var(--text-dim);
  letter-spacing: .3px;
}
.rail-toggle {
  appearance: none;
  background: none;
  border: none;
  padding: 4px 2px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  border-radius: 5px;
}
.rail-toggle:hover { background: var(--bg-hover); }
.rail-toggle:hover .rail-label { color: var(--text); }
.rail-toggle.active .rail-label { color: var(--accent); }
.rail-badge {
  min-width: 15px;
  font-size: 9.5px;
  line-height: 15px;
  color: #fff;
  background: var(--accent);
  border-radius: 8px;
  padding: 0 4px;
  text-align: center;
}
</style>
