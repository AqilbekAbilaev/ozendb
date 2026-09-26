<script setup>
import BaseIcon from '../../../components/base/BaseIcon.vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import FormField from '../../../components/base/FormField.vue'

const props = defineProps({
  form: { type: Object, required: true },
})
const { useTls, tlsCaFile, tlsCertKeyFile, tlsAllowInvalidCerts, pickTlsFile, pickClientCert } = props.form
</script>

<template>
  <label class="chk-line big" @click="useTls = !useTls">
    <span class="cb" :class="{ on: useTls }"><BaseIcon v-if="useTls" name="check" :size="12" /></span>
    Use SSL/TLS protocol to connect
  </label>

  <template v-if="useTls">
    <FormField label="Certificate Authority (.pem)">
      <div class="nc-file-row">
        <BaseInput class="nc-input" v-model="tlsCaFile" placeholder="Path to CA certificate" />
        <BaseButton bordered type="button" @click="pickTlsFile">Browse…</BaseButton>
      </div>
    </FormField>

    <FormField label="Client Certificate + Key (.pem)">
      <div class="nc-file-row">
        <BaseInput class="nc-input" v-model="tlsCertKeyFile" placeholder="Path to client certificate (optional)" />
        <BaseButton bordered type="button" @click="pickClientCert">Browse…</BaseButton>
      </div>
    </FormField>

    <label class="chk-line" @click="tlsAllowInvalidCerts = !tlsAllowInvalidCerts">
      <span class="cb" :class="{ on: tlsAllowInvalidCerts }"><BaseIcon v-if="tlsAllowInvalidCerts" name="check" :size="12" /></span>
      Allow invalid certificates (accept self-signed / expired)
    </label>
    <div class="nc-hint">A Certificate Authority file verifies the server securely; “allow invalid certificates” skips that check.</div>
  </template>
</template>

<!-- Scoped styles don't reach into child components, so each section scopes the
     editor's stylesheet itself. -->
<style src="../../../components/connection/NewConnection.css" scoped></style>
