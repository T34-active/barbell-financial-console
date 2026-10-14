/**
 * 生成本地 unplugin 产物（components.d.ts / auto-imports.d.ts / eslintrc），供 vue-tsc 与 ESLint 使用。
 * 这些文件已加入 .gitignore，克隆后需 npm run codegen 或 build 前自动执行。
 */
import { createServer } from 'vite'

const server = await createServer({ configFile: 'vite.config.ts' })
try {
  await server.pluginContainer.buildStart({})
} finally {
  await server.close()
}
