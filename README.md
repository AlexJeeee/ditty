# Chrome AI Agent

一个基于 Chrome Manifest V3 的网页 AI Agent 插件。插件通过 Side Panel 读取当前网页上下文，支持聊天式任务输入、选中文本快捷菜单、Agent 计划展示、动作确认和受控页面操作。

当前 AI 能力为本地 mock，已预留流式事件、计划协议和动作执行协议，后续可以替换为真实后端 Agent 或模型网关。

## 功能概览

- 聊天式侧边栏：用户输入任务后，Agent 在聊天流中返回思考、计划、回答和执行结果。
- 流式输出：mock Agent 使用增量事件模拟模型流式回复。
- 可折叠思考与计划：Agent 思考和执行计划默认以折叠块展示，减少聊天区占用。
- 选中文本快捷菜单：网页中选中文本后，旁边弹出 `翻译`、`解释`、`添加到对话`。
- 自动打开侧边栏：点击选中文本菜单后自动打开 Agent Side Panel，并同步本次选区。
- 页面上下文采集：读取当前页面标题、URL、选中文本、可见文本摘要、标题、表格和可交互元素。
- 受控动作执行：页面动作必须映射到白名单工具协议，高风险动作默认阻断。
- 动作确认：需要用户确认的动作直接在聊天框内展示 `执行` / `跳过`。

## 技术栈

- Chrome Extension Manifest V3
- Vue 3
- TypeScript
- Vite
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
│   ├── shared/                 # 共享类型、消息协议和 mock API
│   └── side-panel/             # Vue Side Panel UI
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

```bash
pnpm dev
```

开发服务器固定使用 `localhost:5173`。保持该命令运行，CRXJS 会维护开发态 `dist` 产物并提供 HMR / reload 能力。

### 3. 加载 Chrome 插件

1. 打开 `chrome://extensions`。
2. 开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择项目根目录下的 `dist` 目录。

加载后，打开普通网页，点击浏览器工具栏里的插件图标即可打开 Side Panel。也可以在网页中选中文本，通过浮动菜单触发 `翻译`、`解释` 或 `添加到对话`。

## 常用命令

```bash
pnpm dev        # 启动 CRXJS/Vite 开发模式
pnpm build      # 类型检查并构建生产产物
pnpm typecheck  # 仅运行 TypeScript / Vue 类型检查
pnpm test       # 运行测试
```

## 开发说明

- Side Panel 的 Vue 改动通常会通过 Vite HMR 即时生效。
- Content Script 改动如果没有立刻在当前网页生效，刷新目标网页即可。
- Background Service Worker、`manifest.config.ts` 或权限相关改动可能触发扩展 reload，需要在 `chrome://extensions` 重新刷新插件。
- 开发期加载的目录仍是 `dist`，但不需要每次手动 `pnpm build`，保持 `pnpm dev` 即可。

更多细节见 [docs/development.md](docs/development.md)。

## 当前实现边界

- AI 模型能力暂时由 `src/shared/api-client.ts` mock。
- 登录为本地演示态，尚未接入真实认证服务。
- 当前不会保存或调用第三方模型 API Key。
- 高风险页面动作会被本地策略阻断。
- 后续真实后端可沿用现有 `AgentRunEvent`、`AgentPlan`、`AgentAction` 和扩展消息协议。

## 相关文档

- [产品需求](docs/product-requirements.md)
- [技术方案](docs/technical-design.md)
- [开发模式与热更新](docs/development.md)
