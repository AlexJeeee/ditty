import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Chrome AI Agent",
  description: "A controllable AI agent side panel for understanding and acting on webpages.",
  version: "0.1.0",
  permissions: ["activeTab", "storage", "scripting", "sidePanel","tabs"],
  host_permissions: [],
  action: {
    default_title: "Chrome AI Agent"
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module"
  },
  side_panel: {
    default_path: "src/side-panel/index.html"
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"],
      run_at: "document_idle"
    }
  ]
});
