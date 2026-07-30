<script setup>
import { ref, computed, onMounted } from 'vue'
import BaseIcon from '../base/BaseIcon.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseSelect from '../base/BaseSelect.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseCheckbox from '../base/BaseCheckbox.vue'
import BaseTextarea from '../base/BaseTextarea.vue'
import FormField from '../base/FormField.vue'
import TabStrip from '../base/TabStrip.vue'
import BaseButton from '../base/BaseButton.vue'
import FieldError from '../base/FieldError.vue'
import HintText from '../base/HintText.vue'

// The Add / Edit index dialog (Screenshot A). It owns all of its form state and
// emits an assembled { keys, options } pair — two JSON strings the backend merges
// into one createIndexes spec. The JSON tab is the escape hatch for anything the
// form tabs don't cover yet (text/geo/collation land in a later step).
const props = defineProps({
  mode:  { type: String,  default: 'create' },   // 'create' | 'edit'
  seed:  { type: Object,  default: null },        // index spec to prefill (edit / paste)
  busy:  { type: Boolean, default: false },       // a create/edit request is in flight
  error: { type: String,  default: null },        // server-side error to surface
})
const emit = defineEmits(['submit', 'cancel'])

// Field type / direction options for each indexed field.
const TYPE_OPTIONS = [
  { value: '1',        label: '1 (asc)' },
  { value: '-1',       label: '-1 (desc)' },
  { value: '2dsphere', label: '2dsphere' },
  { value: '2d',       label: '2d' },
  { value: 'text',     label: 'text' },
  { value: 'hashed',   label: 'hashed' },
]

const name    = ref('')
const rows    = ref([{ field: '', type: '1' }])   // indexed fields, in order
const subtab  = ref('fields')                      // fields | options | text | geo | collation

// Options tab
const optUnique     = ref(false)
const optSparse     = ref(false)
const optHidden     = ref(false)
const optTtlEnabled = ref(false)
const optTtlSeconds = ref('')
const optPartial    = ref('')       // partialFilterExpression as JSON text

// Text options tab (text indexes)
const txtDefaultLang  = ref('')
const txtLangOverride = ref('')
const txtWeights      = ref('')     // field→weight map as JSON text

// Geo options tab (2dsphere / 2d indexes)
const geoSphereVersion = ref('')
const geoBits          = ref('')
const geoMin           = ref('')
const geoMax           = ref('')

// Collation tab
const colLocale         = ref('')
const colStrength       = ref('')   // '' | '1'..'5'
const colCaseLevel      = ref(false)
const colCaseFirst      = ref('off')
const colNumericOrdering = ref(false)
const colAlternate      = ref('non-ignorable')
const colBackwards      = ref(false)
const COL_STRENGTH_OPTIONS = [
  { value: '',  label: 'default' },
  { value: '1', label: '1 — primary' },
  { value: '2', label: '2 — secondary' },
  { value: '3', label: '3 — tertiary' },
  { value: '4', label: '4 — quaternary' },
  { value: '5', label: '5 — identical' },
]
const COL_CASE_FIRST_OPTIONS = ['off', 'upper', 'lower'].map((v) => ({ value: v, label: v }))
const COL_ALTERNATE_OPTIONS = ['non-ignorable', 'shifted'].map((v) => ({ value: v, label: v }))

// Footer
const background = ref(false)
const jsonMode   = ref(false)
const jsonText   = ref('')

const localError = ref(null)

// --- prefill from a seed (edit or paste) ---
onMounted(() => {
  const seed = props.seed
  if (!seed) return
  if (seed.key && typeof seed.key === 'object') {
    const seeded = Object.entries(seed.key).map(([field, value]) => ({ field: field, type: String(value) }))
    if (seeded.length) rows.value = seeded
  }
  // In edit mode the name is fixed to the original; paste starts unnamed.
  if (props.mode === 'edit') name.value = seed.name || ''
  optUnique.value = !!seed.unique
  optSparse.value = !!seed.sparse
  optHidden.value = !!seed.hidden
  if (seed.expireAfterSeconds != null) { optTtlEnabled.value = true; optTtlSeconds.value = String(seed.expireAfterSeconds) }
  if (seed.partialFilterExpression) optPartial.value = JSON.stringify(seed.partialFilterExpression)
  // text
  if (seed.default_language) txtDefaultLang.value = seed.default_language
  if (seed.language_override) txtLangOverride.value = seed.language_override
  if (seed.weights) txtWeights.value = JSON.stringify(seed.weights)
  // geo
  if (seed['2dsphereIndexVersion'] != null) geoSphereVersion.value = String(seed['2dsphereIndexVersion'])
  if (seed.bits != null) geoBits.value = String(seed.bits)
  if (seed.min != null) geoMin.value = String(seed.min)
  if (seed.max != null) geoMax.value = String(seed.max)
  // collation
  const col = seed.collation
  if (col && typeof col === 'object') {
    colLocale.value = col.locale || ''
    if (col.strength != null) colStrength.value = String(col.strength)
    colCaseLevel.value = !!col.caseLevel
    colCaseFirst.value = col.caseFirst || 'off'
    colNumericOrdering.value = !!col.numericOrdering
    colAlternate.value = col.alternate || 'non-ignorable'
    colBackwards.value = !!col.backwards
  }
})

// --- fields ---
function addField() { rows.value.push({ field: '', type: '1' }) }
function removeField(i) { rows.value.splice(i, 1); if (!rows.value.length) addField() }

const fieldCount = computed(() => rows.value.filter(r => r.field.trim()).length)
const kindLabel = computed(() => fieldCount.value > 1 ? 'Compound index' : (fieldCount.value === 1 ? 'Single-field index' : 'No fields yet'))

// --- spec assembly ---
function mapType(t) {
  if (t === '1') return 1
  if (t === '-1') return -1
  return t
}
function buildKeys() {
  const key = {}
  for (const row of rows.value) {
    const field = row.field.trim()
    if (field) key[field] = mapType(row.type)
  }
  return key
}
// Throws with a user-facing message on invalid input (bad TTL / partial filter).
function buildOptions() {
  const options = {}
  if (name.value.trim()) options.name = name.value.trim()
  if (optUnique.value) options.unique = true
  if (optSparse.value) options.sparse = true
  if (optHidden.value) options.hidden = true
  if (background.value) options.background = true
  if (optTtlEnabled.value) {
    const secs = Number(optTtlSeconds.value)
    if (!Number.isFinite(secs) || secs < 0) throw new Error('TTL seconds must be a non-negative number')
    options.expireAfterSeconds = secs
  }
  if (optPartial.value.trim()) {
    try { options.partialFilterExpression = JSON.parse(optPartial.value) }
    catch (e) { throw new Error('Partial filter expression is not valid JSON') }
  }
  // Text options
  if (txtDefaultLang.value.trim()) options.default_language = txtDefaultLang.value.trim()
  if (txtLangOverride.value.trim()) options.language_override = txtLangOverride.value.trim()
  if (txtWeights.value.trim()) {
    try { options.weights = JSON.parse(txtWeights.value) }
    catch (e) { throw new Error('Text weights must be valid JSON') }
  }
  // Geo options
  if (geoSphereVersion.value !== '') options['2dsphereIndexVersion'] = numOrThrow(geoSphereVersion.value, '2dsphere index version')
  if (geoBits.value !== '') options.bits = numOrThrow(geoBits.value, 'bits')
  if (geoMin.value !== '') options.min = numOrThrow(geoMin.value, 'min')
  if (geoMax.value !== '') options.max = numOrThrow(geoMax.value, 'max')
  // Collation (only when a locale is given)
  if (colLocale.value.trim()) {
    const collation = { locale: colLocale.value.trim() }
    if (colStrength.value) collation.strength = Number(colStrength.value)
    if (colCaseLevel.value) collation.caseLevel = true
    if (colCaseFirst.value && colCaseFirst.value !== 'off') collation.caseFirst = colCaseFirst.value
    if (colNumericOrdering.value) collation.numericOrdering = true
    if (colAlternate.value && colAlternate.value !== 'non-ignorable') collation.alternate = colAlternate.value
    if (colBackwards.value) collation.backwards = true
    options.collation = collation
  }
  return options
}
function numOrThrow(value, label) {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number`)
  return n
}

// The assembled spec ({ key, ...options }) shown/edited in JSON mode.
function currentSpec() {
  const spec = { key: buildKeys() }
  Object.assign(spec, buildOptionsSafe())
  return spec
}
function buildOptionsSafe() { try { return buildOptions() } catch (e) { return {} } }

function toggleJson() {
  if (!jsonMode.value) {
    jsonText.value = JSON.stringify(currentSpec(), null, 2)
    jsonMode.value = true
  } else {
    jsonMode.value = false
  }
  localError.value = null
}

function onSubmit() {
  localError.value = null
  if (jsonMode.value) {
    let spec
    try { spec = JSON.parse(jsonText.value) } catch (e) { localError.value = 'Index spec is not valid JSON'; return }
    if (!spec || typeof spec.key !== 'object' || !Object.keys(spec.key).length) {
      localError.value = 'The spec needs a non-empty "key" object'; return
    }
    const key = spec.key
    const options = Object.assign({}, spec)
    delete options.key
    emit('submit', { keys: JSON.stringify(key), options: JSON.stringify(options) })
    return
  }
  const key = buildKeys()
  if (!Object.keys(key).length) { localError.value = 'Add at least one field'; return }
  let options
  try { options = buildOptions() } catch (e) { localError.value = e.message; return }
  emit('submit', { keys: JSON.stringify(key), options: JSON.stringify(options) })
}

const shownError = computed(() => localError.value || props.error)
const title = computed(() => props.mode === 'edit' ? 'Edit index' : 'Add index')
</script>

<template>
  <BaseModal :title="title" width="660px" max-width="92vw" @close="emit('cancel')">
      <div class="del-body idx-add-body">
        <FormField label="Index name">
          <BaseInput
            v-model="name"
            class="prompt-input"
            :disabled="mode === 'edit'"
            placeholder="Auto-generated from the fields if left blank"
          />
        </FormField>

        <!-- Sub-tabs -->
        <div class="sub-tabs">
          <TabStrip
            :model-value="subtab"
            :disabled="jsonMode"
            :options="[{ value: 'fields', label: 'Fields' }, { value: 'options', label: 'Options' }, { value: 'text', label: 'Text options' }, { value: 'geo', label: 'Geo options' }, { value: 'collation', label: 'Collation' }]"
            @update:model-value="subtab = $event"
          />
          <span v-if="jsonMode" class="json-badge">Editing raw JSON</span>
        </div>

        <!-- JSON mode -->
        <div v-if="jsonMode" class="json-pane">
          <BaseTextarea
            v-model="jsonText"
            class="json-area"
            spellcheck="false" autocorrect="off" autocapitalize="off"
          ></BaseTextarea>
        </div>

        <!-- Fields tab -->
        <div v-else-if="subtab === 'fields'" class="tab-pane">
          <table class="fields-table">
            <thead>
              <tr><th class="fc-name">Field name</th><th class="fc-type">Field type</th><th class="fc-x"></th></tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in rows" :key="i">
                <td class="fc-name">
                  <BaseInput v-model="row.field" class="prompt-input sm" placeholder="e.g. email or address.city" />
                </td>
                <td class="fc-type">
                  <BaseSelect v-model="row.type" class="prompt-select" :options="TYPE_OPTIONS" size="sm" />
                </td>
                <td class="fc-x">
                  <BaseButton icon="trash" variant="danger" :icon-size="14" title="Remove field" @click="removeField(i)" />
                </td>
              </tr>
            </tbody>
          </table>
          <div class="fields-foot">
            <BaseButton size="sm" icon="plus" @click="addField">Add field</BaseButton>
            <span class="kind-label">{{ kindLabel }}</span>
          </div>
        </div>

        <!-- Options tab -->
        <div v-else-if="subtab === 'options'" class="tab-pane options-pane">
          <label class="opt-row"><BaseCheckbox v-model="optUnique" /><span>Unique</span></label>
          <label class="opt-row"><BaseCheckbox v-model="optSparse" /><span>Sparse</span></label>
          <label class="opt-row"><BaseCheckbox v-model="optHidden" /><span>Hidden (ignored by the query planner)</span></label>
          <label class="opt-row"><BaseCheckbox v-model="optTtlEnabled" /><span>TTL — expire documents after</span>
            <BaseInput v-model="optTtlSeconds" class="prompt-input sm ttl" :disabled="!optTtlEnabled" placeholder="seconds" /></label>
          <FormField label="Partial filter expression (JSON)">
            <BaseInput v-model="optPartial" class="prompt-input" placeholder='e.g. {"status": "active"}' />
          </FormField>
        </div>

        <!-- Text options tab -->
        <div v-else-if="subtab === 'text'" class="tab-pane">
          <HintText class="pane-note">Applies to <code>text</code> indexes.</HintText>
          <FormField label="Default language">
            <BaseInput v-model="txtDefaultLang" class="prompt-input" placeholder="english" />
          </FormField>
          <FormField label="Language override field">
            <BaseInput v-model="txtLangOverride" class="prompt-input" placeholder="language" />
          </FormField>
          <FormField label="Field weights (JSON)">
            <BaseInput v-model="txtWeights" class="prompt-input" placeholder='e.g. {"title": 10, "body": 1}' />
          </FormField>
        </div>

        <!-- Geo options tab -->
        <div v-else-if="subtab === 'geo'" class="tab-pane">
          <HintText class="pane-note">Applies to <code>2dsphere</code> / <code>2d</code> indexes.</HintText>
          <FormField label="2dsphere index version">
            <BaseInput v-model="geoSphereVersion" class="prompt-input" placeholder="3" />
          </FormField>
          <div class="geo-grid">
            <div>
              <FormField label="Bits (2d)">
                <BaseInput v-model="geoBits" class="prompt-input" placeholder="26" />
              </FormField>
            </div>
            <div>
              <FormField label="Min (2d)">
                <BaseInput v-model="geoMin" class="prompt-input" placeholder="-180" />
              </FormField>
            </div>
            <div>
              <FormField label="Max (2d)">
                <BaseInput v-model="geoMax" class="prompt-input" placeholder="180" />
              </FormField>
            </div>
          </div>
        </div>

        <!-- Collation tab -->
        <div v-else class="tab-pane options-pane">
          <HintText class="pane-note">Set a locale to attach a collation; leave blank for none.</HintText>
          <FormField label="Locale">
            <BaseInput v-model="colLocale" class="prompt-input" placeholder='e.g. en or "simple"' />
          </FormField>
          <div class="geo-grid">
            <div>
              <FormField label="Strength">
                <BaseSelect v-model="colStrength" class="prompt-select" :options="COL_STRENGTH_OPTIONS" />
              </FormField>
            </div>
            <div>
              <FormField label="Case first">
                <BaseSelect v-model="colCaseFirst" class="prompt-select" :options="COL_CASE_FIRST_OPTIONS" />
              </FormField>
            </div>
            <div>
              <FormField label="Alternate">
                <BaseSelect v-model="colAlternate" class="prompt-select" :options="COL_ALTERNATE_OPTIONS" />
              </FormField>
            </div>
          </div>
          <label class="opt-row"><BaseCheckbox v-model="colCaseLevel" /><span>Case level</span></label>
          <label class="opt-row"><BaseCheckbox v-model="colNumericOrdering" /><span>Numeric ordering</span></label>
          <label class="opt-row"><BaseCheckbox v-model="colBackwards" /><span>Backwards (French accent sort)</span></label>
        </div>

        <FieldError :text="shownError" spaced />
      </div>

      <div class="del-footer idx-add-footer">
        <label class="bg-check"><BaseCheckbox v-model="background" /><span>Create in background</span></label>
        <BaseButton size="sm" class="json-btn" @click="toggleJson">{{ jsonMode ? 'Form' : 'JSON' }}</BaseButton>
        <span class="spacer"></span>
        <BaseButton @click="emit('cancel')">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="busy" @click="onSubmit">
          {{ busy ? (mode === 'edit' ? 'Saving…' : 'Creating…') : (mode === 'edit' ? 'Save changes' : 'Create index') }}
        </BaseButton>
      </div>
  </BaseModal>
</template>

<style scoped>
/* Two-class selector so this padding wins over App.css's base .del-body. */
.del-body.idx-add-body {
  display: flex; flex-direction: column;
  padding: 24px 26px 18px;
  max-height: 76vh; overflow-y: auto;
}


.sub-tabs { display: flex; align-items: center; gap: 4px; margin: 20px 0 16px; border-bottom: 1px solid var(--border); }
.json-badge { margin-left: auto; font-size: 11.5px; color: var(--text-faint); padding-bottom: 8px; }

.tab-pane { min-height: 264px; }

.fields-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.fields-table th {
  text-align: left; font-weight: 600; color: var(--text-dim);
  padding: 4px 8px 10px; border-bottom: 1px solid var(--border);
}
.fields-table td { padding: 6px 8px; vertical-align: middle; }
.fc-type { width: 176px; }
.fc-x { width: 40px; text-align: center; }
.prompt-input.sm,
.base-input.prompt-input.sm { padding: 5px 9px; font-size: 12.5px; width: 100%; }
.prompt-input.ttl,
.base-input.prompt-input.ttl { width: 120px; margin-left: 10px; }

.fields-foot { display: flex; align-items: center; gap: 14px; margin-top: 16px; }
.kind-label { font-size: 12px; color: var(--text-faint); }

.options-pane { display: flex; flex-direction: column; gap: 6px; }
.opt-row { display: flex; align-items: center; gap: 9px; font-size: 12.5px; color: var(--text); padding: 7px 0; }
.pane-note { margin: 0 0 12px; }
.pane-note code { font-family: var(--mono); font-size: 11.5px; }
.geo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px 16px; margin-top: 6px; }

.json-pane { min-height: 264px; }
.base-textarea.json-area { min-height: 280px; }

.idx-add-footer { display: flex; align-items: center; gap: 14px; }
.bg-check { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--text); }
.json-btn { margin-left: 4px; }
</style>
