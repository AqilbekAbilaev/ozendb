<script setup>
import { computed } from 'vue'
import { ENGINE_OPTIONS } from '../../data/connectionOptions.js'

// A connection's database engine as a short coloured tag (MDB, PG).
const props = defineProps({
  engine: { type: String, required: true },
})
const option = computed(() => ENGINE_OPTIONS.find(e => e.value === props.engine))
</script>

<template>
  <span class="eng" :class="'eng-' + engine" :title="option.label">{{ option.badge }}</span>
</template>

<style scoped>
.eng {
  flex: none; padding: 2px 3.5px; border-radius: 3px;
  font: 700 8.5px/1 var(--mono); letter-spacing: .03em;
}
.eng-mongodb    { background: var(--eng-mongodb-bg);    color: var(--eng-mongodb-text); }
.eng-postgresql { background: var(--eng-postgresql-bg); color: var(--eng-postgresql-text); }
</style>
