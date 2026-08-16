<script setup>
import { computed, reactive, ref } from 'vue'
import { SHORTCUT_COMMANDS, shortcutGroups, defaultAccel, accelToTokens, accelFromEvent } from '../../utils/keybindings'
import BaseButton from '../base/BaseButton.vue'
import Disclosure from '../base/Disclosure.vue'
import KeybindButton from '../base/KeybindButton.vue'

// Keyboard shortcuts editor — the body of the old ShortcutsModal, lifted into a pane
// so it can live as a Preferences tab. Every section is collapsible, the way Studio-3T's
// Keymap tab lists them: the menu groups rebind their commands, the reference groups
// below list the fixed shortcuts the editors and grid handle.
// The parent collects the working bindings on save via the exposed collectBindings().
const props = defineProps({
  bindings: { type: Object, default: () => ({}) },
})

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
const mod = isMac ? '⌘' : 'Ctrl'

// A local working copy so edits can be reviewed and saved (or discarded) as a
// batch rather than mutating the live bindings on every keystroke.
const working = reactive({})
for (const cmd of SHORTCUT_COMMANDS) {
  working[cmd.id] = props.bindings[cmd.id] || cmd.default
}

const capturingId = ref(null)   // command id whose row is listening for a key
const conflict = ref(null)      // { label } the last capture collided with

// Sections start collapsed — with nine of them the pane is a list to scan, not a wall
// to scroll. Keyed by title, so a group is open only once the user asks for it.
const GROUPS = shortcutGroups()
const open = reactive({})

function tokens(accel) {
  return accelToTokens(accel, isMac)
}

function startCapture(id) {
  conflict.value = null
  capturingId.value = id
}

function cancelCapture() {
  capturingId.value = null
  conflict.value = null
}

// While a row is capturing, turn the keypress into an accelerator. Reject a combo
// already bound to another command (reassigning would leave that one unbound and
// silently fall back to its default — a confusing duplicate), keeping the row in
// capture so the user can try again or press Esc.
function onCaptureKeydown(id, e) {
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    cancelCapture()
    return
  }
  const accel = accelFromEvent(e)
  if (!accel) return
  const clash = SHORTCUT_COMMANDS.find((cmd) => cmd.id !== id && working[cmd.id] === accel)
  if (clash) {
    conflict.value = { label: clash.label }
    return
  }
  working[id] = accel
  cancelCapture()
}

function resetOne(id) {
  working[id] = defaultAccel(id)
  if (capturingId.value === id) cancelCapture()
}

function resetAll() {
  for (const cmd of SHORTCUT_COMMANDS) working[cmd.id] = cmd.default
  cancelCapture()
}

// How many commands in a group differ from their default — shown on the collapsed
// header so customizations aren't hidden behind a caret.
function changedIn(group) {
  return group.commands.filter((cmd) => working[cmd.id] !== cmd.default).length
}

// Whether the working copy differs from the saved bindings (for the parent's Save).
const dirty = computed(() =>
  SHORTCUT_COMMANDS.some((cmd) => working[cmd.id] !== (props.bindings[cmd.id] || cmd.default))
)

// The full command→accelerator map, read by the parent (PreferencesModal) on save.
function collectBindings() {
  const payload = {}
  for (const cmd of SHORTCUT_COMMANDS) payload[cmd.id] = working[cmd.id]
  return payload
}

defineExpose({ collectBindings: collectBindings, dirty: dirty })

// Fixed reference shortcuts handled directly by the editors and results grid.
const REFERENCE = computed(() => [
  {
    title: 'Query',
    items: [
      { keys: [`${mod}`, 'Enter'], desc: 'Run the current query' },
      { keys: ['Enter'], desc: 'Run from the filter / sort / projection field' },
    ],
  },
  {
    title: 'Results grid',
    items: [
      { keys: ['↑', '↓', '←', '→'], desc: 'Move the cell selection' },
      { keys: [`${mod}`, 'C'], desc: 'Copy the selected cell value' },
      { keys: ['Enter'], desc: 'Commit an inline cell edit' },
      { keys: ['Esc'], desc: 'Cancel an edit / clear the selection' },
    ],
  },
  {
    title: 'IntelliShell',
    items: [
      { keys: [`${mod}`, 'Enter'], desc: 'Run the shell command' },
      { keys: ['Enter'], desc: 'Insert a new line' },
    ],
  },
  {
    title: 'Text fields',
    items: [
      { keys: [`${mod}`, 'Z'], desc: 'Undo' },
      { keys: [`${mod}`, 'Shift', 'Z'], desc: 'Redo' },
      { keys: [`${mod}`, 'Y'], desc: 'Redo (alternate)' },
    ],
  },
])
</script>

<template>
  <div class="sc-body">
    <div class="sc-bar">
      <span class="sc-hint">Click a shortcut to rebind it.</span>
      <BaseButton variant="ghost" size="sm" @click="resetAll">Reset all</BaseButton>
    </div>

    <!-- Customizable menu shortcuts, one collapsible section per menu -->
    <section v-for="group in GROUPS" :key="group.title" class="sc-group">
      <Disclosure v-model="open[group.title]">
        <span class="sc-title">{{ group.title }}</span>
        <span class="sc-count">{{ group.commands.length }}</span>
        <span v-if="changedIn(group)" class="sc-changed">{{ changedIn(group) }} changed</span>
      </Disclosure>

      <div v-if="open[group.title]" class="sc-items">
        <div v-for="cmd in group.commands" :key="cmd.id" class="sc-edit-row">
          <span class="sc-desc">{{ cmd.label }}</span>

          <KeybindButton
            v-if="capturingId !== cmd.id"
            :keys="tokens(working[cmd.id])"
            @click="startCapture(cmd.id)"
          />

          <span
            v-else
            class="sc-binding capturing"
            tabindex="0"
            :ref="(el) => el && el.focus()"
            @keydown="onCaptureKeydown(cmd.id, $event)"
            @blur="cancelCapture"
          >Press a shortcut… <span class="sc-esc">Esc to cancel</span></span>

          <BaseButton
            variant="ghost"
            size="sm"
            :disabled="working[cmd.id] === cmd.default"
            title="Reset to default"
            @click="resetOne(cmd.id)"
          >Reset</BaseButton>
        </div>
      </div>
    </section>

    <p v-if="conflict" class="sc-conflict">
      That shortcut is already used by “{{ conflict.label }}”. Pick another.
    </p>

    <!-- Fixed reference: not rebindable, so these list their keys rather than buttons -->
    <section v-for="group in REFERENCE" :key="group.title" class="sc-group">
      <Disclosure v-model="open[group.title]">
        <span class="sc-title">{{ group.title }}</span>
        <span class="sc-count">{{ group.items.length }}</span>
        <span class="sc-fixed">fixed</span>
      </Disclosure>

      <div v-if="open[group.title]" class="sc-items">
        <div v-for="item in group.items" :key="item.desc" class="sc-row">
          <span class="sc-keys">
            <template v-for="(k, i) in item.keys" :key="i">
              <kbd>{{ k }}</kbd><span v-if="i < item.keys.length - 1" class="sc-plus">+</span>
            </template>
          </span>
          <span class="sc-desc">{{ item.desc }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.sc-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sc-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.sc-hint { font-size: 12px; color: var(--text-faint); }

.sc-group { border-bottom: 1px solid var(--border-soft); }
.sc-group:last-child { border-bottom: none; }
.sc-title { flex: 1; }
.sc-count {
  color: var(--text-faint);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.sc-changed { color: var(--accent); font-size: 11px; margin-left: 8px; }
.sc-fixed { color: var(--text-faint); font-size: 11px; margin-left: 8px; }
.sc-items { padding: 2px 10px 10px 29px; }

.sc-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 4px 0;
}
.sc-edit-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
}
.sc-edit-row .sc-desc { flex: 1; }

.sc-keys {
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.sc-row .sc-keys { width: 170px; }
.sc-plus { color: var(--text-faint); font-size: 11px; }
.sc-desc { font-size: 13px; color: var(--text); }

.sc-binding {
  min-width: 150px;
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 5px 8px;
  cursor: pointer;
  color: var(--text-dim);
  font-size: 12px;
}
.sc-binding:hover { border-color: var(--border-soft); }
.sc-binding.capturing {
  border-color: var(--accent);
  color: var(--text-dim);
  cursor: default;
  outline: none;
}
.sc-esc { color: var(--text-faint); margin-left: 6px; font-size: 11px; }

.sc-conflict {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--danger-text);
}

kbd {
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1;
  color: var(--text);
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  border-radius: 4px;
  padding: 4px 7px;
  min-width: 12px;
  text-align: center;
}
.sc-binding kbd { background: var(--bg-panel-2); }
</style>
