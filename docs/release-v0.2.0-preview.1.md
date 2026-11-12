# DSH Task Pulse v0.2.0-preview.1 — GitHub workbench

Review repository changes beside the DSH conversation. This preview adds an optional GitHub workbench to the existing task-status sidebar.

## What changed

- Reuse official GitHub CLI login; no custom GitHub App registration.
- Choose a repository/branch, browse a collapsible tree and inspect SHA-pinned source inside DSH.
- Follow real check annotations to source lines; old-SHA, directory and unknown-file annotations are excluded from navigation.
- Ask DSH to propose edits through the optional `pulse_github` Host tool, or edit manually. Review expandable per-file diffs and jump to the correct original/proposed line.
- Explicitly create a fresh `pulse/` branch and draft PR after reviewing. The Agent tool cannot publish or merge.
- Proposal receipts return metadata instead of echoing all source into model context. Drafts stay in bounded memory.

The original task-status sidebar remains usable without Java or GitHub login. The earlier pure waste-detection engine is included, but this release does not add a waste-meter UI or automatic cancellation.

## Download and run

Download **`dsh-task-pulse-0.2.0-preview.1.zip`** from the assets. It contains the plugin tarball, Java companion JAR, setup guide and screenshots. Node >=24.9, Java >=17 and official GitHub CLI are required for the workbench. Maven is not required for the prebuilt ZIP.

After unpacking:

```powershell
gh auth login --web --hostname github.com
npx @deepseek-ai/dsh@0.2.2-rc.1 plugin --profile web add ./dsh-task-pulse-0.2.0-preview.1.tgz
java -jar ./pulse-github-0.2.0-preview.1.jar --pulse.allowed-origin=http://127.0.0.1:3000
```

Use your exact DSH browser Origin. The Java terminal prints a local pairing token. To enable Agent proposals, open another terminal and start DSH with that same token:

```powershell
$env:PULSE_BRIDGE_TOKEN = '<local pairing token from the Java terminal>'
$env:PULSE_BRIDGE_URL = 'http://127.0.0.1:43127'
npx @deepseek-ai/dsh@0.2.2-rc.1 web
```

Open a session's sidebar, add **Pulse · Task status**, select **Repository**, and pair the service. In Chinese: **Pulse · 任务状态 → 代码仓库**.

Full guide: https://github.com/Yeti11H/dsh-task-pulse/blob/v0.2.0-preview.1/docs/github-workbench.md

npm previews use `next` when published; check the registry before using `dsh-task-pulse@0.2.0-preview.1`. This GitHub tarball works independently of npm publication. Default npm/marketplace installs may continue to use the older version.

## Verification and limits

- 43 Node tests; exact DSH rc.1/rc.2 type checks, tests and builds pass. Java service: 17 tests pass.
- Real Windows DSH rc.1 + official CLI GitHub reads + local keyless model fixture verified Session.prompt, Host context/read/propose, diff navigation and draft cleanup. No paid model was used.
- Real GitHub branch/PR publication is **not** runtime-tested; publication and retry tests use a fake GitHub transport. No project tests are run by the workbench, and proposals are not claimed to pass CI.
- rc.2 runtime, desktop, other OS runtime, enterprise GitHub and remote/HTTPS deployment remain unverified.
- Existing UTF-8 files only; no new/deleted/binary files, automatic fork or merge. Drafts expire after one hour and are not recovered after restart.
- The service uses the active CLI account's existing scopes. Source read by Agent tools enters normal DSH history and may reach the user's configured model.

![Real DSH integration with a local test model and read-only GitHub access](https://github.com/Yeti11H/dsh-task-pulse/releases/download/v0.2.0-preview.1/github-workbench-dsh.png)

![Interactive UI fixture: repository, annotations and PR publication are simulated](https://github.com/Yeti11H/dsh-task-pulse/releases/download/v0.2.0-preview.1/github-workbench-demo.png)

Independent community project, MIT; no DeepSeek endorsement. Feedback: https://github.com/Yeti11H/dsh-task-pulse/issues

中文：这次从“看状态”增加到“在对话旁审阅代码”。下载 ZIP 即可取得插件、Java 服务和操作说明，无需注册 GitHub App。真实环境验证使用本地测试模型与 GitHub 只读访问；真实发布 PR、商业模型修复和桌面版尚未实测。请先用小仓库验证查看、定位和草稿审阅，再决定是否点击真实发布按钮。
