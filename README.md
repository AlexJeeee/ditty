# Chrome AI Agent

一个基于 Chrome Manifest V3 的网页 AI Agent 插件。插件通过 Side Panel 读取当前网页上下文，支持聊天式任务输入、选中文本快捷菜单、Agent 计划展示、动作确认和受控页面操作。

当前 AI 聊天能力通过本地 Node 代理接入 OpenAI 兼容的 Chat Completions API。模型 Key 只放在本地 `.env` 中，Chrome 扩展只调用本地代理服务。

## 功能概览

- 聊天式侧边栏：用户输入任务后，Agent 在聊天流中返回思考、计划、回答和执行结果。
- 流式输出：本地代理把模型流式响应转换为插件现有的增量事件。
- 可折叠思考与计划：Agent 思考和执行计划默认以折叠块展示，减少聊天区占用。
- 选中文本快捷菜单：网页中选中文本后，旁边弹出 `翻译`、`解释`、`添加到对话`。
- 自动打开侧边栏：点击选中文本菜单后自动打开 Agent Side Panel，并同步本次选区。
- 页面上下文采集：读取当前页面标题、URL、选中文本、可见文本摘要、标题、表格和可交互元素。
- 受控动作执行：页面动作必须映射到白名单工具协议，高风险动作默认阻断。
- 动作确认：需要用户确认的动作直接在聊天框内展示 `执行` / `跳过`。
- 打开新网页：Agent 可通过 `open_url` 工具请求打开指定 http/https 网址，确认后由 Background 在新标签页执行。

## 技术栈

- Chrome Extension Manifest V3
- Vue 3
- TypeScript
- Vite
- Fastify
- OpenAI 兼容 Chat Completions API
- `@crxjs/vite-plugin`
- Pinia
- pnpm

## 目录结构

```text
.
├── docs/
│   ├── development.md          # 开发模式与热更新说明
│   ├── product-requirements.md # MVP 产品需求
│   └── technical-design.md     # 技术方案
├── src/
│   ├── background/             # Service Worker，负责插件生命周期与消息转发
│   ├── content/                # Content Script，负责页面采集、选区菜单和动作执行
│   ├── shared/                 # 共享类型、消息协议、ID 工具和 API client
│   └── side-panel/             # Vue Side Panel UI、组件和 Pinia stores
├── server/                     # 本地模型代理、Agent 路由、SSE 和上下文裁剪
├── manifest.config.ts          # MV3 manifest 配置
├── vite.config.ts              # Vite + CRXJS 配置
└── package.json
```

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动开发模式

复制环境变量示例并填入真实模型 Key：

```bash
cp .env.example .env
```

`.env` 至少需要：

```text
OPENAI_API_KEY=sk-...
OPENAI_MODEL=MiniMax-M2.7
OPENAI_TIMEOUT_MS=120000
OPENAI_MAX_RETRIES=1
OPENAI_BASE_URL=https://api.minimaxi.com/v1
AI_AGENT_PORT=8787
AI_AGENT_DB_PATH=server/.data/chat-history.sqlite
VITE_AGENT_API_BASE_URL=http://127.0.0.1:8787
```

`OPENAI_BASE_URL` 可以指向 OpenAI 官方或其他 OpenAI 兼容供应商；`OPENAI_MODEL` 需要与该供应商实际可用模型一致。

同时启动扩展开发服务器和本地 AI 代理：

```bash
pnpm dev:all
```

也可以分别启动：

```bash
pnpm dev
pnpm server:dev
```

扩展开发服务器固定使用 `localhost:5173`，本地 AI 代理默认使用 `http://127.0.0.1:8787`。保持命令运行，CRXJS 会维护开发态 `dist` 产物并提供 HMR / reload 能力。
聊天历史默认保存在 `server/.data/chat-history.sqlite`，可通过 `AI_AGENT_DB_PATH` 指向其他本地 SQLite 文件。

### 3. 加载 Chrome 插件

1. 打开 `chrome://extensions`。
2. 开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择项目根目录下的 `dist` 目录。

加载后，打开普通网页，点击浏览器工具栏里的插件图标即可打开 Side Panel。也可以在网页中选中文本，通过浮动菜单触发 `翻译`、`解释` 或 `添加到对话`。

## 常用命令

```bash
pnpm dev        # 启动 CRXJS/Vite 开发模式
pnpm server:dev # 启动本地 OpenAI 代理
pnpm dev:all    # 同时启动扩展和本地代理
pnpm build      # 类型检查并构建生产产物
pnpm typecheck  # 仅运行 TypeScript / Vue 类型检查
pnpm server:typecheck # 仅运行本地代理类型检查
pnpm test       # 运行测试
```

重构或清理代码后建议额外运行：

```bash
pnpm exec vue-tsc --noEmit --noUnusedLocals --noUnusedParameters
pnpm exec tsc --noEmit -p server/tsconfig.json --noUnusedLocals --noUnusedParameters
git diff --check
```

## 代码结构说明

- `src/side-panel/components/ChatPanel.vue` 只负责聊天区外壳和自动滚动。
- `src/side-panel/components/ChatComposer.vue` 负责输入框自适应、发送和停止。
- `src/side-panel/components/ChatMessageItem.vue` 负责单条消息、计划、思考块和动作确认渲染。
- `src/side-panel/stores/agent-run.ts` 负责 Agent run 编排、API 调用、停止和动作执行。
- `src/side-panel/stores/agent-run-messages.ts` 保存聊天消息类型、消息生成和事件应用等纯逻辑。
- `server/index.ts` 只负责 Fastify 初始化、CORS 和启动监听。
- `server/agent-routes.ts` 注册 `/health`、`/health/openai`、`/api/agent/runs`、`/api/agent/runs/:runId/stream` 和 `/api/agent/runs/:runId/stop`。
- `server/config.ts`、`server/run-store.ts`、`server/agent-prompt.ts`、`server/sse.ts` 分别负责环境配置、run 状态、prompt/plan 和 SSE 写入。

## 开发说明

- Side Panel 的 Vue 改动通常会通过 Vite HMR 即时生效。
- Content Script 改动如果没有立刻在当前网页生效，刷新目标网页即可。
- Background Service Worker、`manifest.config.ts` 或权限相关改动可能触发扩展 reload，需要在 `chrome://extensions` 重新刷新插件。
- 开发期加载的目录仍是 `dist`，但不需要每次手动 `pnpm build`，保持 `pnpm dev` 即可。

更多细节见 [docs/development.md](docs/development.md)。

## 当前实现边界

- AI 聊天能力已通过本地代理接入 OpenAI 兼容接口；未启动代理或未配置 `OPENAI_API_KEY` 时，聊天区会显示可读错误。
- 登录为本地演示态，尚未接入真实认证服务。
- Chrome 扩展不会保存或调用第三方模型 API Key，Key 只存在本地 Node 代理进程中。
- 高风险页面动作会被本地策略阻断。
- 浏览器级导航只支持 `http` / `https` 网址，不会打开 `chrome://`、`file://`、`javascript:` 等特殊地址。
- AI 可以通过 `open_url` 工具请求打开网页，但只会生成待确认动作，真正打开标签页前仍需用户点击确认。

## 相关文档

- [产品需求](docs/product-requirements.md)
- [技术方案](docs/technical-design.md)
- [项目主流程导览](docs/main-flow.md)
- [开发模式与热更新](docs/development.md)
