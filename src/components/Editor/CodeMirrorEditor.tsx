/**
 * components/Editor/CodeMirrorEditor.tsx —— CodeMirror 6 即时渲染编辑器封装（阶段 5a）
 *
 * 基于 @uiw/react-codemirror 4.25.11（API 以 node_modules 类型定义核实）：
 * - theme 走自研 EditorView.theme（markdownDecorations.ts，语义色 CSS 变量）
 * - 扩展：@codemirror/lang-markdown（列表 Enter 续行等语言能力）+ 即时渲染装饰
 *   （markdownDecorationExtension）+ Ctrl/Cmd+S 保存 keymap（run 返回 true 阻断默认）
 * - basicSetup 精简：去行号/折叠槽/自动补全/默认语法高亮（显示完全由装饰控制，
 *   避免 defaultHighlightStyle 的标题样式与自研装饰冲突）
 * - 受控 value：@uiw 内部在 onChange 后比对 value 与 doc，相等不 dispatch，
 *   输入时光标不跳（typingLatch 机制）；外部改 value（切笔记）才整文替换
 * - extensions/basicSetup 用 useMemo 固定引用：@uiw 的 reconfigure effect 依赖
 *   extensions/onChange 等引用，避免每次输入触发整编辑器 reconfigure
 * - forwardRef 暴露 MarkdownInsertApi：快捷工具栏（MarkdownToolbar）调用
 *   wrap/block 在光标处插入 markdown 语法，源文本始终为标准 markdown
 */
import { forwardRef, memo, useImperativeHandle, useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { indentWithTab } from '@codemirror/commands'
import type { BasicSetupOptions } from '@uiw/codemirror-extensions-basic-setup'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { keymap, EditorView } from '@codemirror/view'

import { cn } from '@/lib/utils'
import {
  markdownDecorationExtension,
  markdownEditorTheme,
} from './markdownDecorations'

interface CodeMirrorEditorProps {
  value: string
  onChange(value: string): void
  /** Ctrl/Cmd+S 保存回调（仅编辑器内焦点生效；表单其他输入框由表单 window 监听兜底） */
  onSave?: () => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

/** 快捷工具栏插入 API（MarkdownToolbar 消费） */
export interface MarkdownInsertApi {
  /** 包裹：选中文本包 before..after；无选中插 before+placeholder+after，光标居中 */
  wrap(before: string, after?: string, placeholder?: string): void
  /**
   * 行级插入：空行直接行首插入；非空行在行首插入（行首已有标题标记时替换级别）
   * block=true 时在光标处插入多行块（prefix\\nsuffix），光标居中
   */
  block(prefix: string, suffix?: string, opts?: { block?: boolean; placeholder?: string }): void
  /** 插入图片语法 `![文件名](路径)`，光标落在末尾（路径中 () 已转义） */
  insertImage(path: string): void
  /** 跳转定位：滚动到文档偏移并移动光标（元信息面板大纲跳转用） */
  jumpTo(pos: number): void
  focus(): void
}

const BASIC_SETUP: BasicSetupOptions = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLineGutter: false,
  highlightActiveLine: true,
  autocompletion: false,
  syntaxHighlighting: false,
}

const CodeMirrorEditor = memo(
  forwardRef<MarkdownInsertApi, CodeMirrorEditorProps>(
    function CodeMirrorEditor(
    { value, onChange, onSave, placeholder, autoFocus = false, className },
    ref,
  ) {
    // saveRef：keymap 创建后不随渲染重建，回调永远取最新闭包
    const saveRef = useRef(onSave)
    saveRef.current = onSave
    const viewRef = useRef<EditorView | null>(null)

    const api = useMemo<MarkdownInsertApi>(() => {
      const getView = () => viewRef.current
      return {
        wrap(before, after = before, placeholderText = '') {
          const view = getView()
          if (!view) return
          const { from, to } = view.state.selection.main
          const sel = view.state.sliceDoc(from, to)
          const text = sel ? before + sel + after : before + placeholderText + after
          view.dispatch({
            changes: { from, to, insert: text },
            selection: sel ? { anchor: from + text.length } : { anchor: from + before.length },
          })
          view.focus()
        },
        block(prefix, suffix = '', opts = {}) {
          const view = getView()
          if (!view) return
          const { head } = view.state.selection.main
          const line = view.state.doc.lineAt(head)
          const lineText = view.state.sliceDoc(line.from, line.to)

          if (opts.block) {
            // 多行块（代码块/公式块/表格/分割线）：光标处插入，光标落在内容起点/末尾。
            // 光标不在行首时补换行：围栏/表格必须行首独立成块（否则解析失败）
            const lead = head > line.from ? '\n' : ''
            const text = lead + (suffix ? `${prefix}\n${suffix}\n` : prefix)
            const caret = head + lead.length + (suffix ? prefix.length + 1 : text.length)
            view.dispatch({
              changes: { from: head, to: head, insert: text },
              selection: { anchor: caret },
            })
            view.focus()
            return
          }

          // 行级：标题/列表/引用/勾选框——光标始终落在标记之后（prefix.length）
          const insert = (text: string, cursorOffset: number) => {
            view.dispatch({
              changes: { from: line.from, to: line.from, insert: text },
              selection: { anchor: head + cursorOffset },
            })
          }
          // 标题：行首已有 # 标记则替换级别（如 ## → #）
          const headingMatch = /^#{1,6}\s+/.exec(lineText)
          if (/^#{1,6}\s+/.test(prefix) && headingMatch) {
            const headFrom = line.from + headingMatch[0].length
            view.dispatch({
              changes: { from: line.from, to: headFrom, insert: prefix },
              selection: { anchor: head + (prefix.length - headingMatch[0].length) },
            })
            view.focus()
            return
          }
          if (lineText.trim() === '') {
            // 空行：行首插 prefix（+placeholder），光标在 prefix 后
            const ph = opts.placeholder ?? ''
            insert(prefix + ph, prefix.length)
          } else if (lineText.startsWith(prefix.trimStart())) {
            // 已有同类型标记：不重复插入，仅聚焦
            view.focus()
          } else {
            insert(prefix, prefix.length)
          }
          view.focus()
        },
        insertImage(path) {
          const view = getView()
          if (!view) return
          const { head } = view.state.selection.main
          const alt = path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? '图片'
          // 路径中 () 需转义（markdown 链接语法冲突），空格/中文 GFM 直接可用
          const safePath = path.replace(/\(/g, '%28').replace(/\)/g, '%29')
          const text = `![${alt}](${safePath})`
          view.dispatch({
            changes: { from: head, to: head, insert: text },
            selection: { anchor: head + text.length },
          })
          view.focus()
        },
        jumpTo(pos) {
          const view = getView()
          if (!view) return
          view.dispatch({
            selection: { anchor: pos },
            effects: EditorView.scrollIntoView(pos),
          })
          view.focus()
        },
        focus() {
          getView()?.focus()
        },
      }
    }, [])

    useImperativeHandle(ref, () => api, [api])

    const extensions = useMemo(
      () => [
        // GFM 扩展：语法树解析表格/任务列表/删除线等（装饰由 markdownDecorations 从语法树派生）
        markdown({ extensions: [GFM] }),
        // 软换行（需求 15）：超长行按视口宽度自动换行，不再横向延伸
        EditorView.lineWrapping,
        markdownDecorationExtension,
        keymap.of([
          // Tab 缩进 / Shift+Tab 反缩进（嵌套列表必备，basicSetup 默认不含）
          indentWithTab,
          {
            key: 'Mod-s',
            run: () => {
              saveRef.current?.()
              return true // 阻断浏览器默认（保存页面等）
            },
          },
        ]),
      ],
      [],
    )

    return (
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={markdownEditorTheme}
        placeholder={placeholder}
        autoFocus={autoFocus}
        height="100%"
        basicSetup={BASIC_SETUP}
        onCreateEditor={(view) => {
          viewRef.current = view
        }}
        className={cn('h-full', className)}
      />
    )
  },
  ),
)

export default CodeMirrorEditor
