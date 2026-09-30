<script setup>
// Table tab → Review SQL: a read-only preview of every pending change, close-only.
// Not the exact SQL the server binds and runs (see tableStage.js's reviewSql) — close
// enough to review before Save changes.
import BaseModal from '../../../components/base/BaseModal.vue'
import CodeEditor from '../../../components/base/CodeEditor.vue'

defineProps({
  sql: { type: String, required: true },
})
defineEmits(['close'])
</script>

<template>
  <BaseModal title="Review SQL" width="640px" max-width="94vw" height="420px" @close="$emit('close')">
    <CodeEditor :model-value="sql" readonly language="sql" class="rsql-editor" />
  </BaseModal>
</template>

<style scoped>
.rsql-editor { flex: 1; min-height: 0; }
</style>
