/**
 * components/Editor/AtomicEditor.tsx —— CM6 即时渲染编辑器内核（atomic-editor + 自研公式扩展）
 *
 * 任务 08-14-editor-ux-rebuild 阶段 2：以 @atomic-editor/editor 0.6.2 替换基线
 * @uiw/react-codemirror 壳与自研装饰系统（markdownDecorations/markdownBlockWidgets 已删）。
 *
 * 对外契约与基线 CodeMirrorEditor 完全一致（NoteView/MarkdownToolbar/MetaInfoPanel 零改动）：
 * - props：value/onChange/onSave/placeholder/autoFocus/className + forwardRef<MarkdownInsertApi>
 * - 新增 documentId：atomic 的文档身份（换笔记 remount，光标/undo 不串笔记）
 * - 新增 readOnly：归档只读（atomic readOnly Compartment，渲染一致，公式/表格仍显示）
 *
 * 关键机制：
 * - 受控语义：atomic 的 markdownSource 只在挂载时生效 → 外部 value 变化（切笔记）
 *   由 value 同步 effect 整文 replace（view 从 handle.getContentDOM() 经 findFromDOM 取得）。
 * - extensions 组装：mathExtension（标准 $…$/$$…$$）+ 主题变量 + placeholder +
 *   Ctrl/Cmd+S keymap（onSave 走 ref，keymap 挂载后不随渲染重建）
 * - 只读不可变：readOnly 下 updateFilter 拦截一切 doc 改动（含 atomic 勾选框 toggle——
 *   归档笔记必须字节级不可变，AC9）
 * - 代码高亮：codeLanguages 只传已安装的 @codemirror/lang-* 包（js/ts/css/html/md）；
 *   ATOMIC_CODE_LANGUAGES 含未安装包的动态 import，直接使用会导致 build 失败。
 */
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react'
import {
  AtomicCodeMirrorEditor,
  type AtomicCodeMirrorEditorHandle,
} from '@atomic-editor/editor'
import '@atomic-editor/editor/styles.css'
import { indentWithTab } from '@codemirror/commands'
import { LanguageDescription } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'

import { cn } from '@/lib/utils'
import { createMarkdownInsertApi, type MarkdownInsertApi } from './codeMirrorApi'
import { mathExtension } from './extensions/mathExtension'
import './atomicTheme.css'

export type { MarkdownInsertApi } from './codeMirrorApi'

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
  /** 只读（归档）：渲染一致，禁止编辑（updateFilter 保证字节级不可变） */
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
    // saveRef：keymap 创建后不随渲染重建，回调永远取最新闭包
    const saveRef = useRef(onSave)
    saveRef.current = onSave

    const handleRef = useRef<AtomicCodeMirrorEditorHandle | null>(null)

    /** 惰性取当前 EditorView（atomic handle 不暴露 view，走官方 findFromDOM 逃生口） */
    const getView = useMemo(
      () => (): EditorView | null => {
        const dom = handleRef.current?.getContentDOM() ?? null
        return dom ? EditorView.findFromDOM(dom) : null
      },
      [],
    )

    const api = useMemo(() => createMarkdownInsertApi(getView), [getView])
    useImperativeHandle(ref, () => api, [api])

    // 挂载后聚焦（atomic 无 autoFocus prop；子组件 effect 先于本组件执行，handle 已就绪）
    useEffect(() => {
      if (autoFocus) handleRef.current?.focus()
    }, [autoFocus])

    // 受控同步：外部 value 变化（切笔记后 NoteView 草稿更新）→ 整文 replace。
    // 输入路径（onChange 回写）value 恒等于 view doc → no-op；仅外部替换触发。
    useEffect(() => {
      const handle = handleRef.current
      if (!handle) return
      if (handle.getMarkdown() === value) return
      const view = getView()
      if (!view) return
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        selection: { anchor: Math.min(value.length, view.state.selection.main.head) },
      })
    }, [value, getView])

    // 扩展一次性组装（atomic 挂载时捕获，引用必须稳定；placeholder 文本变化频率极低）
    const extensions = useMemo(
      () => [
        placeholder(placeholderText ?? ''),
        mathExtension,
        // 只读不可变：readOnly 下拦截一切 docChanged（含 atomic 勾选框 toggle）
        EditorState.transactionFilter.of((tr) => (!tr.state.readOnly || !tr.docChanged ? tr : [])),
        keymap.of([
          // Tab 缩进 / Shift+Tab 反缩进（嵌套列表必备）
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
      [placeholderText],
    )

    return (
      <div className={cn('h-full', className)}>
        <AtomicCodeMirrorEditor
          markdownSource={value}
          documentId={documentId}
          readOnly={readOnly}
          onMarkdownChange={onChange}
          editorHandleRef={handleRef}
          codeLanguages={CODE_LANGUAGES}
          extensions={extensions}
        />
      </div>
    )
  }),
)

export default AtomicEditor
