<script setup>
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseSelect from '../../../components/base/BaseSelect.vue'
import Disclosure from '../../../components/base/Disclosure.vue'
import FormField from '../../../components/base/FormField.vue'
import HintText from '../../../components/base/HintText.vue'
import { OPTION_GROUPS, BOOL_OPTIONS, enumOptions } from '../../../data/connectionOptions.js'

const props = defineProps({
  form: { type: Object, required: true },
})
const { advancedOptions, optionVisible, optionDisabled, groupSetCount, openGroups, toggleGroup } = props.form
</script>

<template>
  <div class="nc-hint nc-adv-intro">
    Optional MongoDB driver parameters. Leave a field empty to use the driver default.
  </div>

  <template v-for="group in OPTION_GROUPS" :key="group.title">
    <Disclosure
      class="nc-adv-group"
      :model-value="openGroups[group.title]"
      @update:model-value="toggleGroup(group.title)"
    >
      <span class="nc-adv-group-t">{{ group.title }}</span>
      <span v-if="groupSetCount(group)" class="nc-adv-badge">{{ groupSetCount(group) }} set</span>
    </Disclosure>
    <template v-if="openGroups[group.title]">
      <template v-for="opt in group.options" :key="opt.key">
      <FormField v-if="optionVisible(opt)">
        <template #label>
          {{ opt.label }}
          <span class="nc-adv-key">{{ opt.key }}</span>
        </template>

        <BaseSelect
          v-if="opt.type === 'bool'"
          class="nc-sel"
          v-model="advancedOptions[opt.key]"
          :options="BOOL_OPTIONS"
          :disabled="optionDisabled(opt)"
        />

        <BaseSelect
          v-else-if="opt.type === 'enum'"
          class="nc-sel"
          v-model="advancedOptions[opt.key]"
          :options="enumOptions(opt)"
          :disabled="optionDisabled(opt)"
        />

        <BaseInput
          v-else
          class="nc-input"
          :type="opt.type === 'int' ? 'number' : 'text'"
          v-model="advancedOptions[opt.key]"
          :placeholder="opt.placeholder || ''"
          :disabled="optionDisabled(opt)"
        />

        <HintText v-if="opt.hint">{{ opt.hint }}</HintText>
      </FormField>
      </template>
    </template>
  </template>
</template>

<!-- Scoped styles don't reach into child components, so each section scopes the
     editor's stylesheet itself. -->
<style src="../../../components/connection/NewConnection.css" scoped></style>
