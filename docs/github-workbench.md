# GitHub 工作台 / GitHub workbench

GitHub 工作台从 `0.2.0-preview.1` 起提供；旧版 `dsh-task-pulse@0.1.0` 不包含此功能。可下载 [GitHub Release](https://github.com/Yeti11H/dsh-task-pulse/releases/tag/v0.2.0-preview.1) 的完整 ZIP，不必自行构建 Java。已有任务状态页可以单独使用，不需要 Java 或 GitHub 登录。

## 能做什么

在 DSH 的 Pulse 侧栏选择 GitHub 仓库与分支，浏览可折叠文件树，查看带行号的原始代码。点击 GitHub Checks 批注可定位到同一提交的具体代码行。手动编辑或让 Agent 提出修改后，按文件展开 Diff，点击增删行查看对应版本。审阅后点击“创建分支与草稿 PR”，由工作台创建新的 `pulse/...` 分支与 draft PR。

本版不执行项目代码或测试。现有分支的检查结果不代表修改建议通过测试；没有批注也不代表代码正确。当前支持 GitHub.com、已有 UTF-8 文本文件的完整替换；不支持新增/删除文件、二进制、符号链接、子模块、自动 fork 或自动合并。

## 1. 准备环境

- Node.js >=24.9.0、npm。
- Java 17 或更高版本。只有从源码构建时才需要 Maven 3.8+。
- [GitHub CLI](https://cli.github.com/)。在运行 Java 服务的机器上执行官方登录：

```powershell
gh auth login --web --hostname github.com
gh auth status --hostname github.com
```

按 CLI 提示在浏览器完成授权。无需注册 GitHub App，也不用向 Pulse 输入 GitHub 密码或 Token。已经登录的用户可直接复用当前账号。需要退出 GitHub CLI 时，在自己的终端执行 `gh auth logout --hostname github.com`。

工作台使用 CLI 当前账户已经拥有的权限；UI 中选仓库不会缩小 GitHub 授权本身的范围。CLI 如何保存凭据由官方 CLI 与操作系统决定，不能保证其凭据存储一定加密。

## 2. 安装预览版插件

下载 Release 中的 `dsh-task-pulse-0.2.0-preview.1.zip`，解压后在该目录执行：

```powershell
npx @deepseek-ai/dsh@0.2.2-rc.1 plugin --profile web add ./dsh-task-pulse-0.2.0-preview.1.tgz
```

ZIP 内包含同版插件、Java JAR、使用说明和截图。npm 包只包含插件，不包含 Java 服务；npm 预览发布完成后也可用明确版本 `dsh-task-pulse@0.2.0-preview.1` 安装。发布状态以 [npm registry](https://www.npmjs.com/package/dsh-task-pulse?activeTab=versions) 为准，GitHub 安装包可独立使用。

### 可选：从源码构建

在仓库根目录执行：

```powershell
npm ci
npm run check
npm test
npm run build
npm pack
mvn -B -ntp -f github-server/pom.xml verify

npx @deepseek-ai/dsh@0.2.2-rc.1 plugin --profile web add ./dsh-task-pulse-0.2.0-preview.1.tgz
```

从源码构建的可执行 JAR 位于 `github-server/target/pulse-github-0.2.0-preview.1.jar`。下文按下载 ZIP 的解压目录执行；自行构建时，把启动命令中的 JAR 路径替换成该路径。

## 3. 启动本地服务

终端 A，在 ZIP 解压目录执行：

```powershell
java -jar ./pulse-github-0.2.0-preview.1.jar --pulse.allowed-origin=http://127.0.0.1:3000
```

将 `--pulse.allowed-origin` 换成你实际打开 DSH 网页的 Origin，即地址的协议、主机和端口，不含路径。例如 `http://localhost:3000` 与 `http://127.0.0.1:3000` 是两个不同 Origin。多个值用英文逗号分隔，不支持 `*`。

服务只监听 `127.0.0.1:43127`。启动时会打印一个随机**本地配对码**，它不是 GitHub Token。保留该终端，不要公开日志或分享配对码。若 `gh` 不在 PATH，可增加参数：

```powershell
java -jar ./pulse-github-0.2.0-preview.1.jar --pulse.allowed-origin=http://127.0.0.1:3000 "--pulse.gh=C:/Program Files/GitHub CLI/gh.exe"
```

只浏览或手动编辑时，正常启动 DSH 即可。需要让 Agent 调用工作台时，在终端 B 设置服务刚打印的同一个配对码，再启动 DSH：

```powershell
$env:PULSE_BRIDGE_TOKEN = '<粘贴本地配对码>'
$env:PULSE_BRIDGE_URL = 'http://127.0.0.1:43127'
npx @deepseek-ai/dsh@0.2.2-rc.1 web
```

环境变量只需在启动 DSH 的终端设置。也可在启动服务前设置同名 `PULSE_BRIDGE_TOKEN`，服务会使用它；有效格式为 32–160 个字母、数字、`_`、`-`。不要将真实配对码写进仓库。

目前面向与服务同机运行的本地 DSH 网页。远程 DSH、HTTPS 页面到 HTTP 本地服务可能受浏览器混合内容或本地网络限制，未支持这类部署。

## 4. 在 DSH 中操作

1. 打开会话，展开右侧栏，添加 **Pulse · 任务状态** 标签，切到 **代码仓库**。
2. 保持桥接地址为 `http://127.0.0.1:43127`，输入本地配对码并连接。
3. 选择仓库，填写基准分支，点击“打开代码快照”。页面会显示固定提交 SHA。
4. 展开文件夹或搜索路径。点击检查批注可定位到原始代码；批注只适用于该固定提交。
5. 可展开“编辑修改建议”直接修改并保存草稿。也可展开 Agent 请求区，描述需求后发送到 DSH。Agent 通过 `pulse_github` 的 `context/read/propose` 获取选中快照并提交建议；需等待它完成，再点击“刷新修改与检查”。
6. 展开每个文件的 Diff。删除行跳原始版本，新增行跳建议版本；GitHub 外链始终指向原始提交。
7. 确认修改内容和 PR 标题后点击“创建分支与草稿 PR”。它不会修改基准分支，也不会合并 PR。如果基准分支已变化，工作台会拒绝发布；重新打开快照并重新审阅修改。

Agent 工具不能创建 PR。Agent 没有该工具时，检查是否重启了带 `PULSE_BRIDGE_TOKEN` 的 DSH，是否安装了工作台预览版。工作台不会自动向模型注入上下文；只有用户点击发送后才会提交请求。

`propose` 只返回路径、原始 SHA 与草稿状态摘要，不回显全部修改前后源码，减少重复上下文。完整 Diff 由浏览器审阅接口读取。

## 5. 数据、上限与失败处理

- 配对码保留在组件内存，不进入 URL、localStorage 或模型工具结果。
- 源码、修改建议保留在本地服务与浏览器内存。主动断开、关闭组件或切换 DSH 会话会释放当前草稿；刷新、服务重启也不恢复草稿。状态页与仓库页之间切换会保留连接。
- 服务最多保留 8 个上下文，每个固定 1 小时有效；每个草稿最多 10 个文件，每个文件 192 KiB。仓库列表最多 20 页，每页 50 项；树最多 1,500 项；Checks 最多 30 个运行，最多读取其中 6 个运行各 50 条批注。截断会提示。
- 常见受限文件名会被过滤，包括 `.env*`、`.git`、`.npmrc`、`.pem`、`.key`；这不是通用秘密扫描器。
- 通过 Agent 读取的源码与建议会进入 DSH 正常工具历史，并可能发给用户配置的模型。原任务状态统计不保存源码；新工作台的隐私边界不同。
- GitHub 权限、SSO 或限流问题由 GitHub CLI/API 返回。只读仓库可以查看，不能发布；企业策略也可能阻止写入。
- 发布后重复点击会返回已有结果。建分支或建 PR 后发生网络错误，当前服务保留重试状态并先查询远端结果；不保证服务重启后的持久幂等。创建 commit 时超时可能留下未挂到分支的 Git 对象。
- `base-moved`：基准分支已变化。`context-expired`：重新打开快照。`agent-context-changed`：旧请求引用了已替换的快照。`github-login-required`：重新检查 CLI 登录。`github-cli-unavailable`：检查 gh 路径。

## English quick start

This feature is available starting with `0.2.0-preview.1`; the old 0.1.0 package does not include it. Install Node >=24.9, Java >=17 and official GitHub CLI. Download the Release ZIP, unpack it and install `./dsh-task-pulse-0.2.0-preview.1.tgz` through DSH Plugin Manager. Maven >=3.8 is needed only when building the Java companion from source. Run `gh auth login --web --hostname github.com` in your terminal.

Start the JAR with `--pulse.allowed-origin=<your exact DSH browser origin>`. Pair the Pulse GitHub tab using the local token printed by the service. To enable Agent proposals, start DSH with that same `PULSE_BRIDGE_TOKEN` environment variable. No custom OAuth app is required. The service uses the active CLI account's existing permissions.

Select a repository/branch, inspect SHA-pinned source and real check annotations, edit manually or ask the Agent to propose changes, refresh and review expandable diffs, then explicitly create a new branch and draft PR. Agent tools cannot publish. No tests are run by the workbench. Source read by the Agent becomes normal DSH tool history and may be sent to your configured model. Drafts are memory-only, expire after one hour and are cleared when disconnected. Only existing UTF-8 files are supported; no new/deleted files, binary files, automatic fork, merge or remote deployment.

See [verification](verification.md) for the exact tested and untested boundaries.
