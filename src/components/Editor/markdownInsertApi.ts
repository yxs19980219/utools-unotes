/** 快捷工具栏插入 API（MarkdownToolbar 消费；CM6 与 Milkdown 实现共用同一契约） */
export interface MarkdownInsertApi {
  /** 包裹：选中文本包 before..after；无选中插 before+placeholder+after */
  wrap(before: string, after?: string, placeholder?: string): void
  /**
   * 行级插入：空行直接行首插入；非空行在行首插入（行首已有标题标记时替换级别）
   * block=true 时在光标处插入多行块
   */
  block(prefix: string, suffix?: string, opts?: { block?: boolean; placeholder?: string }): void
  /** 插入图片（本地路径，光标落在末尾） */
  insertImage(path: string): void
  /** 跳转定位：滚动到大纲第 index 项（标题）并移动光标 */
  jumpTo(index: number): void
  focus(): void
}
