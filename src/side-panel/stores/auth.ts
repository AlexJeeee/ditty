import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  getCurrentUser,
  loginUser,
  logoutUser,
  registerUser,
  setApiAccessToken,
} from "@/shared/api-client";
import type { AuthCredentials, AuthUser } from "@/shared/types";

const AUTH_TOKEN_STORAGE_KEY = "ditty_auth_token";

const hasChromeStorage = () =>
  typeof chrome !== "undefined" && Boolean(chrome.storage?.local);

const readStoredToken = async () => {
  if (!hasChromeStorage()) {
    return "";
  }

  const result = await chrome.storage.local.get(AUTH_TOKEN_STORAGE_KEY);
  return typeof result[AUTH_TOKEN_STORAGE_KEY] === "string"
    ? result[AUTH_TOKEN_STORAGE_KEY]
    : "";
};

const writeStoredToken = async (token: string) => {
  if (!hasChromeStorage()) {
    return;
  }

  await chrome.storage.local.set({
    [AUTH_TOKEN_STORAGE_KEY]: token,
  });
};

const removeStoredToken = async () => {
  if (!hasChromeStorage()) {
    return;
  }

  await chrome.storage.local.remove(AUTH_TOKEN_STORAGE_KEY);
};

export const useAuthStore = defineStore("auth", () => {
  const accessToken = ref("");
  const user = ref<AuthUser | null>(null);
  const initialized = ref(false);
  const loading = ref(false);
  const submitting = ref(false);
  const error = ref<string | null>(null);

  const authenticated = computed(() =>
    Boolean(accessToken.value && user.value),
  );
  const email = computed(() => user.value?.email ?? "");
  const quotaRemaining = computed(() => user.value?.quotaRemaining ?? 0);

  const applySession = async (token: string, nextUser: AuthUser) => {
    accessToken.value = token;
    user.value = nextUser;
    setApiAccessToken(token);
    await writeStoredToken(token);
  };

  const clearSession = async () => {
    accessToken.value = "";
    user.value = null;
    setApiAccessToken("");
    await removeStoredToken();
  };

  const initialize = async () => {
    if (initialized.value) {
      return;
    }

    loading.value = true;
    error.value = null;

    try {
      const token = await readStoredToken();

      if (token) {
        accessToken.value = token;
        setApiAccessToken(token);
        user.value = await getCurrentUser();
      }
    } catch {
      await clearSession();
    } finally {
      initialized.value = true;
      loading.value = false;
    }
  };

  const submitAuth = async (
    credentials: AuthCredentials,
    submitter: (value: AuthCredentials) => Promise<{
      accessToken: string;
      user: AuthUser;
    }>,
  ) => {
    submitting.value = true;
    error.value = null;

    try {
      const session = await submitter(credentials);
      await applySession(session.accessToken, session.user);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "认证失败。";
      throw caught;
    } finally {
      submitting.value = false;
    }
  };

  const register = (credentials: AuthCredentials) =>
    submitAuth(credentials, registerUser);

  const login = (credentials: AuthCredentials) =>
    submitAuth(credentials, loginUser);

  const refreshCurrentUser = async () => {
    if (!accessToken.value) {
      return;
    }

    try {
      user.value = await getCurrentUser();
    } catch (caught) {
      await clearSession();
      error.value = caught instanceof Error ? caught.message : "请重新登录。";
    }
  };

  const signOut = async () => {
    submitting.value = true;
    error.value = null;

    try {
      if (accessToken.value) {
        await logoutUser();
      }
    } catch {
      // Local session cleanup should still happen if the server is unavailable.
    } finally {
      await clearSession();
      submitting.value = false;
    }
  };

  return {
    accessToken,
    authenticated,
    initialized,
    loading,
    submitting,
    error,
    user,
    email,
    quotaRemaining,
    initialize,
    register,
    login,
    refreshCurrentUser,
    signOut,
  };
});
