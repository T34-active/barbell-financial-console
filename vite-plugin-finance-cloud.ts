import fs from 'node:fs'
import path from 'node:path'
import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite'

const DIR_REL = 'public/pbfc-finance'
const LEGACY_REL = 'public/pbfc-finance.json'
const API = '/api/finance-cloud'

/** 与 store 领域一致；写入时缺任一项则整次拒绝 */
const PARTS = ['settings', 'accounts', 'salary', 'yuan_gou', 'crypto_ops', 'loans'] as const

function cloudDir(root: string) {
  return path.resolve(root, DIR_REL)
}

function legacyFile(root: string) {
  return path.resolve(root, LEGACY_REL)
}

function indexFile(root: string) {
  return path.join(cloudDir(root), 'index.json')
}

function partFile(root: string, part: string) {
  return path.join(cloudDir(root), `${part}.json`)
}

function pretty(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function readText(file: string) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function sendJson(res: Connect.ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json;charset=utf-8')
  res.end(JSON.stringify(body))
}

/** 目录存在时拼回整份信封；缺片直接失败，不回退旧单文件 */
function readSplit(root: string): string | null {
  const indexPath = indexFile(root)
  if (!fs.existsSync(indexPath)) return null
  const index = JSON.parse(readText(indexPath)) as unknown
  if (!isRecord(index) || !Array.isArray(index.parts) || index.parts.length === 0) {
    throw new Error('cloud index invalid')
  }
  const data: Record<string, unknown> = {}
  for (const part of index.parts) {
    if (typeof part !== 'string' || !/^[a-z0-9_]+$/i.test(part)) {
      throw new Error('cloud part name invalid')
    }
    const file = partFile(root, part)
    if (!fs.existsSync(file)) throw new Error(`cloud part missing: ${part}`)
    data[part] = JSON.parse(readText(file)) as unknown
  }
  return pretty({
    version: index.version,
    exported_at: index.exported_at,
    key: index.key,
    ...(typeof index.source === 'string' ? { source: index.source } : {}),
    data,
  })
}

function writeIfChanged(file: string, next: string) {
  const prev = fs.existsSync(file) ? readText(file) : null
  if (prev === next) return
  fs.writeFileSync(file, next, 'utf8')
}

/** 校验通过后才落盘；内容未变的领域文件不重写 */
function writeSplit(root: string, parsed: unknown) {
  if (!isRecord(parsed)) throw new Error('body must be a JSON object')
  if (!isRecord(parsed.data)) throw new Error('body.data must be a JSON object')
  for (const part of PARTS) {
    if (!isRecord(parsed.data[part])) throw new Error(`missing domain: ${part}`)
  }

  const dir = cloudDir(root)
  fs.mkdirSync(dir, { recursive: true })
  for (const part of PARTS) {
    writeIfChanged(partFile(root, part), pretty(parsed.data[part]))
  }
  writeIfChanged(
    indexFile(root),
    pretty({
      version: parsed.version ?? 1,
      exported_at:
        typeof parsed.exported_at === 'string' ? parsed.exported_at : new Date().toISOString(),
      key: typeof parsed.key === 'string' ? parsed.key : 'pbfc-finance',
      ...(typeof parsed.source === 'string' ? { source: parsed.source } : {}),
      parts: [...PARTS],
    }),
  )
  const legacy = legacyFile(root)
  if (fs.existsSync(legacy)) fs.unlinkSync(legacy)
}

function attach(middlewares: Connect.Server, root: string) {
  middlewares.use(API, (req, res, next) => {
    if (req.method === 'GET') {
      try {
        const split = readSplit(root)
        if (split != null) {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json;charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(split)
          return
        }
        const legacy = legacyFile(root)
        if (!fs.existsSync(legacy)) {
          sendJson(res, 404, { error: 'cloud file missing' })
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json;charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(fs.readFileSync(legacy))
      } catch (error) {
        sendJson(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
      return
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(Buffer.from(c)))
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8')
          writeSplit(root, JSON.parse(text) as unknown)
          sendJson(res, 200, { ok: true, path: `${DIR_REL}/` })
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
      return
    }

    next()
  })
}

/** 开发/预览时读写 public/pbfc-finance/，供 GitHub 云仓同步 */
export function financeCloudPlugin(): Plugin {
  return {
    name: 'finance-cloud',
    configureServer(server: ViteDevServer) {
      attach(server.middlewares, server.config.root)
    },
    configurePreviewServer(server: PreviewServer) {
      attach(server.middlewares, server.config.root)
    },
  }
}
