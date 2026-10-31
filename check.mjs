#!/usr/bin/env node
// dsh-chain-check —— 一条命令看清 DSH → 桥接 → SnowLuma → QQ 这条链断在哪一段。
//
// 为什么有这个东西：链子断了，表面上都一个样——它不回话。
// 实际今天断过三种：桥接挂了、preset 没注册、DSH 换了端口。每种现象一样，修法完全不同。
//
// 用法：
//   node check.mjs              # 查一遍
//   node check.mjs --json       # 机器可读
//
// 零依赖。路径不写死：先看环境变量，再看同目录 chain.config.json，最后才用常见位置，
// 用了默认位置会打印出来，别让人以为是自己配的。

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, platform } from 'node:os'
import { execSync } from 'node:child_process'
import net from 'node:net'

const HERE = dirname(fileURLToPath(import.meta.url))
const CFG_PATH = join(HERE, 'chain.config.json')
const IS_WIN = platform() === 'win32'
const JSON_OUT = process.argv.includes('--json')
const WANT_HELP = process.argv.includes('--help') || process.argv.includes('-h')

// ── 换个 Node 版本就跑不动的话，得先说人话，别甩一串 SyntaxError ─────────────
const NODE_MAJOR = Number(process.versions.node.split('.')[0])
if (NODE_MAJOR < 18) {
  console.error(`这个脚本要 Node 18 以上（现在 ${process.versions.node}）。`)
  console.error('18 以下没有内置 fetch / AbortSignal.timeout，跑起来会报奇怪的错。')
  process.exit(2)
}

if (WANT_HELP) {
  console.log(`
dsh-chain-check —— 看 DSH → 桥接 → SnowLuma → QQ 这条链断在哪一段

  node check.mjs            人看的
  node check.mjs --json     机器看的（退出码 0 = 全通，1 = 有不通的）
  node check.mjs --help     这段

可选配置：同目录 chain.config.json，或者环境变量
  DSH_HOME / SURFCORE_HOME / SNOWLUMA_HOME
详见 README。
`)
  process.exit(0)
}

// ── 路径解析：env > 配置文件 > 猜 ────────────────────────────────────────
const guesses = []
function resolvePath(envKey, cfgKey, candidates, what) {
  const fromEnv = process.env[envKey]
  if (fromEnv) return { path: fromEnv, from: `环境变量 ${envKey}` }
  const cfg = loadCfg()
  if (cfg[cfgKey]) return { path: cfg[cfgKey], from: `chain.config.json 的 ${cfgKey}` }
  for (const c of candidates) {
    if (c && existsSync(c)) { guesses.push(`${what} 用了猜的路径：${c}`); return { path: c, from: '猜的（建议写进 chain.config.json）' } }
  }
  return { path: '', from: '没找到' }
}

let _cfg = null
function loadCfg() {
  if (_cfg) return _cfg
  try { _cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8')) } catch { _cfg = {} }
  return _cfg
}

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const SURF = resolvePath('SURFCORE_HOME', 'surfcoreDir', ['D:/surfcore', join(homedir(), 'surfcore')], 'surfcore')
const SNOW = resolvePath('SNOWLUMA_HOME', 'snowlumaDir', ['D:/SnowLuma', join(homedir(), 'SnowLuma')], 'SnowLuma')

// ── 小工具 ───────────────────────────────────────────────────────────────
function sh(cmd, timeout = 6000) {
  try {
    return String(execSync(cmd, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }))
  } catch (e) {
    return String(e?.stdout || '')
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function tcpOpen(port, host = '127.0.0.1', wait = 1200) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host })
    let done = false
    const fin = (ok) => { if (!done) { done = true; s.destroy(); resolve(ok) } }
    s.setTimeout(wait)
    s.once('connect', () => fin(true))
    s.once('timeout', () => fin(false))
    s.once('error', () => fin(false))
  })
}

async function httpJson(url, body = {}, token = '', wait = 4000) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(wait),
    })
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

// ── 检查项 ───────────────────────────────────────────────────────────────
const results = []
const add = (key, name, ok, detail, fix = '') => results.push({ key, name, ok, detail, fix })

// 1) DSH 进程 + 端口
async function checkDSH() {
  let pids = []
  // 进程名因安装方式不同而不同：官方桌面端叫 "DeepSeek Harness"，也有人用 dsh / electron。
  // 默认按关键字模糊匹配，chain.config.json 里写 processNames 可以覆盖。
  const names = loadCfg().processNames || (IS_WIN ? ['DeepSeek', 'dsh'] : ['dsh', 'electron'])
  if (IS_WIN) {
    const cond = names.map((n) => `$_.ProcessName -like '*${n}*'`).join(' -or ')
    const out = sh(`powershell -NoProfile -Command "(Get-Process | Where-Object { ${cond} }).Id"`)
    pids = out.split(/\s+/).filter(Boolean).map(Number).filter(Boolean)
  } else {
    const out = sh("pgrep -f 'dsh' || true")
    pids = out.split(/\s+/).filter(Boolean).map(Number).filter(Boolean)
  }
  if (!pids.length) {
    add('dsh', 'DSH 进程', false, '没找到 DSH 进程（名字里带 DeepSeek 或 dsh 的都没有）', '先把 DSH 打开；如果它是别的名字，改 check.mjs 里的匹配，或者在本文件顶部加一条说明')
    return null
  }
  // 找它监听的端口。两条路依次试，都不行就直说查不到——别装作查到了。
  // ⚠ 实测坑：受限环境（沙箱、非交互会话）里 Get-NetTCPConnection / netstat
  //   只能看到寥寥几个监听口，DSH 的端口根本不在里头。那不是链子断了，是探针看不见。
  let ports = []
  const idSet = new Set(pids)
  if (IS_WIN) {
    const attempts = [
      `powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [string]$_.LocalPort + '|' + [string]$_.OwningProcess }"`,
      'netstat -ano',
    ]
    for (const cmd of attempts) {
      const out = sh(cmd, 9000)
      for (const raw of out.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line) continue
        if (line.includes('|')) {
          const [lp, pid] = line.split('|').map(Number)
          if (lp > 1024 && lp < 65536 && idSet.has(pid)) ports.push(lp)
        } else {
          const m = line.match(/\s(\d{2,5})\s+(\d+)\s*$/)
          if (m && Number(m[1]) > 1024 && idSet.has(Number(m[2]))) ports.push(Number(m[1]))
        }
      }
      if (ports.length) break
    }
  } else {
    const out = sh(`ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null`, 6000)
    for (const line of out.split('\n')) {
      const m = line.match(/[:.](\d{2,5})\s/)
      const p = line.match(/pid=(\d+)/)
      if (m && p && idSet.has(Number(p[1]))) ports.push(Number(m[1]))
    }
  }
  ports = [...new Set(ports)]
  add('dsh', 'DSH 进程', true,
    ports.length
      ? `${pids.length} 个进程，监听端口 ${ports.join('、')}`
      : `${pids.length} 个进程，查不到它的监听端口（探针看不见，不一定是没起）`,
    '')
  return ports
}

// 2) 桥接
async function checkBridge() {
  // 没有 surfcore 桥接的栈（比如纯 NapCat/AstrBot）不该被判成故障。
  if (loadCfg().skipSurfcore) { add('bridge', '桥接（surfcore）', true, '已按配置跳过（这个栈里没有 surfcore 桥接）', ''); return true }
  const cfgPath = join(SURF.path || '', 'config.json')
  let port = 3100
  if (existsSync(cfgPath)) {
    try {
      const c = JSON.parse(readFileSync(cfgPath, 'utf8'))
      port = Number(c.serve?.port || c.server?.port || c.port || port)
    } catch { /* ignore */ }
  }
  const ok = await tcpOpen(port)
  add('bridge', '桥接（surfcore）', ok,
    ok ? `127.0.0.1:${port} 在听（路径来路：${SURF.from}）` : `127.0.0.1:${port} 连不上（路径来路：${SURF.from}）`,
    ok ? '' : '起它：D:\\surfcore\\start-with-dsh-port.bat（它会先把 DSH 端口同步进 config，再进循环）')
  return ok
}

// 3) SnowLuma / OneBot / QQ 在线
async function checkOneBot() {
  // AstrBot 默认走 WebSocket，不一定开 HTTP 接口。没开就把这项跳掉，别报成故障。
  if (loadCfg().skipOneBot) { add('onebot', 'OneBot', true, '已按配置跳过（协议端没开 HTTP 接口）', ''); return }
  // 别人的机器上不一定有 SnowLuma 目录，甚至不用 SnowLuma（NapCat + 任意 OneBot 实现都行）。
  // 所以先看配置里有没有直接给地址：给了就用它，别硬凑目录结构。
  const c0 = loadCfg()
  if (c0.onebotUrl) {
    const url = String(c0.onebotUrl).replace(/\/$/, '') + '/get_login_info'
    const r = await httpJson(url, {}, c0.onebotToken || '')
    const j = r.json
    if (j?.status === 'ok' && j?.data?.user_id) {
      add('onebot', 'OneBot', true, `在线：${j.data.nickname || ''}（${j.data.user_id}），用的是 chain.config.json 的 onebotUrl`, '')
    } else {
      add('onebot', 'OneBot', false, `onebotUrl 连不通或没登录：${j?.wording || r.error || r.status}`,
        '地址或令牌不对；也可能协议端没起、QQ 掉线')
    }
    return
  }
  const cfgDir = SNOW.path ? join(SNOW.path, 'config') : ''
  const files = cfgDir && existsSync(cfgDir)
    ? readdirSafe(cfgDir).filter((f) => f.startsWith('onebot_') && f.endsWith('.json')).map((f) => join(cfgDir, f))
    : []
  if (!files.length) {
    add('onebot', 'SnowLuma / OneBot', false,
      `没找到 onebot_*.json（目录：${cfgDir || '没定位到 SnowLuma'}）`,
      '设环境变量 SNOWLUMA_HOME 指到 SnowLuma 目录，或者在 chain.config.json 里写 snowlumaDir')
    return
  }
  // ⚠ 一个号一份文件。按文件名排序取第一个是本机实测踩过的坑：
  //   机器上同时有 onebot_2923512830.json（主人号）和 onebot_3574232603.json（机器人号），
  //   取第一个就拿到错的 token，报 unauthorized，看起来像"QQ 掉线了"。所以这里全试一遍。
  const base = (f) => f.split(/[\\/]/).pop()
  const tried = []
  for (const f of files) {
    let host = '127.0.0.1', port = 3000, token = ''
    try {
      const c = JSON.parse(readFileSync(f, 'utf8'))
      const s = c?.networks?.httpServers?.[0]
      if (s) { host = s.host || host; port = Number(s.port) || port; token = s.accessToken || '' }
    } catch { tried.push(`${base(f)}：读不动`); continue }
    const up = await tcpOpen(port, host)
    if (!up) { tried.push(`${base(f)}：${host}:${port} 连不上`); continue }
    const r = await httpJson(`http://${host}:${port}/get_login_info`, {}, token)
    const j = r.json
    if (j?.status === 'ok' && j?.data?.user_id) {
      add('onebot', 'SnowLuma / OneBot', true,
        `在线：${j.data.nickname || ''}（${j.data.user_id}），用的是 ${base(f)}`, '')
      return
    }
    tried.push(`${base(f)}：${j?.wording || j?.retcode || r.error || r.status}`)
  }
  add('onebot', 'SnowLuma / OneBot', false,
    `每份 onebot_*.json 都试过了，没一个能登录 → ${tried.join('；')}`,
    '先怀疑拿错 token（一个号一份文件），其次才是 QQ 掉线；再看 runtime.json 的 hookAutoLoad 是不是 true')
}

function readdirSafe(d) {
  try { return readdirSync(d) } catch { return [] }
}

// 4) preset 注册
function checkPreset() {
  if (loadCfg().skipSurfcore) { add('preset', 'preset 注册', true, '已按配置跳过（同上）', ''); return }
  const want = loadCfg().agentPreset || 'qq-chat-v2'
  const profRoot = join(DSH_HOME, 'profiles')
  if (!existsSync(profRoot)) {
    add('preset', `preset「${want}」`, false, `找不到 profile 目录：${profRoot}`, '设一下环境变量 DSH_HOME 指到 DSH 的数据目录')
    return
  }
  const profiles = readdirSafe(profRoot).filter((p) => existsSync(join(profRoot, p, 'package.json')))
  if (!profiles.length) {
    add('preset', `preset「${want}」`, false, `${profRoot} 下面没找到带 package.json 的 profile`, '先用 DSH 正常起一次，让它把 profile 建出来')
    return
  }
  const found = []
  for (const p of profiles) {
    const pkg = join(profRoot, p, 'package.json')
    const patch = join(profRoot, p, 'cordis.patch.yml')
    let viaBundle = false, viaPatch = false
    try {
      const j = JSON.parse(readFileSync(pkg, 'utf8'))
      viaBundle = (j?.dsh?.profile?.bundles || []).some((b) => String(b).includes('surfcore'))
    } catch { /* ignore */ }
    try { viaPatch = readFileSync(patch, 'utf8').includes(`id: ${want}`) } catch { /* ignore */ }
    if (viaBundle || viaPatch) found.push(`${p}${viaBundle ? '（bundles 里有 surfcore）' : ''}${viaPatch ? '（patch 里有 ' + want + '）' : ''}`)
  }
  if (found.length) add('preset', `preset「${want}」`, true, found.join('；'), '')
  else add('preset', `preset「${want}」`, false,
    `profile ${profiles.join('、')} 里都没有它——桥接会拒绝建会话，QQ 消息一条都进不来`,
    `把 "surfcore" 加回 profile 的 dsh.profile.bundles，重启 DSH。注意：DSH 每次重启都会换端口`)
}

// 桥接日志会滚动：当前 bridge.log 是被轮转过的那份，.1 才是稍早的。
// 只读当前那份，安静一会儿就会出现"从来没发过"的误报。
function readBridgeLogs() {
  const out = []
  for (const name of ['bridge.log', 'bridge.log.1']) {
    const p = join(SURF.path || '', 'state', name)
    if (!existsSync(p)) continue
    try { out.push({ path: p, text: readFileSync(p, 'utf8') }) } catch { /* ignore */ }
  }
  return out
}

// 5) 最近的唤醒失败
function checkRecentFailures() {
  if (loadCfg().skipSurfcore) { add('failed', '最近的唤醒失败', true, '已按配置跳过（没有桥接日志可看）', ''); return }
  const logs = readBridgeLogs()
  if (!logs.length) {
    add('failed', '最近的唤醒失败', true, `没有桥接日志可查（${join(SURF.path || '', 'state')}）——桥接没跑过，或者路径不对`, '')
    return
  }
  const lines = logs.flatMap((l) => l.text.split('\n')).slice(-400)
  // ⚠「忽略未授权会话」不是故障：reserved2 模式本来就忽略没授权的群，算进来会刷出几百条红字。
  // ⚠ 也别拿裸的 "401" 当关键词：日志里的 QQ 号（比如 1584763401）里头就带这三个数字。
  const bad = lines.filter((l) => /唤醒投递失败|不在 DSH 可用清单|code=1006|Unauthorized|connection refused|WinError 10061/i.test(l))
  const last = bad[bad.length - 1] || ''
  add('failed', '最近的唤醒失败', bad.length === 0,
    bad.length ? `最近 400 行里有 ${bad.length} 条，最后一条：${last.trim().slice(0, 120)}` : '最近 400 行里没有唤醒失败',
    bad.length ? '按最后一条对症：preset 相关 → 第 4 项；code=1006 / 10061 → 桥接和 SnowLuma 之间断着' : '')
}

// 6) 最后一条消息
function checkLastMessage() {
  if (loadCfg().skipSurfcore) { add('lastmsg', '最后一条消息', true, '已按配置跳过（没有桥接日志可看）', ''); return }
  const logs = readBridgeLogs()
  if (!logs.length) { add('lastmsg', '最后一条消息', true, '无日志可查', ''); return }
  const all = logs.flatMap((l) => l.text.split('\n'))
  const sent = [...all].reverse().find((l) => /\[send\]|成功 \d+\/\d+ 条/.test(l))
  const woke = [...all].reverse().find((l) => /唤醒 (private|group)/.test(l))
  add('lastmsg', '最后一条消息', Boolean(sent || woke),
    `发出：${sent ? sent.trim().slice(0, 110) : '日志里没有（含 bridge.log.1）'}\n            唤醒：${woke ? woke.trim().slice(0, 110) : '日志里没有（含 bridge.log.1）'}`,
    (sent || woke) ? '' : '桥接日志里连发送记录都没有——它可能根本没跑过（先看第 2 项）')
}

// ── 跑 ───────────────────────────────────────────────────────────────────
const t0 = Date.now()
const ports = await checkDSH()
await checkBridge()
await checkOneBot()
checkPreset()
checkRecentFailures()
checkLastMessage()
await sleep(30)

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: results.every((r) => r.ok), results, guesses, ms: Date.now() - t0 }, null, 2))
} else {
  const pad = (s, n) => { let w = 0; for (const ch of s) w += /[\u4e00-\u9fa5]/.test(ch) ? 2 : 1; return s + ' '.repeat(Math.max(0, n - w)) }
  if (IS_WIN) {
    const cp = (sh('chcp.com') || '').match(/(\d{3,5})/)
    if (cp && cp[1] !== '65001') console.log(`\n  ⚠ 控制台代码页是 ${cp[1]}，中文可能乱码。先跑一句：chcp 65001（或者用 Windows Terminal）`)
  }
  console.log('')
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'}  ${pad(r.name, 22)} ${r.detail}`)
    if (!r.ok && r.fix) console.log(`     → ${r.fix}`)
  }
  if (guesses.length) {
    console.log('')
    for (const g of guesses) console.log(`  · ${g}`)
  }
  const bad = results.filter((r) => !r.ok).length
  console.log('')
  console.log(bad ? `  ${bad} 项不通。按 ✗ 后面的 → 一条条弄。` : '  全通。')
  console.log('')
}

process.exit(results.every((r) => r.ok) ? 0 : 1)
