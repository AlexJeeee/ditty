<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ModelProvider, ModelRoute } from "@/shared/types";

const props = defineProps<{
  modelProviders: ModelProvider[];
  selectedModelRoute: ModelRoute | null;
  modelLoading: boolean;
  modelError: string | null;
  loading: boolean;
}>();

const emit = defineEmits<{
  "select-model-route": [route: ModelRoute];
}>();

const modelPopoverOpen = ref(false);

const PROVIDER_ICON_PATHS: Record<string, string> = {
  deepseek: "/icons/models/deepSeek.png",
  minmax: "/icons/models/miniMax.png",
};

const getProviderIconPath = (providerId: string) => {
  return PROVIDER_ICON_PATHS[providerId.toLowerCase()] ?? null;
};

const modelOptions = computed(() =>
  props.modelProviders.flatMap((provider) =>
    provider.models.map((model) => ({
      providerId: provider.id,
      providerName: provider.name,
      modelId: model.id,
      modelName: model.name,
      iconPath: getProviderIconPath(provider.id),
      iconLabel: (provider.name || provider.id)
        .trim()
        .slice(0, 1)
        .toUpperCase(),
    })),
  ),
);

const selectedModel = computed(() =>
  modelOptions.value.find(
    (option) =>
      option.providerId === props.selectedModelRoute?.providerId &&
      option.modelId === props.selectedModelRoute?.modelId,
  ),
);

const selectedModelLabel = computed(() => {
  return selectedModel.value
    ? `${selectedModel.value.providerName} / ${selectedModel.value.modelName}`
    : "选择模型";
});

const selectedModelIconPath = computed(() => {
  return selectedModel.value?.iconPath ?? null;
});

const selectedModelName = computed(() => {
  return selectedModel.value?.modelName ?? "选择模型";
});

const modelPickerDisabled = computed(
  () =>
    props.loading ||
    props.modelLoading ||
    (!modelOptions.value.length && !props.modelError),
);

const toggleModelPopover = () => {
  if (modelPickerDisabled.value) {
    return;
  }

  modelPopoverOpen.value = !modelPopoverOpen.value;
};

const isSelectedModel = (providerId: string, modelId: string) => {
  return (
    props.selectedModelRoute?.providerId === providerId &&
    props.selectedModelRoute?.modelId === modelId
  );
};

const selectModelRoute = (route: ModelRoute) => {
  emit("select-model-route", route);
  modelPopoverOpen.value = false;
};

watch(
  () => props.loading,
  (loading) => {
    if (loading) {
      modelPopoverOpen.value = false;
    }
  },
);
</script>

<template>
  <div class="model-picker">
    <button
      class="composer-tool-button model-picker-button"
      type="button"
      :title="selectedModelLabel"
      :aria-label="selectedModelLabel"
      :aria-expanded="modelPopoverOpen"
      :disabled="modelPickerDisabled"
      @click="toggleModelPopover"
    >
      <img
        v-if="selectedModelIconPath"
        class="model-picker-icon-image"
        :src="selectedModelIconPath"
        alt=""
        aria-hidden="true"
      />
      <span v-else class="model-picker-icon-fallback" aria-hidden="true" />
      <span class="model-picker-button-label">
        {{ selectedModelName }}
      </span>
    </button>
    <div
      v-if="modelPopoverOpen"
      class="model-picker-popover"
      role="dialog"
      aria-label="选择模型"
    >
      <div class="model-picker-header">
        <strong>模型</strong>
        <button
          class="model-picker-close"
          type="button"
          title="关闭"
          aria-label="关闭"
          @click="modelPopoverOpen = false"
        >
          ×
        </button>
      </div>
      <div class="model-picker-list" role="listbox" aria-label="可选模型">
        <button
          v-for="option in modelOptions"
          :key="`${option.providerId}:${option.modelId}`"
          class="model-picker-item"
          :class="{
            selected: isSelectedModel(option.providerId, option.modelId),
          }"
          type="button"
          role="option"
          :aria-selected="isSelectedModel(option.providerId, option.modelId)"
          @click="
            selectModelRoute({
              providerId: option.providerId,
              modelId: option.modelId,
            })
          "
        >
          <span class="model-provider-icon-frame" aria-hidden="true">
            <img
              v-if="option.iconPath"
              class="model-provider-icon-image"
              :src="option.iconPath"
              alt=""
            />
            <span v-else class="model-provider-icon-fallback">
              {{ option.iconLabel }}
            </span>
          </span>
          <span class="model-picker-copy">
            <span class="model-provider-name">
              {{ option.providerName }}
            </span>
            <span class="model-name">{{ option.modelName }}</span>
          </span>
        </button>
      </div>
      <p v-if="modelError" class="model-picker-error">
        {{ modelError }}
      </p>
    </div>
  </div>
</template>
