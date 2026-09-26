<script setup>
import BaseInput from '../../../components/base/BaseInput.vue'
import FormField from '../../../components/base/FormField.vue'

const props = defineProps({
  form: { type: Object, required: true },
})
const { isEditMode, username, password } = props.form
</script>

<template>
  <FormField label="User name">
    <BaseInput class="nc-input" v-model="username" />
  </FormField>
  <FormField label="Password">
    <BaseInput
      class="nc-input"
      type="password"
      v-model="password"
      :placeholder="isEditMode ? 'Leave blank to keep existing password' : ''"
    />
  </FormField>
</template>

<!-- Scoped styles don't reach into child components, so each section scopes the
     editor's stylesheet itself. -->
<style src="../../../components/connection/NewConnection.css" scoped></style>
