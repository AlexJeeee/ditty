import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { MOCK_USER_EMAIL } from "@/shared/constants";

export const useAuthStore = defineStore("auth", () => {
  const email = ref(MOCK_USER_EMAIL);
  const quotaRemaining = ref(100);

  const authenticated = computed(() => Boolean(email.value));

  function signInDemo() {
    email.value = MOCK_USER_EMAIL;
    quotaRemaining.value = 100;
  }

  function signOut() {
    email.value = "";
    quotaRemaining.value = 0;
  }

  return {
    authenticated,
    email,
    quotaRemaining,
    signInDemo,
    signOut
  };
});
