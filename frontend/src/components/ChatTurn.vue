<script setup lang="ts">
import type { ChatTurn } from "../types";
import MarkdownContent from "./MarkdownContent.vue";
import ToolCard from "./ToolCard.vue";

defineProps<{ turn: ChatTurn }>();
</script>

<template>
  <section class="turn">
    <div class="message message--user">{{ turn.userText }}</div>
    <div v-if="turn.tools.length || !turn.done" class="turn__process">
      <div class="process-label"><span class="process-dot"></span>{{ turn.statusText }}</div>
      <div v-if="turn.plan?.steps.length" class="plan-card">
        <span class="plan-card__title">分析计划</span>
        <span v-for="step in turn.plan.steps" :key="step.id" class="plan-step">{{ step.purpose }}</span>
      </div>
      <ToolCard v-for="tool in turn.tools" :key="tool.id" :tool="tool" />
      <div v-if="turn.verification || turn.evidenceCount" class="evidence-summary">
        <span v-if="turn.verification">校验：{{ turn.verification.status === "passed" ? "通过" : turn.verification.status === "warning" ? "需关注" : "未通过" }}</span>
        <span v-if="turn.evidenceCount">证据 {{ turn.evidenceCount }} 条</span>
      </div>
    </div>
    <div v-if="turn.answer" class="message message--assistant">
      <div class="assistant-label"><span class="assistant-mark">D</span> DataAgent</div>
      <MarkdownContent :source="turn.answer" />
    </div>
    <div v-if="turn.error" class="error-message">{{ turn.error }}</div>
  </section>
</template>
