<script setup>
import { ref, computed, watch } from 'vue'
import BaseIcon from '../base/BaseIcon.vue'
import BaseSelect from '../base/BaseSelect.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import {
  OPERATORS,
  detectType,
  generateFilter,
  generateSort,
  generateProjection,
} from '../../utils/vqbGenerator'

const props = defineProps({
  tabs:            { type: Array,  required: true },
  activeTabId:     { type: String, required: true },
  width:           { type: Number, default: 360 },
  draggedField:    { type: String, default: '' },
  vqbDrop:         { type: Object, default: null },
  dragOverSection: { type: String, default: null },
})
const emit = defineEmits(['run'])
const activeTab = computed(() => props.tabs.find(t => t.id === props.activeTabId))

function createDefaultVqb() {
  return {
    queryEnabled: true,
    logic: '$and',
    conditions: [],
    projEnabled: false,
    projFields: [],
    projInput: '',
    sortEnabled: false,
    sortFields: [],
    sortInput: '',
  }
}

const vqbState = ref(createDefaultVqb())

function syncVqbState() {
  const tab = activeTab.value
  if (!tab) { vqbState.value = createDefaultVqb(); return }
  if (!tab.vqb) tab.vqb = createDefaultVqb()
  vqbState.value = tab.vqb
}

watch(() => props.activeTabId, syncVqbState, { immediate: true })

watch(() => vqbState.value, applyAndRun, { deep: true })

watch(() => props.draggedField, (field) => {
  if (!field) return
  vqbState.value.conditions.push({ id: uid(), field: field, op: 'eq', value: '', enabled: true })
  applyAndRun()
})

watch(() => props.vqbDrop, (drop) => {
  if (!drop) return
  const field = (drop.field || '').trim()
  if (!field) return
  if (drop.section === 'query') {
    vqbState.value.queryEnabled = true
    vqbState.value.conditions.push({ id: uid(), field: field, op: 'eq', value: drop.value || '', enabled: true })
  } else if (drop.section === 'proj') {
    vqbState.value.projEnabled = true
    vqbState.value.projFields.push({ id: uid(), field: field, include: true })
  } else if (drop.section === 'sort') {
    vqbState.value.sortEnabled = true
    vqbState.value.sortFields.push({ id: uid(), field: field, dir: 1 })
  }
  applyAndRun()
})

function uid() { return Math.random().toString(36).slice(2, 10) }

function applyToTab() {
  const tab = activeTab.value
  if (!tab || !tab.vqb) return
  const s = tab.vqb
  const filterStr = s.queryEnabled ? generateFilter(s.conditions, s.logic) : '{}'
  const sortStr   = s.sortEnabled  ? generateSort(s.sortFields)           : '{}'
  const projStr   = s.projEnabled  ? generateProjection(s.projFields)     : '{}'
  tab.filter     = filterStr === '{}' ? '' : filterStr
  tab.sort       = sortStr   === '{}' ? '' : sortStr
  tab.projection = projStr   === '{}' ? '' : projStr
}

let timer = null
function applyAndRun() {
  clearTimeout(timer)
  timer = setTimeout(applyToTab, 400)
}

function applyAndExecute() {
  clearTimeout(timer)
  applyToTab()
  emit('run')
}

function addCondition() {
  vqbState.value.conditions.push({ id: uid(), field: '', op: 'eq', value: '', enabled: true })
}
function removeCondition(id) {
  vqbState.value.conditions = vqbState.value.conditions.filter(c => c.id !== id)
  applyAndRun()
}
function clearAll() {
  vqbState.value.conditions = []
  applyAndRun()
}
function opNoValue(op) {
  const found = OPERATORS.find(o => o.value === op)
  return found ? found.noValue : false
}

function addProjField() {
  const f = vqbState.value.projInput.trim()
  if (!f) return
  vqbState.value.projFields.push({ id: uid(), field: f, include: true })
  vqbState.value.projInput = ''
  applyAndRun()
}
function removeProjField(id) {
  vqbState.value.projFields = vqbState.value.projFields.filter(f => f.id !== id)
  applyAndRun()
}

function addSortField() {
  const f = vqbState.value.sortInput.trim()
  if (!f) return
  vqbState.value.sortFields.push({ id: uid(), field: f, dir: 1 })
  vqbState.value.sortInput = ''
  applyAndRun()
}
function removeSortField(id) {
  vqbState.value.sortFields = vqbState.value.sortFields.filter(f => f.id !== id)
  applyAndRun()
}
</script>

<template>
  <div class="vqb" :style="{ width: props.width + 'px' }">

    <!-- ── Query section ─────────────────────────────────── -->
    <div class="vqb-section" data-vqb-drop="query"
         :class="{ 'drop-target': props.dragOverSection === 'query' }">
      <div class="vqb-head">
        Query
        <span class="cb" :class="{ on: vqbState.queryEnabled }"
              @click="vqbState.queryEnabled = !vqbState.queryEnabled; applyAndRun()">
          <BaseIcon v-if="vqbState.queryEnabled" name="check" :size="12" />
        </span>
      </div>
      <div class="vqb-body" v-if="vqbState.queryEnabled">
        <div class="vqb-row1">
          <div class="vqb-select" @click="vqbState.logic = vqbState.logic === '$and' ? '$or' : '$and'; applyAndRun()">
            {{ vqbState.logic === '$and' ? 'Match all of ($and)' : 'Match any of ($or)' }}
            <BaseIcon name="caretDown" :size="12" />
          </div>
          <BaseButton bordered @click="clearAll">Clear</BaseButton>
        </div>

        <div class="cond" v-for="c in vqbState.conditions" :key="c.id">
          <div class="cond-line">
            <BaseInput
              class="pill cond-field"
              v-model="c.field"
              placeholder="field"
              @update:model-value="applyAndRun"
              @keydown.enter.prevent="applyAndExecute"
            />
            <BaseSelect class="op-select grow" :model-value="c.op" :options="OPERATORS" size="sm"
              @update:model-value="v => { c.op = v; applyAndRun() }" />
            <BaseButton icon="trash" size="sm" :icon-size="18" @click="removeCondition(c.id)" />
          </div>
          <div class="cond-line" v-if="!opNoValue(c.op)">
            <span class="pill type-pill">{{ detectType(c.value) }}</span>
            <BaseInput
              class="pill grow cond-val"
              v-model="c.value"
              :placeholder="c.op === 'in' || c.op === 'nin' ? 'val1, val2, …' : 'value'"
              @update:model-value="applyAndRun"
              @keydown.enter.prevent="applyAndExecute"
            />
            <span class="cb sm" :class="{ on: c.enabled }"
                  @click="c.enabled = !c.enabled; applyAndRun()">
              <BaseIcon v-if="c.enabled" name="check" :size="11" />
            </span>
          </div>
        </div>

        <div class="dropzone" @click="addCondition">
          <BaseIcon name="plus" :size="14" />
          Drag a cell here or click to add manually
        </div>
      </div>
    </div>

    <!-- ── Projection section ────────────────────────────── -->
    <div class="vqb-section" data-vqb-drop="proj"
         :class="{ 'drop-target': props.dragOverSection === 'proj' }">
      <div class="vqb-head">
        Projection
        <span class="cb" :class="{ on: vqbState.projEnabled }"
              @click="vqbState.projEnabled = !vqbState.projEnabled; applyAndRun()">
          <BaseIcon v-if="vqbState.projEnabled" name="check" :size="12" />
        </span>
      </div>
      <div class="vqb-body" v-if="vqbState.projEnabled">
        <div class="sp-row" v-for="f in vqbState.projFields" :key="f.id">
          <span class="pill sp-field">{{ f.field }}</span>
          <BaseButton
            size="sm"
            bordered
            class="dir-toggle"
            :class="f.include ? 'inc' : 'exc'"
            @click="f.include = !f.include; applyAndRun()"
          >{{ f.include ? 'Include' : 'Exclude' }}</BaseButton>
          <BaseButton icon="trash" size="sm" :icon-size="18" @click="removeProjField(f.id)" />
        </div>
        <div class="add-field-row">
          <BaseInput
            class="add-field-input"
            v-model="vqbState.projInput"
            placeholder="field name"
            @keydown.enter.prevent="addProjField"
          />
          <BaseButton variant="primary" size="sm" @click="addProjField">Add</BaseButton>
        </div>
      </div>
      <div class="vqb-body" v-else>
        <div class="dropzone" @click="vqbState.projEnabled = true; applyAndRun()">
          <BaseIcon name="plus" :size="14" />
          Drag a cell here or click to enable projection
        </div>
      </div>
    </div>

    <!-- ── Sort section ──────────────────────────────────── -->
    <div class="vqb-section" data-vqb-drop="sort"
         :class="{ 'drop-target': props.dragOverSection === 'sort' }">
      <div class="vqb-head">
        Sort
        <span class="cb" :class="{ on: vqbState.sortEnabled }"
              @click="vqbState.sortEnabled = !vqbState.sortEnabled; applyAndRun()">
          <BaseIcon v-if="vqbState.sortEnabled" name="check" :size="12" />
        </span>
      </div>
      <div class="vqb-body" v-if="vqbState.sortEnabled">
        <div class="sp-row" v-for="f in vqbState.sortFields" :key="f.id">
          <span class="pill sp-field">{{ f.field }}</span>
          <BaseButton
            size="sm"
            bordered
            class="dir-toggle"
            :class="f.dir === 1 ? 'asc' : 'desc'"
            @click="f.dir = f.dir === 1 ? -1 : 1; applyAndRun()"
          >{{ f.dir === 1 ? '↑ ASC' : '↓ DESC' }}</BaseButton>
          <BaseButton icon="trash" size="sm" :icon-size="18" @click="removeSortField(f.id)" />
        </div>
        <div class="add-field-row">
          <BaseInput
            class="add-field-input"
            v-model="vqbState.sortInput"
            placeholder="field name"
            @keydown.enter.prevent="addSortField"
          />
          <BaseButton variant="primary" size="sm" @click="addSortField">Add</BaseButton>
        </div>
      </div>
      <div class="vqb-body" v-else>
        <div class="dropzone" @click="vqbState.sortEnabled = true; applyAndRun()">
          <BaseIcon name="plus" :size="14" />
          Drag a cell here or click to enable sort
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.vqb-section.drop-target { background: rgba(59, 130, 246, .08); }
.vqb-section.drop-target::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 2px solid var(--accent);
  pointer-events: none;
  z-index: 5;
}

.vqb-row1 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 9px;
}

.vqb-select {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-input);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 6px 9px;
  font-size: 12.5px;
  color: var(--text);
  cursor: pointer;
  user-select: none;
}
.vqb-select:hover { border-color: var(--accent); }

.dropzone {
  border: 1px dashed var(--border-soft);
  border-radius: 6px;
  padding: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-faint);
  cursor: pointer;
  user-select: none;
}
.dropzone:hover  { border-color: var(--accent); color: var(--accent); }

.cond-field,
.base-input.cond-field { width: 90px; flex: none; }

.sp-row {
  display: flex; align-items: center; gap: 5px; margin-bottom: 6px;
}
.sp-field {
  flex: 1; font-family: var(--mono); font-size: 11.5px; cursor: default;
}
.base-btn.dir-toggle.asc  { color: var(--accent); border-color: var(--accent); }
.base-btn.dir-toggle.desc { color: var(--link);   border-color: var(--link);   }
.dir-toggle.inc  { color: var(--green);  border-color: var(--green);  }
.dir-toggle.exc  { color: var(--prod);   border-color: var(--prod);   }

.add-field-row { display: flex; gap: 6px; margin-top: 4px; }
.base-input.add-field-input {
  flex: 1; border-radius: 5px; font-size: 12px;
  padding: 5px 8px; min-width: 0;
}
</style>
<style scoped src="./QueryBuilderPanel.css"></style>
