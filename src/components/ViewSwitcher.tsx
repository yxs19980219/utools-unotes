/**
 * components/ViewSwitcher.tsx —— 侧边栏顶部分段控件（R5，08-12 重构）
 *
 * [首页|标签|归档] 三视图均分侧边栏宽度（设置入口已移至底部齿轮 SidebarSettingsButton）。
 * - 侧边栏加深（bg-sidebar #f0f0f0）后 TabsList 去 bg-muted（不可辨），改透明底；
 *   Tab 悬停底色 hover:bg-accent/60、选中白底（data-active:bg-background）
 * - 路由切换直接调用（实时保存时代无确认）
 */
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useUiStore, type View } from '@/stores/ui'

const VIEWS: { value: View; label: string }[] = [
  { value: 'home', label: '首页' },
  { value: 'tags', label: '标签' },
  { value: 'archived', label: '归档' },
]

export default function ViewSwitcher() {
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)

  return (
    <Tabs value={view} onValueChange={(v) => setView(v as View)} className="w-full gap-0">
      <TabsList className="w-full bg-transparent p-0">
        {VIEWS.map((v) => (
          <TabsTrigger
            key={v.value}
            value={v.value}
            className="h-8 rounded-md px-1 text-[0.9rem] transition-colors hover:bg-accent/60"
          >
            {v.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
