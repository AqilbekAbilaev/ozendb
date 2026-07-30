<script setup>
import { inject } from 'vue'
import { MODALS } from '../../constants/modalRegistry'
import BaseIcon from '../base/BaseIcon.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseSelect from '../base/BaseSelect.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseRadio from '../base/BaseRadio.vue'
import BaseTextarea from '../base/BaseTextarea.vue'
import FieldError from '../base/FieldError.vue'
import { indexSpecJson } from '../../utils/indexSpec'
import SshHostKeyModal from '../connection/SshHostKeyModal.vue'

// Single provide/inject from App.vue. Each group is destructured back to the same
// identifier names the moved template already uses, so that template is verbatim.
const ctx = inject('appModals')

// Time-series granularity options for the Add Collection dialog's BaseSelect.
const GRANULARITY_OPTIONS = [
  { value: '', label: 'Auto' },
  { value: 'seconds', label: 'Seconds' },
  { value: 'minutes', label: 'Minutes' },
  { value: 'hours', label: 'Hours' },
]

const { openModals, closeModal } = ctx.modals

// Registry-driven modals are bound generically: every modal gets `close`; node-targeted
// modals (level set) also get their `target`; modals listed in App.vue's modalEmits/modalProps
// get those extra events/props too. See constants/modalRegistry.js.
const modalEmits = ctx.modalEmits
const modalProps = ctx.modalProps
function modalListeners(id) {
  return { close: () => closeModal(id), ...(modalEmits[id] || {}) }
}
function modalBindings(id, payload) {
  const extra = modalProps[id] ? modalProps[id]() : {}
  return MODALS[id].level ? { target: payload, ...extra } : extra
}

// The Index Manager list/form now lives in IndexManagerPane (the 'indexes' tab).
// AppModals only keeps the two index dialogs that overlay it: View Details and the
// type-to-confirm Drop.
const {
  indexDetailsTarget,
  indexDetailsStats,
  indexDetailsLoading,
  dropIndexTarget,
  dropIndexConfirmText,
  dropIndexError,
  dropIndexBusy,
  confirmDropIndex,
  formatIndexSince,
} = ctx.indexes

const {
  addCollectionTarget,
  newCollectionName,
  newCollectionType,
  newCollectionOpts,
  addCollectionError,
  addCollectionSaving,
  addViewTarget,
  newViewName,
  newViewSource,
  newViewPipeline,
  addViewError,
  addViewSaving,
  dropDatabaseTarget,
  dropDatabaseError,
  dropDatabaseDeleting,
  dropCollectionTarget,
  dropCollectionError,
  dropCollectionDeleting,
  renameCollectionTarget,
  renameCollectionName,
  renameCollectionError,
  renameCollectionSaving,
  duplicateCollectionTarget,
  duplicateCollectionName,
  duplicateCollectionError,
  duplicateCollectionSaving,
  addDatabaseTarget,
  newDatabaseName,
  newDatabaseCollName,
  addDatabaseError,
  addDatabaseSaving,
  confirmAddCollection,
  confirmAddView,
  confirmDropDatabase,
  confirmDropCollection,
  confirmRenameCollection,
  confirmDuplicateCollection,
  confirmAddDatabase,
} = ctx.dbActions

const {
  sshHostKeyPrompt,
  sshHostKeyChanged,
  onHostKeyTrust,
  onHostKeyCancel,
  onHostKeyForget,
} = ctx.ssh

const { renameTabTarget, renameTabValue, confirmRenameTab } = ctx.tabRename
</script>

<template>
    <!-- Every registry-driven modal renders from this one block (constants/modalRegistry.js):
         `close` is always wired; node-targeted modals also get their `target`, and any
         extra props/events come from App.vue's modalProps/modalEmits. Adding a modal needs
         no change here. -->
    <component
      v-for="(payload, id) in openModals"
      :is="MODALS[id].component"
      :key="id"
      v-bind="modalBindings(id, payload)"
      v-on="modalListeners(id)"
    />

    <!-- SSH host-key trust prompt / changed-key warning -->
    <SshHostKeyModal
      :prompt="sshHostKeyPrompt"
      :changed="sshHostKeyChanged"
      @trust="onHostKeyTrust"
      @cancel="onHostKeyCancel"
      @forget="onHostKeyForget"
      @dismiss="sshHostKeyChanged = null"
    />

    <!-- Add Collection modal -->
    <BaseModal v-if="addCollectionTarget" title="Add Collection" @close="addCollectionTarget = null">
        <div class="del-body">
          <BaseInput
            v-model="newCollectionName"
            class="prompt-input"
            placeholder="Collection name"
            @keydown.enter="confirmAddCollection"
          />
          <div class="cc-types">
            <label class="cc-type"><BaseRadio value="standard" v-model="newCollectionType" /> Standard</label>
            <label class="cc-type"><BaseRadio value="capped" v-model="newCollectionType" /> Capped</label>
            <label class="cc-type"><BaseRadio value="timeseries" v-model="newCollectionType" /> Time-series</label>
            <label class="cc-type"><BaseRadio value="clustered" v-model="newCollectionType" /> Clustered</label>
          </div>

          <div v-if="newCollectionType === 'capped'" class="cc-opts">
            <label class="cc-field">
              <span class="cc-label">Max size (bytes)</span>
              <BaseInput v-model="newCollectionOpts.size" class="prompt-input" type="number" min="1" placeholder="e.g. 1048576" @keydown.enter="confirmAddCollection" />
            </label>
            <label class="cc-field">
              <span class="cc-label">Max documents <span class="cc-opt">(optional)</span></span>
              <BaseInput v-model="newCollectionOpts.max" class="prompt-input" type="number" min="1" placeholder="e.g. 1000" @keydown.enter="confirmAddCollection" />
            </label>
          </div>

          <div v-else-if="newCollectionType === 'timeseries'" class="cc-opts">
            <label class="cc-field">
              <span class="cc-label">Time field</span>
              <BaseInput v-model="newCollectionOpts.timeField" class="prompt-input" placeholder="e.g. timestamp" @keydown.enter="confirmAddCollection" />
            </label>
            <label class="cc-field">
              <span class="cc-label">Meta field <span class="cc-opt">(optional)</span></span>
              <BaseInput v-model="newCollectionOpts.metaField" class="prompt-input" placeholder="e.g. metadata" @keydown.enter="confirmAddCollection" />
            </label>
            <label class="cc-field">
              <span class="cc-label">Granularity <span class="cc-opt">(optional)</span></span>
              <BaseSelect v-model="newCollectionOpts.granularity" class="prompt-select" :options="GRANULARITY_OPTIONS" />
            </label>
            <label class="cc-field">
              <span class="cc-label">Expire after (seconds) <span class="cc-opt">(optional)</span></span>
              <BaseInput v-model="newCollectionOpts.expireAfterSeconds" class="prompt-input" type="number" min="1" placeholder="e.g. 86400" @keydown.enter="confirmAddCollection" />
            </label>
          </div>

          <div v-else-if="newCollectionType === 'clustered'" class="cc-opts">
            <p class="cc-hint">Documents are stored in <code>_id</code> order (clustered index on <code>{ _id: 1 }</code>).</p>
            <label class="cc-field">
              <span class="cc-label">Index name <span class="cc-opt">(optional)</span></span>
              <BaseInput v-model="newCollectionOpts.clusteredIndexName" class="prompt-input" placeholder="e.g. events_clustered" @keydown.enter="confirmAddCollection" />
            </label>
          </div>

          <FieldError :text="addCollectionError" spaced />
        </div>
        <div class="del-footer">
          <span class="spacer"></span>
          <BaseButton @click="addCollectionTarget = null">Cancel</BaseButton>
          <BaseButton variant="primary" :disabled="!newCollectionName.trim() || addCollectionSaving" @click="confirmAddCollection">
            {{ addCollectionSaving ? 'Creating…' : 'Create' }}
          </BaseButton>
        </div>
  </BaseModal>

    <!-- Add View modal -->
    <BaseModal v-if="addViewTarget" title="Add View" @close="addViewTarget = null">
        <div class="del-body">
          <BaseInput
            v-model="newViewName"
            class="prompt-input"
            placeholder="View name"
          />
          <BaseInput
            v-model="newViewSource"
            class="prompt-input"
            placeholder="Source collection (viewOn)"
          />
          <BaseTextarea
            v-model="newViewPipeline"
            class="pipeline-input"
            placeholder="Aggregation pipeline (optional), e.g. [ { &quot;$match&quot;: { &quot;active&quot;: true } } ]"
            spellcheck="false"
          ></BaseTextarea>
          <FieldError :text="addViewError" spaced />
        </div>
        <div class="del-footer">
          <span class="spacer"></span>
          <BaseButton @click="addViewTarget = null">Cancel</BaseButton>
          <BaseButton variant="primary" :disabled="!newViewName.trim() || !newViewSource.trim() || addViewSaving" @click="confirmAddView">
            {{ addViewSaving ? 'Creating…' : 'Create' }}
          </BaseButton>
        </div>
  </BaseModal>

    <!-- Rename Tab modal -->
    <BaseModal v-if="renameTabTarget" title="Rename Tab" @close="renameTabTarget = null">
        <div class="del-body">
          <BaseInput
            v-model="renameTabValue"
            class="prompt-input"
            placeholder="Tab name"
            @keydown.enter="confirmRenameTab"
            @keydown.escape="renameTabTarget = null"
          />
        </div>
        <div class="del-footer">
          <span class="spacer"></span>
          <BaseButton @click="renameTabTarget = null">Cancel</BaseButton>
          <BaseButton variant="primary" :disabled="!renameTabValue.trim()" @click="confirmRenameTab">Rename</BaseButton>
        </div>
  </BaseModal>

    <!-- Drop Database confirm -->
    <BaseModal v-if="dropDatabaseTarget" title="Drop Database" @close="dropDatabaseTarget = null">
        <div class="del-body">
          <p>Are you sure you want to drop "<strong>{{ dropDatabaseTarget.dbName }}</strong>"? This deletes all of its collections and cannot be undone.</p>
          <FieldError :text="dropDatabaseError" spaced />
        </div>
        <div class="del-footer">
          <span class="spacer"></span>
          <BaseButton @click="dropDatabaseTarget = null">Cancel</BaseButton>
          <BaseButton variant="danger" :disabled="dropDatabaseDeleting" @click="confirmDropDatabase">
            {{ dropDatabaseDeleting ? 'Dropping…' : 'Drop' }}
          </BaseButton>
        </div>
  </BaseModal>

    <!-- Drop Collection confirm -->
    <BaseModal v-if="dropCollectionTarget" title="Drop Collection" @close="dropCollectionTarget = null">
        <div class="del-body">
          <p>Are you sure you want to drop "<strong>{{ dropCollectionTarget.collName }}</strong>"? This deletes all of its documents and cannot be undone.</p>
          <FieldError :text="dropCollectionError" spaced />
        </div>
        <div class="del-footer">
          <span class="spacer"></span>
          <BaseButton @click="dropCollectionTarget = null">Cancel</BaseButton>
          <BaseButton variant="danger" :disabled="dropCollectionDeleting" @click="confirmDropCollection">
            {{ dropCollectionDeleting ? 'Dropping…' : 'Drop' }}
          </BaseButton>
        </div>
  </BaseModal>

    <!-- Rename Collection modal -->
    <BaseModal v-if="renameCollectionTarget" title="Rename Collection" @close="renameCollectionTarget = null">
        <div class="del-body">
          <BaseInput
            v-model="renameCollectionName"
            class="prompt-input"
            placeholder="New collection name"
            @keydown.enter="confirmRenameCollection"
          />
          <FieldError :text="renameCollectionError" spaced />
        </div>
        <div class="del-footer">
          <span class="spacer"></span>
          <BaseButton @click="renameCollectionTarget = null">Cancel</BaseButton>
          <BaseButton variant="primary" :disabled="!renameCollectionName.trim() || renameCollectionName.trim() === renameCollectionTarget.collName || renameCollectionSaving" @click="confirmRenameCollection">
            {{ renameCollectionSaving ? 'Renaming…' : 'Rename' }}
          </BaseButton>
        </div>
  </BaseModal>

    <!-- Duplicate Collection prompt -->
    <BaseModal v-if="duplicateCollectionTarget" title="Duplicate Collection" @close="duplicateCollectionTarget = null">
        <div class="del-body">
          <BaseInput
            v-model="duplicateCollectionName"
            class="prompt-input"
            placeholder="New collection name"
            @keydown.enter="confirmDuplicateCollection"
          />
          <FieldError :text="duplicateCollectionError" spaced />
        </div>
        <div class="del-footer">
          <span class="spacer"></span>
          <BaseButton @click="duplicateCollectionTarget = null">Cancel</BaseButton>
          <BaseButton variant="primary" :disabled="!duplicateCollectionName.trim() || duplicateCollectionName.trim() === duplicateCollectionTarget.collName || duplicateCollectionSaving" @click="confirmDuplicateCollection">
            {{ duplicateCollectionSaving ? 'Duplicating…' : 'Duplicate' }}
          </BaseButton>
        </div>
  </BaseModal>

    <!-- Add Database modal -->
    <BaseModal v-if="addDatabaseTarget" title="Add Database" @close="addDatabaseTarget = null">
        <div class="del-body">
          <BaseInput
            v-model="newDatabaseName"
            class="prompt-input"
            placeholder="Database name"
          />
          <BaseInput
            v-model="newDatabaseCollName"
            class="prompt-input"
            style="margin-top:8px"
            placeholder="First collection name"
            @keydown.enter="confirmAddDatabase"
          />
          <p style="margin-top:8px;color:var(--text-faint);font-size:12px">MongoDB only creates a database once it holds a collection, so a first collection is required.</p>
          <FieldError :text="addDatabaseError" spaced />
        </div>
        <div class="del-footer">
          <span class="spacer"></span>
          <BaseButton @click="addDatabaseTarget = null">Cancel</BaseButton>
          <BaseButton variant="primary" :disabled="!newDatabaseName.trim() || !newDatabaseCollName.trim() || addDatabaseSaving" @click="confirmAddDatabase">
            {{ addDatabaseSaving ? 'Creating…' : 'Create' }}
          </BaseButton>
        </div>
  </BaseModal>

    <!-- Index: View Details (read-only) -->
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
          <span class="spacer"></span>
          <BaseButton @click="indexDetailsTarget = null">Close</BaseButton>
        </div>
  </BaseModal>

    <!-- Index: Drop confirmation (type the name to confirm) -->
    <BaseModal v-if="dropIndexTarget" title="Drop Index" @close="dropIndexTarget = null">
        <div class="del-body">
          <p>This permanently drops the index
            <code>{{ dropIndexTarget.name }}</code>. Queries that relied on it may slow down.
            This cannot be undone.</p>
          <p class="cc-prompt">Type <code>{{ dropIndexTarget.name }}</code> to confirm:</p>
          <BaseInput
            class="prompt-input"
            v-model="dropIndexConfirmText"
            autocomplete="off"
            @keydown.enter="confirmDropIndex"
          />
          <FieldError :text="dropIndexError" spaced />
        </div>
        <div class="del-footer">
          <span class="spacer"></span>
          <BaseButton @click="dropIndexTarget = null">Cancel</BaseButton>
          <BaseButton
            variant="danger"
            :disabled="dropIndexBusy || dropIndexConfirmText !== dropIndexTarget.name"
            @click="confirmDropIndex"
          >{{ dropIndexBusy ? 'Dropping…' : 'Drop Index' }}</BaseButton>
        </div>
  </BaseModal>
</template>

<!-- Same stylesheet App.vue uses; scoped here so the dialog classes (.del-*, .idx-*,
     .btn, …) apply to these modals without leaking globally to other components. -->
<style src="../../App.css" scoped></style>
