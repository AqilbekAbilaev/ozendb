<script setup>
import BaseIcon from '../../../components/base/BaseIcon.vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseSelect from '../../../components/base/BaseSelect.vue'
import SegmentedControl from '../../../components/base/SegmentedControl.vue'
import FormField from '../../../components/base/FormField.vue'
import { READ_PREF_OPTIONS } from '../../../data/connectionOptions.js'

const props = defineProps({
  form: { type: Object, required: true },
})
const { hosts, connType, replicaSetName, readPreference, isMultiHost, addHost, removeHost } = props.form
</script>

<template>
  <FormField label="Connection type">
    <SegmentedControl
      class="nc-seg"
      :model-value="connType"
      :options="[{ value: 'standalone', label: 'Standalone' }, { value: 'replica', label: 'Replica Set' }, { value: 'sharded', label: 'Sharded' }, { value: 'srv', label: 'DNS Seedlist (SRV)' }]"
      @update:model-value="connType = $event"
    />
  </FormField>
  <FormField :label="connType === 'srv' ? 'Server (SRV hostname)' : (isMultiHost ? 'Server(s)' : 'Server')">
    <BaseInput v-if="connType === 'srv'" class="nc-input" v-model="hosts[0].host" placeholder="cluster.example.com" />
    <template v-else>
      <div v-for="(h, i) in hosts" :key="i" class="nc-inline nc-host-row">
        <BaseInput class="nc-input" v-model="h.host" style="flex:3" placeholder="localhost" />
        <span class="nc-colon">:</span>
        <BaseInput class="nc-input" v-model="h.port" type="number" style="flex:1" />
        <BaseButton v-if="isMultiHost && hosts.length > 1" icon="close" :icon-size="12" title="Remove host" @click="removeHost(i)" />
      </div>
      <BaseButton v-if="isMultiHost" variant="ghost" size="sm" class="nc-host-add" @click="addHost">
        <BaseIcon name="plus" :size="12" /> Add host
      </BaseButton>
    </template>
  </FormField>
  <FormField v-if="connType === 'replica'" label="Replica set name">
    <BaseInput class="nc-input" v-model="replicaSetName" placeholder="myReplicaSet" />
  </FormField>
  <FormField v-if="connType !== 'standalone'" label="Read preference">
    <BaseSelect class="nc-sel" v-model="readPreference" :options="READ_PREF_OPTIONS" />
  </FormField>
</template>

<!-- Scoped styles don't reach into child components, so each section scopes the
     editor's stylesheet itself. -->
<style src="../../../components/connection/NewConnection.css" scoped></style>
