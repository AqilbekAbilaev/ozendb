<script setup>
// The Messages tab: one line per statement run, newest last.
defineProps({
  // [{ at: Date, ok, text, ms? }]
  messages: { type: Array, required: true },
})

const clock = (at) => at.toTimeString().slice(0, 8)
</script>

<template>
  <div class="msgs">
    <div v-for="(m, i) in messages" :key="i">
      <span class="t">{{ clock(m.at) }}</span>
      <span :class="m.ok ? 'ok' : 'bad'">{{ m.text }}</span>
      <span v-if="m.ms != null" class="t"> · {{ m.ms }} ms</span>
    </div>
  </div>
</template>

<style scoped>
.msgs { flex: 1; overflow: auto; padding: 10px 14px; font: 12px/1.8 var(--mono); color: var(--text-dim); }
.t { color: var(--text-faint); margin-right: 10px; }
.ok { color: var(--green); }
.bad { color: var(--danger-text); }
</style>
