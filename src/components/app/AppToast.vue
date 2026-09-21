<script setup>
import { toast } from '../../stores/toast'
</script>

<template>
  <div v-if="toast" class="toast">{{ toast }}</div>
</template>

<style scoped>
.toast {
  position: fixed;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-hover);
  border: 1px solid var(--border-soft);
  color: var(--text);
  padding: 9px 16px;
  border-radius: 8px;
  font-size: 12.5px;
  box-shadow: 0 12px 30px rgba(0,0,0,.5);
  z-index: 80;
  white-space: nowrap;
}
</style>
