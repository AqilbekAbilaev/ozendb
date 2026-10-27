<script setup>
// MongoDB's saved-query browser, always mounted (see MOUNTED_DIALOGS in engines/ui.js) so
// it stays on screen across tab switches. The dialog itself mounts afresh on each open.
import QueryBrowserModal from './QueryBrowserModal.vue'
import { useSavedQueryBrowser, watchSavedQueryBrowserTriggers } from './useSavedQueryBrowser'

const { isOpen, close, apply } = useSavedQueryBrowser()
watchSavedQueryBrowserTriggers()
</script>

<template>
  <QueryBrowserModal v-if="isOpen" @close="close" @apply="apply" />
</template>
