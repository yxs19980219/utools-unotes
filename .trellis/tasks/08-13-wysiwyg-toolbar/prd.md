# ② 所见即所得工具栏：图片/代码块/表格（需求 8-11）

## Goal

工具栏按钮按下后直接呈现格式效果，不再插入裸语法文本。图片选择文件后直接显示图片、代码块显示可输入代码框 + 语言选择、表格显示真实表格（可编辑、可增删行列）。依赖 ① 已合并的语法树基础（Image/FencedCode/Table 节点定位 + 性能基线）。

## Requirements（来自 parent PRD 需求 8-11）

8. 通用原则：按钮按下后直接呈现格式效果，而不是插入裸语法文本
9. 图片：点击后打开电脑文件选择弹窗（utools.showOpenDialog），插入后直接显示图片
10. 代码块：插入一个可输入代码的代码框，且可选择常见语言
11. 表格：插入一个真实表格（可编辑、可增删行列）

## Acceptance Criteria

- [x] 9: 图片按钮 → showOpenDialog（浏览器降级 input file）→ 插入 `![文件名](路径)` → ImageWidget 渲染 `<img>`；失败时原生 alt + 底色占位（禁止 widget 内改 DOM——CM6 会回写文档，实测修复）；路径 () 转义；max-width 100% 不溢出；uTools file:// 显示待用户实测
- [x] 10: 代码块按钮默认 ```ts；语言选择器（原生 select 替换 CodeInfo）：14 种语言 + 无语言，选择后改写围栏源码（实测 ts→python 生效）；无语言围栏不渲染选择器
- [x] 11: 表格按钮插入 3 列 2 行；光标所在表格表头行首工具条（＋行/－行/＋列/－列）源码操作（lib/tableOps 纯函数，6 断言）；单元格直接编辑；实测增删行列全通
- [x] 8: 插入即渲染（图片/代码块/表格即时呈现，无裸语法闪烁）；block 插入不在行首时自动补换行（围栏/表格须行首）
- [x] 回归：smoke-decorations 10 项（含 Image 断言）、smoke 19、stores 18、outline 3、tableOps 6、ui-smoke 47 项全绿；bench 5000 行 < 10ms 不回退
- [ ] uTools 实测：file:// 本地图片显示（关键验证点）、整体交互手感——待用户验收

## Notes

- 依赖 ①（已合并）：语法树 Image/FencedCode/Table 节点 + GFM 解析
- 图片显示：`![alt](path)` 的 Image 节点 → replace widget `<img src=path>`；onerror 时降级为占位（文件名 + 提示）。uTools 环境 file:// 加载本地图需实测；若不可用，评估 blob/其他方案
- 表格交互：**源码编辑 + 工具条增删行列**（保持 markdown 源码为唯一真相，不做 contentEditable widget——避免 CM6 状态冲突）
- 代码块语言选择器：围栏行 widget，点击弹出语言菜单（项目现有 Popover/Command 组件复用）
- 所有操作保持「源码零改动原则」的显示层替换：源码始终是标准 markdown，可跨工具（其他 markdown 编辑器/导出）无损
