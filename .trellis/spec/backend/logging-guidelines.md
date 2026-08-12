# Logging Guidelines

> How logging is done in this project.

---

## Overview

**本项目无后端服务，无日志体系**（无日志库、无日志文件、无 log level 约定）。数据层约定见 `backend/database-guidelines.md` 与 `backend/error-handling.md`。

唯一现存日志行为（前端侧，不作扩展）：

- `src/App.tsx:31-34` —— `utools.onPluginEnter` 回调内 `console.log('[sourcenote] entered, feature code =', code)`，仅调试入口路由用
- 冒烟测试失败出口：`console.error('SMOKE FAILED:', err)` + `process.exit(1)`（scripts 各文件尾部）

---

## Log Levels

不适用。

---

## Structured Logging

不适用（无结构化日志格式约定）。

---

## What to Log

仅上表两处 console 输出；错误反馈走 UI 层 toast（sonner），不写日志（见 error-handling.md）。

---

## What NOT to Log

不适用（无日志通道）。通用约束：utools.db 文档内容（含笔记正文）不属于日志范畴，任何调试输出不得写入 db（红线见 database-guidelines.md）。
