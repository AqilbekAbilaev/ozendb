<script setup>
// The multi-line sibling of BaseInput: canonical mono editor chrome (every
// textarea in the app is a code/JSON field) plus the v-model wiring. Single root,
// so `class`, `rows`, `placeholder`, `disabled`, `spellcheck` fall through; a call
// site that needs a taller/shorter box keeps its class (min-height wins over the
// default). Not a code editor — CodeEditor.vue is the syntax-highlighted one.
defineProps({
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'blur', 'focus'])

function onInput(e) {
  emit('update:modelValue', e.target.value)
}
</script>

<template>
  <textarea
    class="base-textarea"
    :value="modelValue"
    @input="onInput"
    @blur="emit('blur', $event)"
    @focus="emit('focus', $event)"
  ></textarea>
</template>

<style scoped>
.base-textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 96px;
  resize: vertical;
  background: var(--bg-input);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 8px 11px;
  color: var(--text);
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.5;
  outline: none;
}
.base-textarea:focus { border-color: var(--accent); }
.base-textarea:disabled { opacity: .5; cursor: not-allowed; }
.base-textarea::placeholder { color: var(--text-faint); }
</style>
