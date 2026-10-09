import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type ProxyOptions } from 'vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { financeCloudPlugin } from './vite-plugin-finance-cloud.js'

const chromeUA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

function apiProxy(
  prefix: string,
  target: string,
  referer: string,
  extraHeaders?: Record<string, string>,
): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    rewrite: (path) => path.replace(new RegExp(`^${prefix}`), ''),
    headers: {
      Referer: referer,
      'User-Agent': chromeUA,
      ...extraHeaders,
    },
  }
}

const apiProxies: Record<string, ProxyOptions> = {
  // 新浪美股行情（国内可访问；雪球有 WAF，服务端代理不稳定）
  '/api/sina-hq': apiProxy('/api/sina-hq', 'https://hq.sinajs.cn', 'https://finance.sina.com.cn'),
  '/api/danjuan': apiProxy('/api/danjuan', 'https://danjuanfunds.com', 'https://danjuanfunds.com/'),
  // CNN 美股恐贪指数
  '/api/cnn-fg': apiProxy(
    '/api/cnn-fg',
    'https://production.dataviz.cnn.io',
    'https://www.cnn.com/',
    { Origin: 'https://www.cnn.com' },
  ),
  // 东方财富美股 F10 / 分红（股息率 TTM；浏览器直连可能 CORS）
  '/api/eastmoney': apiProxy(
    '/api/eastmoney',
    'https://datacenter.eastmoney.com',
    'https://emweb.eastmoney.com/',
  ),
  // 天天基金 / 东财公募净值（历史净值 LSJZ）
  '/api/fund-eastmoney': apiProxy(
    '/api/fund-eastmoney',
    'https://api.fund.eastmoney.com',
    'https://fundf10.eastmoney.com/',
  ),
  // 天天基金代码检索：添加基金时核对代码并带回官方简称
  '/api/fund-suggest': apiProxy(
    '/api/fund-suggest',
    'https://fundsuggest.eastmoney.com',
    'https://fund.eastmoney.com/',
  ),
  // 东财美股代码检索：添加持仓时核对代码并带回中文简称
  '/api/em-suggest': apiProxy(
    '/api/em-suggest',
    'https://searchapi.eastmoney.com',
    'https://www.eastmoney.com/',
  ),
}

const elementPlusResolver = ElementPlusResolver({ importStyle: 'css' })

/** 项目站路径，对应 https://<owner>.github.io/barbell-financial-console/ */
const githubPagesBase = '/barbell-financial-console/'

function githubPagesSpaFallback() {
  return {
    name: 'github-pages-spa-fallback',
    apply: 'build' as const,
    closeBundle() {
      if (process.env.GITHUB_PAGES !== 'true') return
      const dist = fileURLToPath(new URL('./dist', import.meta.url))
      // GitHub Pages 没有 SPA 回退，深链刷新会落到 404.html
      copyFileSync(join(dist, 'index.html'), join(dist, '404.html'))
    },
  }
}

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? githubPagesBase : '/',
  plugins: [
    vue(),
    UnoCSS(),
    financeCloudPlugin(),
    githubPagesSpaFallback(),
    AutoImport({
      imports: ['vue', 'vue-router', 'pinia', '@vueuse/core'],
      resolvers: [elementPlusResolver],
      dts: 'src/auto-imports.d.ts',
      eslintrc: {
        enabled: true,
        filepath: './.eslintrc-auto-import.json',
        globalsPropValue: true,
      },
    }),
    Components({
      resolvers: [elementPlusResolver],
      dts: 'src/components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 888,
    proxy: apiProxies,
  },
  preview: {
    proxy: apiProxies,
  },
})
