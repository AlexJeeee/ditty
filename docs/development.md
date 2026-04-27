# 开发模式与热更新

本项目使用 Vite + `@crxjs/vite-plugin` 开发 Chrome Manifest V3 插件。开发时不需要每次手动 `build`，保持 Vite dev server 运行即可让多数改动即时生效。

## 启动方式

```bash
pnpm install
pnpm dev
```

然后打开 Chrome：

1. 访问 `chrome://extensions`。
2. 开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择项目里的 `dist` 目录。

之后保持 `pnpm dev` 运行，继续改 `src/` 里的代码即可。

## 生效规则

- Side Panel 的 Vue 页面改动会走 Vite HMR，通常会即时更新并保留页面状态。
- Content Script 改动由 CRXJS 转发 HMR；如果当前网页没有自动拿到新脚本，刷新网页即可。
- Background Service Worker、`manifest.config.ts` 或权限相关改动会触发整个扩展 reload，必要时重新打开侧边栏或刷新目标网页。
- 生产发布前仍然使用 `pnpm build`，产物同样输出到 `dist`。

## 常见问题

- 如果 Chrome 显示无法连接 dev server，确认 `pnpm dev` 还在运行，然后在 `chrome://extensions` 点插件卡片上的刷新按钮。
- 如果提示 `5173` 端口被占用，先停止占用该端口的进程再重新运行 `pnpm dev`。本项目固定使用 `5173`，这样扩展里的 HMR 连接不会因为端口漂移而失效。
- 如果刚修改了 content script 但页面行为没变，刷新当前网页；页面上下文里的脚本生命周期和普通网页不同，这是扩展开发里的正常小怪兽。
