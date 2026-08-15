/**
 * components/Editor/AtomicEditor.tsx —— CM6 即时渲染编辑器内核（atomic-editor 低层组合）
 *
 * 任务 08-14-editor-cm6-research：以 @atomic-editor/editor 0.6.2 拆散扩展替换 Milkdown。
 * 自组 EditorView（而非 AtomicCodeMirrorEditor 组件）——组件句柄不暴露 EditorView，
 * MarkdownInsertApi 的 wrap/block/jumpTo 需要 dispatch 文档变更，故必须持有 view 实例。
 *
 * 对外契约与旧 MilkdownEditor 完全一致（NoteView/MarkdownToolbar/MetaInfoPanel 零改动）：
 * - props：value/onChange/onSave/placeholder/autoFocus/className + forwardRef<MarkdownInsertApi>
 * - documentId：文档身份（父组件 key remount + 本 effect 双保险，光标/undo 不串笔记）
 * - readOnly：归档只读（readOnlyExtension，勾选框/表格天然不可交互）
 *
 * 装配（扩展顺序对齐 atomic 组件源码，只增不减）：
 * - atomic-editor：inlinePreview/tables/imageBlocks/highlightMarkdown/atomicTheme/
 *   atomicMarkdownSyntax/autoCloseCodeFence/extendEmphasisPair/startAsteriskList
 * - 自研：mathExtension（KaTeX 公式）+ underlineExtension（<u>下划线）+ Mod-s keymap
 * - placeholder（组件未内置占位提示）
 *
 * 受控语义：切笔记由父组件 key 重挂载（见 design D2），本组件挂载时读 value 为初始 doc；
 * 之后编辑器为真相源，updateListener docChanged → onChange 回写（NoteView 防抖保存不变）。
 */
import { memo, useEffect, useImperativeHandle, useMemo, useRef, forwardRef } from 'react'
import {
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  placeholder,
  rectangularSelection,
  EditorView,
} from '@codemirror/view'
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
} from '@codemirror/state'
import { indentOnInput, syntaxTree, type LanguageDescription } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { search, searchKeymap } from '@codemirror/search'
import {
  atomicEditorTheme,
  atomicMarkdownSyntax,
  autoCloseCodeFence,
  extendEmphasisPair,
  highlightMarkdown,
  imageBlocks,
  inlinePreview,
  readOnlyExtension,
  startAsteriskList,
  tables,
} from '@atomic-editor/editor'
import { ATOMIC_CODE_LANGUAGES } from '@atomic-editor/editor/code-languages'
import '@atomic-editor/editor/styles.css'

import { cn } from '@/lib/utils'
import { mathExtension } from './extensions/mathExtension'
import { underlineExtension, UNDERLINE_RE } from './extensions/underlineDecoration'
import { createMarkdownInsertApi, type MarkdownInsertApi } from './markdownInsertApi'
import './atomicTheme.css'

export type { MarkdownInsertApi } from './markdownInsertApi'

/** 光标处格式状态（工具栏联动：selection 变化时由编辑器计算上报） */
export interface ActiveFormatState {
  heading: 0 | 1 | 2 | 3 | 4 | 5 | 6
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  highlight: boolean
  inlineCode: boolean
  link: boolean
  quote: boolean
  ul: boolean
  ol: boolean
  task: boolean
}

export const EMPTY_ACTIVE_FORMAT: ActiveFormatState = {
  heading: 0,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  highlight: false,
  inlineCode: false,
  link: false,
  quote: false,
  ul: false,
  ol: false,
  task: false,
}

/** 计算光标处格式：语法树（标题/强调/链接/引用/列表）+ 正则（<u> 下划线） */
function computeActiveFormat(state: EditorState): ActiveFormatState {
  const fmt: ActiveFormatState = { ...EMPTY_ACTIVE_FORMAT }
  const head = state.selection.main.head
  const line = state.doc.lineAt(Math.min(head, state.doc.length))
  const lineText = line.text

  // 下划线：正则全局扫描（UNDERLINE_RE 含 g 标志，需要重置 lastIndex）
  const text = state.doc.toString()
  UNDERLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = UNDERLINE_RE.exec(text)) !== null) {
    if (head > m.index && head < m.index + m[0].length) {
      fmt.underline = true
      break
    }
  }

  // 语法树：光标节点沿父链收集（长文档光标行可能未解析 → 尽力而为）
  const node = syntaxTree(state).resolveInner(head, -1)
  let n: typeof node | null = node
  while (n && n.name !== 'Document') {
    switch (n.name) {
      case 'ATXHeading1': fmt.heading = 1; break
      case 'ATXHeading2': fmt.heading = 2; break
      case 'ATXHeading3': fmt.heading = 3; break
      case 'ATXHeading4': fmt.heading = 4; break
      case 'ATXHeading5': fmt.heading = 5; break
      case 'ATXHeading6': fmt.heading = 6; break
      case 'StrongEmphasis': fmt.bold = true; break
      case 'Emphasis': fmt.italic = true; break
      case 'Strikethrough': fmt.strike = true; break
      case 'InlineCode': fmt.inlineCode = true; break
      case 'Link': fmt.link = true; break
      case 'Highlight': fmt.highlight = true; break
      case 'Blockquote': fmt.quote = true; break
      case 'ListItem': {
        const lm = /^(\s*)([-*+]|\d+[.)])\s/.exec(lineText)
        if (lm) {
          if (/^\d+[.)]$/.test(lm[2])) fmt.ol = true
          else fmt.ul = true
          if (/\[[ xX]\]/.test(lineText)) fmt.task = true
        }
        break
      }
    }
    n = n.parent
  }
  return fmt
}

interface AtomicEditorProps {
  value: string
  onChange(value: string): void
  /** Ctrl/Cmd+S 保存回调（仅编辑器内焦点生效；表单其他输入框由表单 window 监听兜底） */
  onSave?: () => void
  /** selection 变化时上报光标处格式状态（工具栏联动；缺省不上报） */
  onActiveFormat?: (fmt: ActiveFormatState) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
  /** 文档身份：变化时重挂载（切笔记），光标/undo 不串文档 */
  documentId: string
  /** 只读（归档）：渲染一致，禁止编辑 */
  readOnly?: boolean
}

/** 围栏语法高亮：复用 atomic 的 21 种开箱即用语言（@codemirror/lang-* + legacy-modes） */
const CODE_LANGUAGES: readonly LanguageDescription[] = ATOMIC_CODE_LANGUAGES

/**
 * R1：空引用行行尾 Enter 退出引用（Obsidian 标准，Enter 两次）——lang-markdown 的
 * insertNewlineContinueMarkup 需「连续两行空引用」才退出（实际 Enter 三次）。这里改为
 * 空引用行 Enter 即退出；非空引用行/非引用行返回 false，让 markdownKeymap 继续处理
 * （续 `> ` / 列表续行不受影响）。
 */
function exitBlockquoteOnEnter(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty) return false
  const line = state.doc.lineAt(sel.from)
  if (sel.from !== line.to) return false
  const m = /^(\s*)(>)\s*$/.exec(line.text)
  if (!m) return false
  const from = line.from + m[1].length
  view.dispatch({
    changes: { from, to: line.to, insert: '' },
    selection: EditorSelection.cursor(from),
  })
  return true
}

const AtomicEditor = memo(
  forwardRef<MarkdownInsertApi, AtomicEditorProps>(function AtomicEditor(
    {
      value,
      onChange,
      onSave,
      onActiveFormat,
      placeholder: placeholderText,
      autoFocus = false,
      className,
      documentId,
      readOnly = false,
    },
    ref,
  ) {
    // 回调 ref：keymap/updateListener 在事件阶段读取最新回调。
    // 于 effect 阶段同步（而非 render 期间 mutate ref），避免并发渲染下泄漏未提交的 render 值。
    const saveRef = useRef(onSave)
    const onChangeRef = useRef(onChange)
    const onActiveFormatRef = useRef(onActiveFormat)
    useEffect(() => {
      saveRef.current = onSave
      onChangeRef.current = onChange
      onActiveFormatRef.current = onActiveFormat
    })

    const rootRef = useRef<HTMLDivElement | null>(null)
    const viewRef = useRef<EditorView | null>(null)
    // Compartment 惰性初始化（guard 写 ref 为 React 官方 lazy-init 模式，避免每次 render 重建）
    const readOnlyCompartmentRef = useRef<Compartment | null>(null)
    if (readOnlyCompartmentRef.current === null) {
      readOnlyCompartmentRef.current = new Compartment()
    }

    // api 提前到 effect 之前：keymap（Mod-b/i/u）需在扩展装配时引用 toggleInline，
    // 而 api 只依赖 viewRef（useRef 稳定），位置不影响语义
    const api = useMemo(() => createMarkdownInsertApi(() => viewRef.current), [])
    useImperativeHandle(ref, () => api, [api])

    // 编辑器生命周期：documentId 变化时销毁重建（父组件 key remount + 本 effect 双保险）
    useEffect(() => {
      const root = rootRef.current
      if (!root) return
      const initialValue = value

      const view = new EditorView({
        parent: root,
        state: EditorState.create({
          doc: initialValue,
          extensions: [
            highlightSpecialChars(),
            history(),
            drawSelection(),
            dropCursor(),
            EditorState.allowMultipleSelections.of(true),
            indentOnInput(),
            rectangularSelection(),
            highlightActiveLine(),
            closeBrackets(),
            startAsteriskList,
            extendEmphasisPair,
            autoCloseCodeFence,
            EditorView.lineWrapping,
            search({ top: true }),
            markdown({
              base: markdownLanguage,
              codeLanguages: CODE_LANGUAGES as LanguageDescription[],
              extensions: [highlightMarkdown, { remove: ['SetextHeading'] }],
            }),
            markdownLanguage.data.of({
              closeBrackets: { brackets: ['(', '[', '{', "'", '"', '*', '_', '`'] },
            }),
            atomicMarkdownSyntax,
            atomicEditorTheme,
            keymap.of([
              ...closeBracketsKeymap,
              ...historyKeymap,
              ...searchKeymap,
              ...markdownKeymap,
              indentWithTab,
              ...defaultKeymap,
            ]),
            tables(),
            imageBlocks(),
            inlinePreview(),
            placeholder(placeholderText ?? ''),
            mathExtension,
            underlineExtension,
            Prec.high(
              keymap.of([
                {
                  key: 'Mod-s',
                  run: () => {
                    saveRef.current?.()
                    return true
                  },
                },
                {
                  key: 'Mod-b',
                  run: () => {
                    api.toggleInline('**', '**', 'StrongEmphasis')
                    return true
                  },
                },
                {
                  key: 'Mod-i',
                  run: () => {
                    api.toggleInline('*', '*', 'Emphasis')
                    return true
                  },
                },
                {
                  key: 'Mod-u',
                  run: () => {
                    api.toggleInline('<u>', '</u>')
                    return true
                  },
                },
              ]),
            ),
            Prec.high(keymap.of([{ key: 'Enter', run: exitBlockquoteOnEnter }])),
            readOnlyCompartmentRef.current!.of(readOnlyExtension(readOnly)),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                onChangeRef.current(update.state.doc.toString())
              }
              if (onActiveFormatRef.current && (update.selectionSet || update.docChanged)) {
                onActiveFormatRef.current(computeActiveFormat(update.state))
              }
            }),
          ],
        }),
      })
      viewRef.current = view
      if (autoFocus) view.focus()

      // 图片粘贴：Ctrl+V 剪贴板图片 → data URL 插入 `![图片](data:...)`（与 pickImageFile
      // 浏览器降级一致，避免 blob URL 内存驻留）；非图片粘贴不拦截，走 CM6 默认行为。
      const handlePaste = (e: ClipboardEvent) => {
        if (view.state.readOnly) return
        const items = e.clipboardData?.items
        if (!items) return
        let file: File | null = null
        for (const item of items) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            file = item.getAsFile()
            break
          }
        }
        if (!file) return
        e.preventDefault()
        const reader = new FileReader()
        reader.onload = () => {
          if (typeof reader.result !== 'string') return
          const { head } = view.state.selection.main
          const text = `![图片](${reader.result})`
          view.dispatch({
            changes: { from: head, to: head, insert: text },
            selection: { anchor: head + text.length },
          })
          view.focus()
        }
        reader.readAsDataURL(file)
      }
      view.dom.addEventListener('paste', handlePaste)

      return () => {
        view.dom.removeEventListener('paste', handlePaste)
        viewRef.current = null
        view.destroy()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [documentId])

    // readOnly 变化：Compartment reconfigure（不重挂载，保留滚动/搜索态）
    useEffect(() => {
      const view = viewRef.current
      if (!view) return
      view.dispatch({
        effects: readOnlyCompartmentRef.current!.reconfigure(readOnlyExtension(readOnly)),
      })
    }, [readOnly])

    return <div className={cn('atomic-cm-editor', 'h-full', className)} ref={rootRef} />
  }),
)

export default AtomicEditor


