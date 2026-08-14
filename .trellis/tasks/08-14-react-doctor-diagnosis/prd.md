# React 代码库全面诊断与修复（react-doctor）

## Goal

对本项目（utools-unotes，React 19 + Vite + Tailwind 4 + shadcn/ui + zustand 的 uTools 插件）运行 react-doctor 全量扫描后，**逐个修复全部诊断问题**，使健康分数显著提升、2 个 error 清零。

## Requirements

- 修复全量扫描发现的 38 个问题（不含 `utools-api-types` 假阳性，见下）。
- 删除已确认未使用的资源：`src/components/ui/toggle.tsx`、`src/components/ui/toggle-group.tsx`、依赖 `next-themes`、`tw-animate-css`。
- 每个发现先读相关代码，确认真假阳性后决定修复；禁止盲目 suppress 或改 react-doctor 配置。
- 修复根因而非绕过；纯风格偏好、无实际影响的理论问题忽略。

## Constraints

- 不 commit、不创建分支、不提交 PR。
- 不修改 `tsconfig.app.json` 中 `utools-api-types` 的 types 引用（该 devDep 为假阳性，提供全局 `utools` 类型，项目大量使用）。
- 修复需保持既有行为不变；涉及 API/UX/架构决策时停下询问。

## Acceptance Criteria

- [x] 2 个 error（`no-ref-current-in-render`）清零。
- [x] 全量扫描分数较 59 分明显提升（59 → 79）。
- [x] 删除 2 个文件 + 2 个依赖，且 `npm run typecheck` 通过。
- [x] 每个修复有代码上下文依据，无盲目 suppress。

## Notes

- 原始扫描结果见 `C:\Users\Fengzhi\AppData\Local\Temp\react-doctor-c17f96c0-414d-4dd1-b5a0-d8c718dbe268\diagnostics.json` 及各 `.txt` 文件。

## 最终结论（已获用户确认）

- 分数 59 → 79，问题 38 → 8，typecheck 通过。
- 剩余 8 项处理：
  - `utools-api-types`（1）＝假阳性，保留。原因：通过 `tsconfig.app.json` 的 `types` 提供全局 `utools` 类型，非 import 引用。
  - `prefer-dynamic-import`（7）＝已知且有意为之。原因：均为 CodeMirror 编辑器核心库同步依赖；uTools 本地插件无网络加载，懒加载收益有限且会让编辑器初始化变 async，属过度优化。
