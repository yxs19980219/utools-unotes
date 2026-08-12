import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * stripDevelopmentField —— uTools 插件构建铁律：
 * dev 模式使用 public/plugin.json（含 development.main 指向 vite dev server），
 * build 产物 dist/plugin.json 必须删除 development 字段，否则发布版会尝试连 dev server。
 */
function stripDevelopmentField() {
  return {
    name: 'strip-development-field',
    closeBundle() {
      const p = path.join(process.cwd(), 'dist', 'plugin.json')
      if (!fs.existsSync(p)) return
      const json = JSON.parse(fs.readFileSync(p, 'utf-8'))
      delete json.development
      fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n', 'utf-8')
    },
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // base: './' —— uTools 以 file:// 协议加载 dist/index.html，资源路径必须相对
  base: './',
  plugins: [react(), tailwindcss(), stripDevelopmentField()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
