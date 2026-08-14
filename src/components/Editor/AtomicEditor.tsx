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
import { Compartment, EditorSelection, EditorState, Prec } from '@codemirror/state'
import { indentOnInput, LanguageDescription } from '@codemirror/language'
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
import '@atomic-editor/editor/styles.css'

import { cn } from '@/lib/utils'
import { mathExtension } from './extensions/mathExtension'
import { underlineExtension } from './extensions/underlineDecoration'
import { createMarkdownInsertApi, type MarkdownInsertApi } from './markdownInsertApi'
import './atomicTheme.css'

export type { MarkdownInsertApi } from './markdownInsertApi'

interface AtomicEditorProps {
  value: string
  onChange(value: string): void
  /** Ctrl/Cmd+S 保存回调（仅编辑器内焦点生效；表单其他输入框由表单 window 监听兜底） */
  onSave?: () => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
  /** 文档身份：变化时重挂载（切笔记），光标/undo 不串文档 */
  documentId: string
  /** 只读（归档）：渲染一致，禁止编辑 */
  readOnly?: boolean
}

/** 已安装的 @codemirror/lang-*（围栏语法高亮用；勿引入未安装包） */
const CODE_LANGUAGES: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['js', 'jsx'],
    extensions: ['js', 'mjs', 'cjs', 'jsx'],
    load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['ts', 'tsx'],
    extensions: ['ts', 'mts', 'cts', 'tsx'],
    load: () =>
      import('@codemirror/lang-javascript').then((m) =>
        m.javascript({ typescript: true, jsx: true }),
      ),
  }),
  LanguageDescription.of({
    name: 'HTML',
    alias: ['htm'],
    extensions: ['html', 'htm'],
    load: () => import('@codemirror/lang-html').then((m) => m.html()),
  }),
  LanguageDescription.of({
    name: 'CSS',
    extensions: ['css'],
    load: () => import('@codemirror/lang-css').then((m) => m.css()),
  }),
  LanguageDescription.of({
    name: 'Markdown',
    alias: ['md'],
    extensions: ['md', 'markdown', 'mkd'],
    load: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  }),
]

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
    useEffect(() => {
      saveRef.current = onSave
      onChangeRef.current = onChange
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
              if (!update.docChanged) return
              onChangeRef.current(update.state.doc.toString())
            }),
          ],
        }),
      })
      viewRef.current = view
      if (autoFocus) view.focus()

      return () => {
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
