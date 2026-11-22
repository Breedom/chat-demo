# Chat Demo

[在线使用（GitHub Pages）](https://breedom.github.io/chat-demo/)

静态聊天客户端，保留原生 DeepSeek 功能，并支持 OpenAI 和自定义的 OpenAI Chat Completions 兼容服务。包含多轮对话、流式回答、停止生成、消息分支、Markdown、公式和会话 ZIP 导入导出。

## 配置模型

在聊天框下方的下拉菜单直接切换已保存的模型。新增或修改配置，使用旁边的设置按钮，或打开 **设置 → 模型服务**：

| 厂商       | 配置                                                                                                                      | 支持范围                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| DeepSeek   | 输入 DeepSeek API Key；默认模型 `deepseek-flash`                                                                          | 原版深度思考、搜索、链接阅读、附件、语音、朗读和续写     |
| OpenAI     | 默认基础地址 `https://api.openai.com/v1`，模型默认 `gpt-4.1-mini`，可改成账号有权限且支持流式 Chat Completions 的模型     | 多轮聊天，附件和思考力度按模型开启                       |
| 自定义厂商 | 点击 **添加自定义厂商**，填写名称、API 基础地址（例如 `https://example.com/v1`）；服务无需 Bearer 鉴权时可将 API Key 留空 | 要求支持 `POST /chat/completions`、`stream: true` 和 SSE |

- 填好基础地址和凭据后，点击 **自动获取模型** 查询 `GET /models`。接口不可用时可以手动填写。模型列表不检测附件和推理能力。DeepSeek 原生接口以 `deepseek-flash` 为默认模型，选择其他模型时需确认它支持原生聊天接口和扩展。
- 每个兼容模型独立配置附件类型、支持的思考力度和默认值。聊天框可以临时覆盖思考力度；选择 **服务默认** 时不发送 `reasoning_effort`。如果服务返回 `reasoning_content`，客户端会显示为思考过程。
- 兼容附件在点击发送时提交：PNG/JPEG/WebP/GIF 使用 `image_url`；MP4/MOV/WebM 使用厂商扩展 `video_url`，仅适用于支持该扩展的服务；PDF 和常见 Office 文件使用内联 `file`，能否读取取决于目标服务。UTF-8 文本、代码和 CSV 可直接作为文本阅读。每次请求最多 8 个附件、原始文件共 20 MB，单个文本文件最多 256 KiB。
- 继续对话会把该分支的文本上下文发送给当前模型服务。兼容附件只随历史发送给同一个厂商及 API 地址；保存为 ZIP 后再导入的兼容附件只在本地展示。正在生成的请求不会因为切换模型而改变。
- 原生 DeepSeek 保留深度思考和智能搜索。所有模型的聊天框都可以使用 **DeepSeek 语音输入**：录音发往 DeepSeek 转写，文字插入输入框，由用户决定是否发送给当前模型。语音输入需要 DeepSeek API Key 和安全上下文。

## 密钥与跨域

- GitHub Pages 只托管静态文件。API 或代理需要允许站点的 CORS 请求（包括 `GET`、`POST`、`Content-Type` 和使用 Bearer 时的 `Authorization`）。线上 API 使用 HTTPS；本地回环开发地址允许 HTTP。客户端不会跟随兼容接口的重定向。
- 公共部署请使用受信任、带访问控制和限流的后端代理，将 OpenAI 等长期服务端密钥保存在代理上。不要把密钥放入仓库、构建产物、网页或 URL。OpenAI 预设也可以填写代理基础地址。仓库与 Pages 不提供代理，也不附带共享密钥。
- 原生 DeepSeek 沿用浏览器 `localStorage` 中的原有密钥。兼容厂商的基础地址和模型保存在本地，但 API Key 仅保存在当前页面的内存中，刷新后需要重新输入。切换兼容厂商不会共用凭据。更改基础地址时会清空编辑中的密钥。
- 聊天记录与本地附件存于浏览器 IndexedDB。导出 ZIP 不含密钥和厂商设置；导入会替换当前站点的本地会话和附件。详见[归档格式](src/services/chat/history/README.md)。

## 开发与部署

使用 Node.js 24 和 pnpm：

```sh
git clone https://github.com/Breedom/chat-demo.git
cd chat-demo
pnpm install --frozen-lockfile
pnpm dev
```

本地开发地址为 `http://localhost:8090`。用 `pnpm type`、`pnpm lint`、`pnpm test` 检查项目，`pnpm build` 之后可将 `dist/` 部署到静态服务器。GitHub Pages 选择 **GitHub Actions** 作为构建来源后，推送到 `main` 会校验、构建并发布。

原生 DeepSeek 的 API 地址可在自定义 Rspack 配置中通过 `createConfig({ apiOrigin, devServer })` 更改；OpenAI 兼容配置可在界面直接编辑，无需重新构建。

## 鸣谢与许可

本项目基于 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 二次开发，感谢 DeepSeek 团队和原项目贡献者。项目采用 [MIT 许可证](LICENSE)，保留原版权声明。
