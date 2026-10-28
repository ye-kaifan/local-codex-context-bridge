# Local Codex Context Bridge

让 ChatGPT 普通 **Chat 和 Dot 只读检索本机或多台电脑的 Codex 会话**。通过官方 `codex app-server` 读取，保留设备来源、turn/item 原生分页和 protected 内容策略。不能启动、继续执行、修改或删除 Codex 会话。

这是 [Local-Codex-Bridge](https://github.com/zoeynine/Local-Codex-Bridge) 的独立衍生项目，基于 v2.3.4 / `5f20b24940ed3024ed10d6ca45498f30f9750ea9`，沿用 MIT 并保留原版权。仅包含只读上下文功能，不包含 Gemini、Antigravity 私有扩展。详见 [许可说明](THIRD_PARTY_NOTICES.md)。

## 直接发给自己的 Codex

```text
请安装 https://github.com/ye-kaifan/local-codex-context-bridge，让 ChatGPT Chat
和 Dot 只读访问我的 Codex 会话。先读 INSTALL.md，按其中流程端到端完成。
自动识别系统、实际 Codex 可执行文件和会话目录，复用已有连接并保留现有配置。
先构建测试，再接入我自己的私有 Secure MCP Tunnel，并做好 Codex 本地插件隔离。
涉及本人登录、隐藏输入密钥或新增账号权限时暂停；不要自行创建持续访问凭据、
开放公网端口或修改无关设置。实测搜索、turn/item 连续分页和只读限制，最后报告
通过、未执行及需要我手动完成的项目。
```

## 本地安装

前提：Git、Node.js 24+、npm、官方独立 Codex CLI。Windows 如只有 `codex.cmd`，需找到实际原生 `codex.exe` 后传入 `--codex`。

```sh
git clone https://github.com/ye-kaifan/local-codex-context-bridge.git
cd local-codex-context-bridge
npm ci --ignore-scripts
npm run typecheck
npm test
npm run setup -- --id laptop --label "我的笔记本"
npm run smoke
```

安装脚本只在新的 `.local/` 目录生成当前设备配置和 stdio 启动命令，不覆盖已有目录、不改 Codex 设置、不创建凭据、不自动启用后台服务。已有 `.local/` 时使用 `--out 新目录`。实际目录不同可加 `--codex-home 绝对路径`。

之后按 [INSTALL.md](INSTALL.md) 配置自己的 Chat/Dot 私有连接。多台电脑各自运行读取端和 Tunnel，互不依赖转发；统一插件仅引用用户自己的连接 ID。该项目没有公共读取服务器，也不提供维护者的组织、账号或 Tunnel。

## 已保留的修复和边界

- 对外 schema 移除 8 处冗余 `\\S` 正则，避免 Dot 将其当成全字符串匹配；服务端仍检查非空、类型和长度。
- macOS 后台服务使用 `ProcessType=Standard`，避免 Background 调度限制导致原生搜索超时；读取请求仍为 20 秒上限，不承诺所有查询都能在限时内完成。
- 部署后仅在 Codex 本地配置停用相关插件、设备连接器及随附技能，保留 Chat 云端连接，避免插件抢占 Codex 原生会话读取。提供配置片段生成器与恢复说明。
- 工具路由和底层原生请求两层限制只读，禁止执行和原生批准响应。
- protected 整页拒绝含疑似凭据或超限内容，不静默截断，不自动切换 exact。exact 显式调用仍可能暴露敏感内容。
- `nextCursor:null` 才表示当前范围结束；空页不一定结束。完整历史应先遍历 turn，再遍历各 turn 的 item，并报告未读范围。

macOS Apple Silicon 已做真实原生读取验证。Windows 有共享代码和 CI 测试，但真实 Codex、后台服务和 Chat/Dot 接入仍需在目标机验收。Linux/WSL 暂不支持。当前通用包没有替换维护者的现有安装，也没有借用旧会话中的“测试通过”作为本次发布验收。

[安装、卸载与恢复](INSTALL.md) · [安全模型](docs/security.md) · [验证范围](docs/verification.md) · [英文说明](README.md)

`npm run check:native-schema` 会优先检查 `.local/device.json` 中实际配置的 Codex。使用其他配置目录时，加 `-- --config 配置目录/device.json`，避免误检 PATH 中另一份安装。

维护者的 GitHub → Gitee 单向同步范围与故障恢复见 [镜像说明](docs/mirroring.md)。
