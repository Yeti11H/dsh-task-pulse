# DSH Task Pulse v0.1.0 — Preview

A lightweight task-status sidebar for DeepSeek Harness: observable model activity, pending tool calls, known interaction waits, recent work, and quiet-period reminders, with no additional AI calls or backend service.

## Install

Download `dsh-task-pulse-0.1.0.tgz` from the assets below and run:

```powershell
npx @deepseek-ai/dsh@0.2.2-rc.1 plugin --profile web add ./dsh-task-pulse-0.1.0.tgz
npx @deepseek-ai/dsh@0.2.2-rc.1 web
```

Open a session's right sidebar, add a tab, and select **Pulse · Task status** / **Pulse · 任务状态**.

## Scope and validation

- Node.js >=24.9.0; compatibility limited to DSH 0.2.2-rc.1 web profile.
- 13 behavior tests, TypeScript checks, build and package checks passed locally.
- Real DSH browser integration used a keyless local model and delayed tool. It exercised model wait, tool wait, output, completion, refresh restoration, preference persistence, and model-error display.
- Waiting, quiet, disconnect, concurrency, and cancellation boundaries also have state tests; not every boundary has been exercised through a live session.
- No hidden-thought inspection, completion percentage, automatic retries, or task recovery. Silence does not prove a hang.
- Desktop and other DSH releases are not yet verified.

This is an independent community plugin, unrelated to the existing `dsh-pulse` package and not endorsed by DeepSeek.

中文：轻量任务状态侧栏，帮助判断当前在等模型、等工具还是等用户。静默提醒只表示暂未观察到活动，不代表任务卡死。首版为预览版，欢迎反馈状态显示不准确的场景。
