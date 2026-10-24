<script setup>
import BaseIcon from '../../../components/base/BaseIcon.vue'

// A table's or view's opened columns, below its row: `columns` is null while they load,
// and `indent` is the padding of the row they open from.
defineProps({
  columns: { type: Array, default: null },
  indent: { type: Number, required: true },
})
</script>

<template>
  <div class="tnode" :style="{ paddingLeft: indent + 15 + 'px' }">
    <span class="tw empty"><BaseIcon name="caret" :size="12" /></span>
    <span class="ti"><BaseIcon name="folder" :size="15" /></span>
    <span class="tt">Columns</span>
    <span class="cnt">({{ columns?.length ?? '…' }})</span>
  </div>
  <div
    v-for="col in columns ?? []"
    :key="col.name"
    class="tnode col-node"
    :style="{ paddingLeft: indent + 45 + 'px' }"
  >
    <span class="ti" :class="{ pk: col.primaryKey, fk: col.references }">
      <BaseIcon :name="col.primaryKey ? 'key' : col.references ? 'uri' : 'textType'" :size="13" />
    </span>
    <span class="tt">{{ col.name }}</span>
    <span class="tmeta">{{ col.dataType }}<template v-if="col.primaryKey"> · PK</template><template v-if="col.references"> → {{ col.references }}</template><template v-if="!col.nullable && !col.primaryKey"> · not null</template></span>
  </div>
</template>

<style src="../../../components/connection/ConnectionTree.css" scoped></style>

<style scoped>
.col-node { cursor: default; }
.ti.pk { color: var(--warn); }
.ti.fk { color: var(--link); }
.tmeta { margin-left: 6px; font: 11px var(--mono); color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; }
</style>
