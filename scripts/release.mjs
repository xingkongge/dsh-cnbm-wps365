#!/usr/bin/env node
/**
 * 打包——归档——校验和一键完成。
 *
 *   node scripts/release.mjs                 # 优先 pnpm，回退 npm
 *   node scripts/release.mjs --pack-cmd npm
 *
 * 产物：
 *   dist/local-dsh-wps365-<version>.tgz   安装包（不入 Git，走 Release 附件）
 *   dist/SHA256SUMS                       所有历史版本的校验和
 *
 * 发布后请把新的 SHA-256 同步到 INSTALL.md 与知识库安装手册。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const distDir = join(root, 'dist')
mkdirSync(distDir, { recursive: true })

const args = process.argv.slice(2)
const flagIndex = args.indexOf('--pack-cmd')
const candidates = flagIndex >= 0 ? [args[flagIndex + 1]] : ['pnpm', 'npm']

function runPack(command) {
  if (!command) return null
  const result = spawnSync(command, ['pack'], { cwd: root, encoding: 'utf8' })
  if (result.error && result.error.code === 'ENOENT') return null
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} pack 失败（exit ${result.status}）\n${result.stderr || result.stdout}`)
  }
  // 从输出里取最后一行 .tgz（pnpm 直接打印文件名，npm 会夹杂 notice 行）
  const names = (result.stdout || '').split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.tgz'))
  const name = names[names.length - 1]
  if (!name) throw new Error(`无法从 ${command} pack 的输出中解析 tarball 文件名：\n${result.stdout}`)
  const produced = join(root, name)
  if (!existsSync(produced)) throw new Error(`打包产物不存在：${produced}`)
  return { command, produced, name: basename(produced) }
}

let packed = null
for (const command of candidates) {
  packed = runPack(command)
  if (packed) break
}
if (!packed) throw new Error('找不到 pnpm/npm；可用 --pack-cmd 指定打包命令')

const target = join(distDir, packed.name)
if (existsSync(target)) rmSync(target)
renameSync(packed.produced, target)

const buffer = readFileSync(target)
const sha256 = createHash('sha256').update(buffer).digest('hex')
const sumsPath = join(distDir, 'SHA256SUMS')
const kept = existsSync(sumsPath)
  ? readFileSync(sumsPath, 'utf8').split('\n').filter((line) => line.trim() && !line.includes(packed.name))
  : []
kept.push(`${sha256}  ${packed.name}`)
kept.sort()
writeFileSync(sumsPath, kept.join('\n') + '\n')

const relative = `dist/${packed.name}`
console.log(`打包方式: ${packed.command}`)
console.log(`产物: ${relative}（${statSync(target).size} 字节）`)
console.log(`SHA-256: ${sha256}`)
console.log(`校验文件: dist/SHA256SUMS`)
console.log(`本地安装: dsh plugin --profile desktop add "${join(root, relative)}"`)
