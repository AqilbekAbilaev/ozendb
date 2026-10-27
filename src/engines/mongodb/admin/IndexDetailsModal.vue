<script setup>
import * as indexesStore from './indexes'
import { indexSpecJson } from './indexSpec'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import FlexSpacer from '../../../components/base/FlexSpacer.vue'

// Index: View Details (read-only), over the Index Manager tab. Always mounted (see
// MOUNTED_DIALOGS in engines/ui.js); it shows itself while indexes.js holds a target.
const {
  indexDetailsTarget,
  indexDetailsStats,
  indexDetailsLoading,
  formatIndexSince,
} = indexesStore
</script>

<template>
  <BaseModal v-if="indexDetailsTarget" :title="`Index Details — ${indexDetailsTarget.name}`" width="560px" @close="indexDetailsTarget = null">
      <div class="del-body">
        <div class="idx-detail-section">Definition</div>
        <pre class="idx-detail-json">{{ indexSpecJson(indexDetailsTarget) }}</pre>
        <div class="idx-detail-section">Usage</div>
        <div v-if="indexDetailsLoading" class="idx-msg">Loading usage…</div>
        <table v-else-if="indexDetailsStats" class="idx-detail-stats">
          <tbody>
            <tr><td>Operations</td><td>{{ indexDetailsStats.accesses?.ops ?? '—' }}</td></tr>
            <tr><td>Tracking since</td><td>{{ formatIndexSince(indexDetailsStats.accesses?.since) }}</td></tr>
          </tbody>
        </table>
        <div v-else class="idx-msg">Usage statistics unavailable.</div>
      </div>
      <div class="del-footer">
        <FlexSpacer />
        <BaseButton @click="indexDetailsTarget = null">Close</BaseButton>
      </div>
  </BaseModal>
</template>
