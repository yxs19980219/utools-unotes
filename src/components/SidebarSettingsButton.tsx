/**
 * components/SidebarSettingsButton.tsx —— 侧边栏底部设置齿轮（R3）
 *
 * 设置入口从视图 Tab 移除后落在侧边栏底部居中：
 * - 点击 → setView('settings')；view === 'settings' 时选中高亮
 * - 悬停底色 hover:bg-accent；icon-only 按钮带 aria-label（accessibility 规范）
 */
import { SettingsIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useUiStore } from '@/stores/ui'
import { cn } from '@/lib/utils'

export default function SidebarSettingsButton() {
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  const active = view === 'settings'

  return (
    <div className="mt-auto flex shrink-0 justify-center p-2">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="设置"
        title="设置"
        onClick={() => setView('settings')}
        className={cn(
          'rounded-full',
          active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
        )}
      >
        <SettingsIcon data-icon />
      </Button>
    </div>
  )
}
