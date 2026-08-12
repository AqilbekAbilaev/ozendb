<script setup>
import { ref, computed, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseCheckbox from '../base/BaseCheckbox.vue'
import StateMessage from '../base/StateMessage.vue'
import { summarize, buildIssueUrl } from '../../utils/errorReport'

// Help → Report a Problem. Lists the defects OzenDB recorded about itself and opens a
// prefilled GitHub issue. Nothing is transmitted from here: the button opens the user's
// browser on an issue form they can read and edit before posting.
//
// Failed logins, unreachable hosts and rejected queries are deliberately absent — the
// backend records only what a code change could fix (error_log::is_defect).
defineEmits(['close'])

const records = ref([])
const context = ref({ version: '', os: '', arch: '' })
const includeDetail = ref(false)
const loading = ref(true)

const summary = computed(() => summarize(records.value))
// Newest first: the failure the user just hit is the one they came here about.
const newestFirst = computed(() => [...records.value].reverse())

onMounted(async () => {
  try {
    records.value = await invoke('list_error_log')
    context.value = await invoke('error_report_context')
  } catch (e) {
    // Leaving the list empty is the honest outcome; the modal shows its empty state.
  }
  loading.value = false
})

function report() {
  openUrl(buildIssueUrl(records.value, context.value, includeDetail.value)).catch(() => {})
}

async function clearLog() {
  try {
    await invoke('clear_error_log')
    records.value = []
  } catch (e) {
    // Nothing useful to say if the log won't clear; the list simply stays as it is.
  }
}

function when(at) {
  return new Date(at).toLocaleString()
}
</script>

<template>
  <BaseModal title="Report a Problem" width="620px" max-width="94vw" @close="$emit('close')">
    <div class="er-body">
      <template v-if="!loading && !records.length">
        <StateMessage mode="empty" label="Nothing to report" />
        <p class="er-lead er-centered">
          OzenDB hasn't recorded any problems of its own. Connection and query errors
          aren't listed here — those come from your server, not from a bug in the app.
        </p>
      </template>

      <template v-else-if="!loading">
        <p class="er-lead">
          These are problems inside OzenDB itself. Reporting them opens a prefilled issue on
          GitHub in your browser — nothing is sent until you post it.
        </p>

        <div class="er-summary">
          <span v-for="row in summary" :key="row.code" class="er-chip">
            {{ row.code }} × {{ row.count }}
          </span>
        </div>

        <ul class="er-list">
          <li v-for="(r, i) in newestFirst" :key="i">
            <span class="er-code">{{ r.code }}</span>
            <span class="er-when">{{ when(r.at) }}</span>
            <span class="er-msg">{{ r.message }}</span>
          </li>
        </ul>

        <label class="er-detail">
          <BaseCheckbox v-model="includeDetail" />
          <span>
            Include the messages above in the report.
            <em>They may name your hosts, databases or documents.</em>
          </span>
        </label>
      </template>
    </div>

    <div class="er-footer">
      <BaseButton v-if="records.length" @click="clearLog">Clear log</BaseButton>
      <span class="spacer"></span>
      <BaseButton @click="$emit('close')">Close</BaseButton>
      <BaseButton v-if="records.length" variant="primary" @click="report">Report on GitHub</BaseButton>
    </div>
  </BaseModal>
</template>

<style scoped>
.er-body { padding: 16px 20px; }
.er-lead { margin: 0 0 12px; font-size: 12.5px; color: var(--text-dim); line-height: 1.5; }

.er-summary { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.er-chip {
  font-family: var(--mono);
  font-size: 11.5px;
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid var(--border-soft);
  color: var(--text-dim);
}

.er-list {
  list-style: none;
  margin: 0 0 14px;
  padding: 0;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
}
.er-list li {
  display: grid;
  grid-template-columns: 88px 150px 1fr;
  gap: 8px;
  padding: 7px 10px;
  font-size: 12px;
  border-bottom: 1px solid var(--border-soft);
}
.er-list li:last-child { border-bottom: none; }
.er-code { font-family: var(--mono); color: var(--danger); }
.er-when { color: var(--text-faint); }
.er-msg { font-family: var(--mono); word-break: break-word; color: var(--text-dim); }

.er-detail { display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; line-height: 1.45; }
.er-detail em { color: var(--text-faint); font-style: normal; }

.er-footer { display: flex; gap: 8px; align-items: center; padding: 12px 20px; border-top: 1px solid var(--border); }
.spacer { flex: 1; }
</style>
