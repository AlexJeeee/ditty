<script setup lang="ts">
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
</script>

<template>
  <section class="panel-block account-strip">
    <div>
      <p class="eyebrow">账户</p>
      <strong v-if="auth.authenticated">{{ auth.email }}</strong>
      <strong v-else>未登录</strong>
      <span v-if="auth.authenticated">剩余额度 {{ auth.quotaRemaining }}</span>
      <span v-else>使用演示登录继续</span>
    </div>
    <button v-if="auth.authenticated" class="icon-button" type="button" title="退出登录" @click="auth.signOut">
      退出
    </button>
    <button v-else class="primary-button" type="button" @click="auth.signInDemo">演示登录</button>
  </section>
</template>
