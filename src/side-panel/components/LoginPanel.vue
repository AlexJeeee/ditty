<script setup lang="ts">
import { computed, ref } from "vue";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const mode = ref<"login" | "register">("login");
const email = ref("");
const password = ref("");
const localError = ref<string | null>(null);

const title = computed(() => (mode.value === "login" ? "登录" : "注册"));
const switchLabel = computed(() =>
  mode.value === "login" ? "创建账号" : "已有账号，去登录",
);

const validate = () => {
  const normalizedEmail = email.value.trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return "请输入有效邮箱。";
  }

  if (password.value.length < 8) {
    return "密码至少需要 8 位。";
  }

  return "";
};

const submit = async () => {
  const validationError = validate();

  if (validationError) {
    localError.value = validationError;
    return;
  }

  localError.value = null;

  try {
    await auth[mode.value]({
      email: email.value,
      password: password.value,
    });
    password.value = "";
  } catch {
    // Store error is rendered below.
  }
};

const toggleMode = () => {
  mode.value = mode.value === "login" ? "register" : "login";
  localError.value = null;
};
</script>

<template>
  <section class="panel-block account-strip">
    <div v-if="auth.authenticated" class="account-summary">
      <p class="eyebrow">账户</p>
      <strong>{{ auth.email }}</strong>
      <span>剩余额度 {{ auth.quotaRemaining }}</span>
    </div>
    <form v-else class="auth-form" @submit.prevent="submit">
      <div class="auth-form-header">
        <div>
          <p class="eyebrow">账户</p>
          <strong>{{ title }}</strong>
        </div>
        <button class="link-button" type="button" @click="toggleMode">
          {{ switchLabel }}
        </button>
      </div>
      <label class="field-label">
        <span>邮箱</span>
        <input
          v-model="email"
          type="email"
          autocomplete="email"
          placeholder="user@example.com"
          :disabled="auth.submitting"
        />
      </label>
      <label class="field-label">
        <span>密码</span>
        <input
          v-model="password"
          type="password"
          :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
          placeholder="至少 8 位"
          :disabled="auth.submitting"
        />
      </label>
      <p v-if="localError || auth.error" class="error-text">
        {{ localError || auth.error }}
      </p>
      <button
        class="primary-button auth-submit"
        type="submit"
        :disabled="auth.submitting"
      >
        {{ auth.submitting ? "处理中" : title }}
      </button>
    </form>
    <button
      v-if="auth.authenticated"
      class="icon-button"
      type="button"
      title="退出登录"
      :disabled="auth.submitting"
      @click="auth.signOut"
    >
      退出
    </button>
  </section>
</template>
