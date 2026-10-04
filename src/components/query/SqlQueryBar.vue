<script setup>
import BaseIcon from '../base/BaseIcon.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseTextarea from '../base/BaseTextarea.vue'
import FieldError from '../base/FieldError.vue'

// SQL query bar for a collection tab in `sql` mode. The SQL is translated to a
// MongoDB find and run against this tab's collection (the FROM clause is only for
// the parser — the collection is fixed by the tab). The translated query, Explain,
// and paging all come from the shared result stack, so this bar is just the editor.
const props = defineProps({
  activeTab: { type: Object,  required: true },
  runValid:  { type: Boolean, default: true },
  errorText: { type: String,  default: null },
})
const emit = defineEmits(['run'])

function onInput(value) {
  props.activeTab.sql = value
}

function onKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    emit('run')
  }
}
</script>

<template>
  <div class="sqlbar">
    <div class="sqlbar-top">
      <BaseButton
        variant="ghost"
        size="sm"
        class="run"
        @click="emit('run')"
        :disabled="activeTab.runtime.isRunning || !runValid"
      >
        <BaseIcon name="run" :size="18" class="ic" />
        {{ activeTab.runtime.isRunning ? 'Running…' : 'Run' }}
      </BaseButton>
      <span class="hint">⌘/Ctrl + Enter</span>
    </div>

    <BaseTextarea
      class="sql-input"
      :model-value="activeTab.sql || ''"
      spellcheck="false"
      rows="4"
      placeholder="SELECT * FROM collection WHERE field = value ORDER BY field LIMIT n"
      @update:model-value="onInput"
      @keydown="onKeydown"
    />

    <FieldError :text="errorText" spaced />
  </div>
</template>

<style scoped>
.sqlbar {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sqlbar-top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.hint { font-size: 11.5px; color: var(--text-faint); }

/* Run button: green outline, matching QueryBar's Run affordance. Scoped to
   .base-btn to beat BaseButton's own border defaults reliably. */
.base-btn.run { min-width: 92px; justify-content: flex-start; border: 1px solid var(--green); }
.run .ic { color: var(--green); margin-right: 2px; }

.sql-input {
  width: 100%;
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.5;
  resize: vertical;
}
</style>
