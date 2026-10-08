# Personal Barbell Financial Console

跨币种（CNY / HKD / USD）、多账户个人资产控制台，遵循塔勒布哑铃策略（Barbell Strategy）。

在线预览：<https://t34-active.github.io/barbell-financial-console/>

## 技术栈

- Vue 3 + TypeScript + Vite
- UnoCSS（原子化样式 + Carbon Icons）
- Pinia + LocalStorage 持久化
- Vue Router
- Element Plus（`unplugin-vue-components` / `unplugin-auto-import` 按需引入）

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
npm run preview
```

本地构建的资源前缀是 `/`。要复现线上包，先设置 `GITHUB_PAGES=true` 再构建，产物会挂在 `/barbell-financial-console/` 下，并带一份 `404.html` 供子页面刷新。

## GitHub Pages

推送到 `main` 后，[`.github/workflows/pages.yml`](.github/workflows/pages.yml) 会执行 `npm ci` 与 `npm run build`（`GITHUB_PAGES=true`），把 `dist` 发到：

<https://t34-active.github.io/barbell-financial-console/>

Pages 只托管静态文件。

- 打开后是空种子；账本写在这台浏览器的 LocalStorage，清站点数据会丢
- `public/pbfc-finance/` 在 `.gitignore` 里，本机账本不会出现在线上
- 新浪行情、东财净值、天天基金检索、CNN 恐贪走 Vite 开发代理，静态站没有这层代理，刷新行情会失败
- 改了依赖要一并提交 `package-lock.json`，否则 Actions 里的 `npm ci` 会失败

## 目录结构

```
src/
  types/finance.ts      # Schema 类型
  data/seed.ts          # 初始种子数据
  stores/finance.ts     # Pinia 状态 / 哑铃 / 工资分配
  utils/salary-allocation.ts  # 百分比拆分与补仓规则
  components/           # 总览 / 账户 / 哑铃 / 工资组件
  views/                # 总览 · 账户 · 工资 · 设置
  layouts/              # PC + H5 响应式壳层
```

## 数据说明

- 基准币种默认 `HKD`，可在设置页切换
- 汇丰安全红线默认 `10000 HKD`
- 汇率以 HKD 为中转：`fx_to_hkd`
- 工资默认比例：爸妈 30% / 安全垫 25% / 美股种子 35% / 快乐基金 10% / 旅游基金 0%
- 应急备用金目标 `20000 CNY`：满额后安全垫份额并入进攻端；跌破后自动回溯补仓
- 黄金 ETF 归入中性池，不计入安全端
- 快乐基金进独立口袋，月末强制结转（50/50 或全额进攻）
- 旅游基金暂存余利宝吃利息，出行时再花；不计入储蓄率
- 纳指 PE 高估保险丝：进攻份额暂扣现金观察仓
- 总览展示本月实际储蓄率（安全垫+进攻份额）/工资
- 本地键名：`pbfc-finance`
- 设置页支持「导出 / 导入备份 JSON」
- 真实余额写在 `public/pbfc-finance/`，该目录已加入 `.gitignore`，不会进入 Git
- 空文件结构见 `share/pbfc-finance/`。克隆后没有本地账本时，应用使用 `src/data/seed.ts` 里的空种子

## 数据备份（当前已实现）

| 类型 | 存放位置 | 风险 | 做法 |
|------|----------|------|------|
| 代码 | 本公开仓库 | 换机丢代码 | `git commit` + `git push` |
| 财务数据 | 本机 `public/pbfc-finance/` 与浏览器 LocalStorage `pbfc-finance` | 清缓存 / 换设备会丢 | 设置页导出 JSON → 网盘/U 盘；需要时导入。不要 `git add` 账本 |

现阶段**不需要数据库**。导出的是完整财务快照，导入前会二次确认覆盖。开发时自动同步仍会写入 `public/pbfc-finance/`，这些文件只留在你自己的电脑上。

## 未来同步构想（设计笔记，未实现）

目标：小程序侧录入 → 云上只存密文 → 本地控制台拉取并解密 → 写入 LocalStorage。  
加密解决「别人看不懂」；同步解决「密文存在哪、谁写谁读」。两者分开设计。

### 密钥模型（混合加密）

不要「每操作换一对公私钥」——那样旧数据无法解密。

1. **长期身份密钥对**：私钥只留在本地控制台；公钥放进小程序
2. **每次操作生成临时 AES 密钥**：加密本次变更载荷
3. **用公钥包裹该 AES 密钥**：云上只存「密文 + 被包裹的密钥」
4. 本地用私钥解开 AES 密钥，再解密还原操作

这样既做到「每操作新对称密钥」，又能长期解密历史记录。

```text
小程序录入
  → AES 加密本次变更
  → 公钥包裹 AES 密钥
  → 写入中转箱（密文包）

本地控制台
  → 拉取未消费的密文包
  → 私钥解 AES 密钥
  → 解密并合并进 LocalStorage
```

### 建议的同步范围（待定稿）

- **方向（倾向）**：单向 — 小程序 → 本地控制台（小程序当记账入口，电脑当主账本）
- **中转（倾向）**：微信小程序云开发（云数据库或云存储一个密文队列）
- **不做**：传统 MySQL/Supabase；双向实时冲突合并（除非以后明确需要）

### 待拍板

- [ ] 同步方向：仅小程序→本地，还是双向
- [ ] 密文中转：微信云开发 / 自建对象存储 / 继续仅手动 JSON
- [ ] 事件粒度：整包快照 vs 增量操作日志（`op_id` + 幂等合并）

确认后另开实现任务；本 README 仅作备忘，避免想法丢失。
