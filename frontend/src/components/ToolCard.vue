<script setup lang="ts">
import type { ToolState } from "../types";

defineProps<{ tool: ToolState }>();
const labels: Record<string, string> = {
  query_sales: "查询销售数据",
  compare_periods: "比较两个期间",
  breakdown_metric: "拆解指标变化",
};
</script>

<template>
  <article class="tool-card" :class="{ error: tool.isError }">
    <div class="tool-card__header">
      <span class="tool-icon">✦</span>
      <strong>{{ labels[tool.name] || tool.name }}</strong>
      <span class="tool-status">{{ tool.status === "running" ? "执行中" : tool.isError ? "需关注" : "已完成" }}</span>
    </div>
    <code class="tool-args">{{ JSON.stringify(tool.args) }}</code>
    <div v-if="tool.status === 'running'" class="tool-loading"><i></i><i></i><i></i></div>
    <pre v-else class="tool-result">{{ tool.result }}</pre>
  </article>
</template>
