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
 */
import { useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { indentWithTab } from '@codemirror/commands'
import type { BasicSetupOptions } from '@uiw/codemirror-extensions-basic-setup'
import { markdown } from '@codemirror/lang-markdown'
import { keymap } from '@codemirror/view'

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

const BASIC_SETUP: BasicSetupOptions = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLineGutter: false,
  highlightActiveLine: true,
  autocompletion: false,
  syntaxHighlighting: false,
}

export default function CodeMirrorEditor({
  value,
  onChange,
  onSave,
  placeholder,
  autoFocus = false,
  className,
}: CodeMirrorEditorProps) {
  // saveRef：keymap 创建后不随渲染重建，回调永远取最新闭包
  const saveRef = useRef(onSave)
  saveRef.current = onSave

  const extensions = useMemo(
    () => [
      markdown(),
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
      className={cn('h-full', className)}
    />
  )
}
