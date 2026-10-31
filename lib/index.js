// dsh-chain-check —— 插件那一半。
//
// 干的事只有一件：把同目录的 check.mjs 跑一遍，把报告交回给会话。
// 为什么不在插件里再写一套逻辑：两套逻辑迟早对不上，而「链断了」这种事
// 最怕的就是两个工具给出两个说法。所以插件和命令行共用同一个脚本。
//
// 不 import @deepseek-ai/* —— 那玩意只挂在 app.asar 里，link: 装的时候
// 解析不到，插件会整个起不来。工具对象用普通对象交给 ctx.tools.register。

import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const name = 'chain-check'
export const inject = ['tools']

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const CLI = join(ROOT, 'check.mjs')

function runCli(wantJson) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...(wantJson ? ['--json'] : [])],
      { cwd: ROOT, timeout: 90_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          code: typeof error?.code === 'number' ? error.code : (error ? 1 : 0),
          out: String(stdout || ''),
          err: String(stderr || ''),
        })
      },
    )
  })
}

export function apply(ctx) {
  const tool = {
    name: 'chain_check',
    description:
      '查 DSH → 桥接 → SnowLuma/OneBot → QQ 这条链现在断在哪一段。链子断的时候表面上都一样——它不回话——实际可能是桥接没起、preset 没注册、DSH 换了端口、或者协议端掉线，四种病一个症状。这个工具逐段探一遍，每项只说三样：通没通、是什么、怎么修。只读：不启动进程、不改配置、不写文件。'
      + '参数 json=true 时返回原始 JSON（含每项 ok/detail/fix，退出码含义：0 全通 / 1 有不通）。',
    parameters: {
      type: 'object',
      properties: {
        json: {
          type: 'boolean',
          description: '返回原始 JSON 而不是人话报告（给程序用）。默认 false。',
        },
      },
      required: [],
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: 'generic',
      title: 'chain_check',
      kind: 'read',
      rawInput: args || {},
    }),
    async execute(args) {
      const r = await runCli(Boolean(args && args.json))
      const body = (r.out || '').trim()
      const err = (r.err || '').trim()
      const ok = r.code === 0
      let message = body
      if (!message) message = err || '脚本没有输出——先确认同目录的 check.mjs 还在。'
      if (!ok && err && !body) message = err
      return { ok, exitCode: r.code, message }
    },
  }

  try {
    ctx.tools.register(tool)
  } catch (error) {
    // 同名冲突或者宿主接口变了：大声降级，别把整个插件拖垮
    console.error(`[dsh-chain-check] chain_check 注册失败：${error?.message || error}`)
  }
}
