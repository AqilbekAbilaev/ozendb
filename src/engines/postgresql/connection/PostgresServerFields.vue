<script setup>
import BaseInput from '../../../components/base/BaseInput.vue'
import FormField from '../../../components/base/FormField.vue'

const props = defineProps({
  form: { type: Object, required: true },
})
const { hosts, database } = props.form
</script>

<template>
  <FormField label="Server">
    <div v-for="(h, i) in hosts" :key="i" class="nc-inline nc-host-row">
      <BaseInput class="nc-input" v-model="h.host" style="flex:3" placeholder="localhost" />
      <span class="nc-colon">:</span>
      <BaseInput class="nc-input" v-model="h.port" type="number" style="flex:1" />
    </div>
  </FormField>
  <FormField label="Database">
    <BaseInput class="nc-input" v-model="database" placeholder="postgres" />
  </FormField>
</template>

<!-- Scoped styles don't reach into child components, so each section scopes the
     editor's stylesheet itself. -->
<style src="../../../components/connection/NewConnection.css" scoped></style>
