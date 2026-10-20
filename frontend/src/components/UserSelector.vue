<script setup lang="ts">
import type { UserSummary } from "../types";

defineProps<{ users: UserSummary[]; modelValue: string; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <label class="user-selector">
    <span>分析身份</span>
    <select :value="modelValue" :disabled="disabled" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
      <option v-for="user in users" :key="user.id" :value="user.id">
        {{ user.name }} · {{ user.role }} · {{ user.dataScope }}
      </option>
    </select>
  </label>
</template>
