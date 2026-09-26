<script setup>
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseSelect from '../../../components/base/BaseSelect.vue'
import FormField from '../../../components/base/FormField.vue'
import { AUTH_MODE_OPTIONS, OIDC_ENVIRONMENTS } from '../../../data/connectionOptions.js'

const props = defineProps({
  form: { type: Object, required: true },
})
const { isEditMode, authMode, username, password, authDb, oidcEnvironment, oidcTokenResource, oidcNeedsResource } = props.form
</script>

<template>
  <FormField label="Authentication mode">
    <BaseSelect class="nc-sel" v-model="authMode" :options="AUTH_MODE_OPTIONS">
      <template #option="{ option }">
        <span>{{ option.label }}</span>
        <span v-if="option.soon" class="nc-soon">soon</span>
      </template>
    </BaseSelect>
  </FormField>

  <template v-if="authMode !== 'none' && authMode !== 'OIDC'">
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
    <FormField label="Authentication DB">
      <BaseInput class="nc-input" v-model="authDb" :placeholder="authMode === 'PLAIN' ? '$external' : 'admin'" />
    </FormField>
    <div v-if="authMode === 'PLAIN'" class="nc-hint">
      LDAP (PLAIN) requires SSL/TLS. Enable SSL in the SSL tab.
    </div>
  </template>

  <template v-else-if="authMode === 'OIDC'">
    <FormField label="Environment">
      <BaseSelect class="nc-sel" v-model="oidcEnvironment" :options="OIDC_ENVIRONMENTS" />
    </FormField>
    <FormField v-if="oidcNeedsResource" label="Token resource">
      <BaseInput class="nc-input" v-model="oidcTokenResource" placeholder="e.g. api://&lt;app-id&gt;" />
    </FormField>
    <div class="nc-hint">
      Workload-identity OIDC: the token is obtained from the {{ oidcEnvironment }} environment — no username or password.
      Interactive (device-flow) OIDC isn't supported yet.
    </div>
  </template>
</template>

<!-- Scoped styles don't reach into child components, so each section scopes the
     editor's stylesheet itself. -->
<style src="../../../components/connection/NewConnection.css" scoped></style>
