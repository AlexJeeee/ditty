# 开发模式与热更新

本项目使用 Vite + `@crxjs/vite-plugin` 开发 Chrome Manifest V3 插件。开发时不需要每次手动 `build`，保持 Vite dev server 运行即可让多数改动即时生效。

## 启动方式

```bash
pnpm install
cp .env.example .env
pnpm dev:all
```

`pnpm dev:all` 会同时启动两个进程：

- `pnpm dev`：CRXJS/Vite 扩展开发服务器，固定 `localhost:5173`。
- `pnpm server:dev`：本地模型代理，默认 `http://127.0.0.1:8787`。

如果只改插件 UI 或 Content Script，也可以只运行 `pnpm dev`；需要真实聊天和流式响应时必须同时运行本地代理。

然后打开 Chrome：

1. 访问 `chrome://extensions`。
2. 开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择项目里的 `dist` 目录。

之后保持开发命令运行，继续改 `src/` 或 `server/` 里的代码即可。

## 生效规则

- Side Panel 的 Vue 页面改动会走 Vite HMR，通常会即时更新并保留页面状态。
- Content Script 改动由 CRXJS 转发 HMR；如果当前网页没有自动拿到新脚本，刷新网页即可。
- Background Service Worker、`manifest.config.ts` 或权限相关改动会触发整个扩展 reload，必要时重新打开侧边栏或刷新目标网页。
- `server/` 改动由 `tsx watch` 自动重启本地代理，Side Panel 下一次请求会使用新服务逻辑。
- 生产发布前仍然使用 `pnpm build`，产物同样输出到 `dist`。

## 当前模块约定

- `ChatPanel.vue` 是聊天区外壳；输入框和底部工具栏布局放在 `ChatComposer.vue`；模型选择入口和弹层放在 `ModelPicker.vue`；单条消息渲染放在 `ChatMessageItem.vue`。
- `agent-run.ts` 做运行编排、模型列表加载和模型选择持久化；消息生成、事件应用和 action message 状态更新放在 `agent-run-messages.ts`。
- 插件内部消息协议集中在 `src/shared/extension-messages.ts`，当前只保留页面上下文、动作执行、选中文本操作和活动标签页变化。
- 本地代理入口是 `server/index.ts`；路由、配置、run 存储、prompt/plan、SSE 分别拆在 `server/agent-routes.ts`、`server/config.ts`、`server/run-store.ts`、`server/agent-prompt.ts`、`server/sse.ts`。
- ID 统一通过 `src/shared/id.ts` 的 `createScopedId` 生成，避免各模块重复拼接 `Date.now()` 和随机串。

## 验证命令

常规改动完成后运行：

```bash
pnpm typecheck
pnpm server:typecheck
pnpm test
```

涉及重构、删除文件或清理协议时，额外运行：

```bash
pnpm exec vue-tsc --noEmit --noUnusedLocals --noUnusedParameters
pnpm exec tsc --noEmit -p server/tsconfig.json --noUnusedLocals --noUnusedParameters
pnpm build
git diff --check
```

删除旧模块后可以用 `rg` 确认没有残留引用，例如：

```bash
rg "TaskComposer|AgentRunPanel|ActionConfirmCard|agent_run:update|auth:state_changed|element:highlight" src server
```

## 常见问题

- 如果 Chrome 显示无法连接 dev server，确认 `pnpm dev` 还在运行，然后在 `chrome://extensions` 点插件卡片上的刷新按钮。
- 如果提示 `5173` 端口被占用，先停止占用该端口的进程再重新运行 `pnpm dev`。本项目固定使用 `5173`，这样扩展里的 HMR 连接不会因为端口漂移而失效。
- 如果刚修改了 content script 但页面行为没变，刷新当前网页；页面上下文里的脚本生命周期和普通网页不同，这是扩展开发里的正常现象。
