对于任何本地代码理解任务（如定位实现、追踪调用链、影响范围等）或修改代码前，请优先使用 CodeGraph MCP 工具——在使用 grep/read 循环之前。

<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## 沟通规范
- 始终以中文回答用户问题
- 执行任何操作前，必须确保用户意图明确：如需求存在歧义、缺少关键信息（如目标分支、文件路径、具体参数等），或可能产生不可逆影响，禁止自行假设或擅自执行。必须先提出问题，向用户确认清楚后，再根据最终答复执行。
- 涉及复杂方案、UI布局、系统架构讨论时：使用ASCII图辅助沟通，图内文字多时不要影响图的美观，图内放数字编号（①、②、③…），图下方附编号对应的注释；UI术语使用行业内标准术语，用户用词不准确时主动纠正

## 开发规范
- UI开发前先确认设计体系：问清楚组件库、设计Token（颜色/间距/字体等），确认后再落地代码。
- 先跑通最小版本，再迭代加功能。不搞预防性抽象，不拆能跑的东西。
- 改旧代码直接删，不写兼容层、不留fallback、不做migration。
- 先查项目已有依赖能做什么，不够再加新包或自己写。不自己造轮子。
- 参考业界成熟方案，用已验证的模式，别从零发明。
- 当用户描述当前行为时，请先阅读相关代码并确认用户的描述属实，然后再编写修复代码。
- 任何工具调用中的每个参数值都必须是一个不间断的单行字符串。不允许包含换行符。

## 必须停下来问的情况
- 用户意图模糊、存在歧义
- 涉及破坏性操作（删文件/数据/提交）
- UI设计体系未确认
- 多条技术路径各有利弊
- 用户指令与上述规则冲突

## 自我迭代
你可能会加载多个插件、技能或MCP服务，彼此之间可能存在冲突或冗余。这些只有在实际使用中才会逐渐暴露。遇到以下情况时：
- 发现指令之间存在矛盾或冲突
- 发现某个技能或插件没有被正确触发或调用
- 发现当前执行方式有更优的替代方案
处理方式：
- 停下来，向用户说明你发现的问题
- 提出优化建议（如调整加载顺序、禁用冲突项、修改触发条件等）
- 与用户确认后再继续执行
每次完成一轮任务后，快速回顾本次执行过程。如果有可以优化的地方，在下一轮主动向用户提出建议。
