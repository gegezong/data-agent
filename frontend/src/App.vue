<script setup lang="ts">
import { onMounted, ref } from "vue";
import ChatTurn from "./components/ChatTurn.vue";
import UserSelector from "./components/UserSelector.vue";
import { useChatStream } from "./composables/useChatStream";
import type { UserSummary } from "./types";

const users = ref<UserSummary[]>([]);
const selectedUserId = ref("");
const message = ref("");
const { turns, isBusy, statusText, send, stop } = useChatStream();

const suggestions = [
  "比较华东 2024 年 2 月和 1 月的销售额",
  "华东销售额下降主要是哪些产品造成的？",
  "比较全公司 2024 年第二季度和第一季度的订单数",
];

async function loadUsers(): Promise<void> {
  try {
    const response = await fetch("/api/users");
    if (!response.ok) throw new Error("用户列表加载失败");
    const body = await response.json() as { users: UserSummary[] };
    users.value = body.users;
    selectedUserId.value = body.users[0]?.id ?? "u001";
  } catch {
    users.value = [{ id: "u001", name: "王小姐", department: "销售部", role: "销售经理", dataScope: "region:华东" }];
    selectedUserId.value = "u001";
  }
}

async function submit(): Promise<void> {
  const text = message.value.trim();
  if (!text || !selectedUserId.value || isBusy.value) return;
  message.value = "";
  await send(text, selectedUserId.value);
}

onMounted(loadUsers);
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">D</div>
        <div><strong>DataAgent</strong><small>销售经营分析助手</small></div>
      </div>
      <UserSelector v-model="selectedUserId" :users="users" :disabled="isBusy" />
    </header>

    <main class="workspace">
      <section v-if="turns.length === 0" class="welcome">
        <h1>用数据，回答经营问题</h1>
        <p>输入销售分析问题，DataAgent 会调用受控数据工具，给出可解释、可追溯的分析结论。</p>
        <div class="suggestions">
          <button v-for="item in suggestions" :key="item" class="suggestion" @click="message = item">{{ item }}</button>
        </div>
      </section>

      <ChatTurn v-for="turn in turns" :key="turn.id" :turn="turn" />
    </main>

    <footer class="composer-shell">
      <form class="composer" @submit.prevent="submit">
        <textarea v-model="message" :disabled="isBusy" placeholder="输入你的销售分析问题…" rows="1" @keydown.enter.exact.prevent="submit"></textarea>
        <button v-if="!isBusy" type="submit" :disabled="!message.trim()">发送</button>
        <button v-else type="button" class="secondary" @click="stop">停止</button>
      </form>
      <div class="composer-hint">{{ isBusy ? statusText : "Enter 发送 · Shift + Enter 换行" }}</div>
    </footer>
  </div>
</template>
