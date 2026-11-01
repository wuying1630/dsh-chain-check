// lib/fix.js —— check 查出来的断点，能自动修的就地修。
//
// 只修三种「机器能自己判断、修错了也不伤人」的：
//   1. DSH 换了端口   → 把 surfcore/config.json 的 dsh.baseUrl 改过去
//   2. 桥接没在跑     → 拉起来
//   3. SnowLuma 起了两份 → 杀掉多余的那份
//
// 不修：preset 没注册（要改 profile 的 bundles，得人看着）、配置文件语法坏了（得人看）。
// 修完不保证能通，所以调用方要再查一遍。

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'

const IS_WIN = process.platform === 'win32'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function ps(cmd) {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
      encoding: 'utf8', timeout: 20000,
    }).trim()
  } catch { return '' }
}

function runningNode(like) {
  const out = ps(
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ` +
    `Where-Object { $_.CommandLine -like '*${like}*' } | ForEach-Object { $_.ProcessId }`
  )
  return out.split(/\s+/).filter(Boolean).map(Number)
}

function kill(pid) {
  try { execFileSync('taskkill', ['/F', '/PID', String(pid)], { timeout: 10000 }) } catch { /* 已经没了 */ }
}

function start(exe, args, cwd) {
  const child = spawn(exe, args, { cwd, detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  return child.pid
}

/** 改 surfcore/config.json 里的 dsh.baseUrl。返回 'changed' | 'same' | 'missing' | 'bad-json' */
export function fixBaseUrl(cfgPath, port) {
  if (!existsSync(cfgPath)) return 'missing'
  let cfg
  try {
    let raw = readFileSync(cfgPath, 'utf8')
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1) // PowerShell 写过的文件常带 BOM
    cfg = JSON.parse(raw)
  } catch { return 'bad-json' }

  const want = `http://127.0.0.1:${port}`
  if (cfg.dsh?.baseUrl === want) return 'same'
  cfg.dsh = cfg.dsh ?? {}
  cfg.dsh.baseUrl = want
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
  return 'changed'
}

/** 桥接没在跑就拉起来。返回 'started' | 'running' | 'no-bridge' */
export function ensureBridge(bridgeJs) {
  if (!existsSync(bridgeJs)) return 'no-bridge'
  if (runningNode('bridge.js').length) return 'running'
  const nodeExe = process.execPath
  start(nodeExe, [bridgeJs], bridgeJs.replace(/[/\\]src[/\\][^/\\]+$/, ''))
  return 'started'
}

/**
 * ⚠ 别拿这个去杀。
 *
 * 2026-11-01 实测踩过：SnowLuma 正常跑着就是「两个 node 进程」（launcher + 主进程），
 * 看起来像重复，其实不是。按「留第一个、杀其余」去干，会把正在服务的那份杀掉，
 * 桥接立刻 code=1006，QQ 全断——比它想修的问题还严重。
 *
 * 留着当反面教材，不接进 --fix。真判断重复得看 3001 这个 WS 口是不是只有一个进程占着，
 * 而不是数 node 进程。
 *
 * @deprecated 不安全的判断方式，别调用。
 */
export function dedupeSnowLuma() {
  return []
}

/** 等桥接端口活过来，最多 waitMs */
export async function waitPort(port, waitMs = 20000, host = '127.0.0.1') {
  const net = await import('node:net')
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    const open = await new Promise((resolve) => {
      const s = net.connect({ port, host })
      const done = (v) => { try { s.destroy() } catch {} ; resolve(v) }
      s.setTimeout(800)
      s.once('connect', () => done(true))
      s.once('timeout', () => done(false))
      s.once('error', () => done(false))
    })
    if (open) return true
    await sleep(600)
  }
  return false
}
