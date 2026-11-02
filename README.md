# dsh-chain-check

一条命令看清 **DSH → 桥接 → SnowLuma → QQ** 这条链断在哪一段。

```
$ node check.mjs

  ✓  DSH 进程             8 个进程
  ✓  桥接（surfcore）      127.0.0.1:3100 在听
  ✓  SnowLuma / OneBot    在线：阿砚（3574232603）
  ✓  preset「qq-chat-v2」  desktop（bundles 里有 surfcore）
  ✓  最近的唤醒失败        最近 400 行里没有唤醒失败
  ✓  最后一条消息          发出：17:10:32 … 成功 1/1 条

  全通。
```

---

## 两种用法

**一、当插件装**（会话里多一个 `chain_check` 工具，AI 自己就能查）：

```bash
dsh plugin --profile <你的 profile> add github:wuying1630/dsh-chain-check
```

装上只做一件事：注册 `chain_check`。不常驻、不改你的配置、不写文件。

**二、不装插件直接跑**——链已经断了的时候更推荐这条，因为那时候装插件本身可能就是断的那一环：

```bash
node check.mjs
```

两条路跑的是**同一个脚本**，不会出现两个版本说法不一致。

**三、查完顺手修**——只有两种情况**能**安全自动修：

```bash
node check.mjs --fix
```

- **DSH 换了端口**：`surfcore/config.json` 的 `dsh.baseUrl` 还写着旧端口 → 改成当前探到的那个
- **桥接没在跑**：就是没在跑而已 → 拉起来

只修这两样，因为只有它们的「对」是机器能自己判断的。修完会打印修了什么，**要再跑一次不带 `--fix` 的确认**。

**故意不修的**：preset 没注册（得改 profile 的 bundles，改错了 DSH 起不来）、配置文件语法坏了（得人看）。

> 反面教材写在 `lib/fix.js` 注释里：别按「node 进程数 > 1」判断 SnowLuma 重复。正常跑着就是两个进程（launcher + 主进程），照这个杀会把正在服务的那份干掉，桥接立刻 code=1006，QQ 全断——比它想修的问题还严重。踩过一次。

## 它解决的是哪个疼

链子断了，表面上都长一个样：**它不回话。**

实际这一周断过四种，现象一模一样，修法完全不同：

| 真正断在哪 | 现象 | 人第一反应 | 真实原因 |
|---|---|---|---|
| 桥接进程没了 | 不回话 | 「它不理我了」 | 3100 没人监听 |
| DSH 重启后 preset 没注册 | 不回话 | 「它生气了？」 | 桥接拒绝建会话，日志刷 `不在 DSH 可用清单` |
| DSH 换了端口 | 不回话 | 「是不是封号了」 | 桥接还对着旧端口说话 |
| 拿错令牌文件 | 不回话 | 「QQ 掉线了吧」 | 机器上两份 `onebot_*.json`，读到了主人号那份 |

人只能靠猜。这个工具把「猜」换成「看」。

## 它不是什么（先说清楚，省得误会）

- **装不装都行。** 装了多一个工具；不装也能 `node check.mjs` 直接跑，不用重启 DSH。
  > 为什么不打包成插件：链路断的时候，装插件这件事本身可能就是断的那一环。一个救急工具，不能要求你先修好它才能跑。
- **不是监控。** 跑一次看一次，不常驻、不写守护进程、不发通知。
- **默认只读，有一个明确的例外。** 平时只读日志、只读配置、只探端口，不启动、不杀进程、不写配置；装成插件后注册的 `chain_check` 工具本身永远是只读的。唯一的例外是 CLI 的 `--fix`（见上文「查完顺手修」）：它只做两件能安全自动修的事——把 `surfcore/config.json` 的 `dsh.baseUrl` 对齐到当前端口、把没在跑的桥接拉起来。

## 快速开始

```bash
# 1. 有 Node 18+ 就行，不用 npm install
node --version

# 2. 跑
node check.mjs

# 3. 看 ✗ 后面那行 → 它会直接告诉你怎么修
```

Windows 上中文如果乱码，先 `chcp 65001`，或者用 Windows Terminal。

### 装到别人机器上要对的三件事

1. **Node 18 以上**。脚本用了内置 `fetch` 和 `AbortSignal.timeout`；版本不够会直接说一句人话退出，不甩 SyntaxError。
2. **别在 GBK 控制台里看**。脚本会自己检测代码页并提示。
3. **它假定的是这套栈**：DSH + surfcore 桥接 + 一个 OneBot 实现。
   - 用 NapCat / AstrBot 也行：在 `chain.config.json` 里直接给 `onebotUrl`、`onebotToken`，就不需要 SnowLuma 的目录结构。
   - 没有 surfcore 桥接的话，第 2、4 项会报不通，第 1、3 项照样有用。

**只在一台 Windows 上实测过。** Linux / macOS 的分支（`pgrep` / `ss`）写是写了，没跑过——别当成已验证的东西。

## 用在 NapCat / AstrBot 上

**先说清楚：这个工具不是只能配 SnowLuma。** 第 3 项查的是标准 OneBot 接口 `get_login_info`，谁实现都行。但这两套栈断的东西不一样，别指望它全查。

### NapCat（最省事）

1. 在 NapCat 的 WebUI 里开 **HTTP 服务器**（网络配置 → HTTP 服务器，比如 `127.0.0.1:3000`），设一个 access token。
2. 在 `chain.config.json` 里指过去：

```json
{
  "onebotUrl": "http://127.0.0.1:3000",
  "onebotToken": "你设的那个 token",
  "skipSurfcore": true
}
```

3. 跑 `node check.mjs`。第 3 项会直接告诉你 QQ 在不在线、登的是哪个号。

`skipSurfcore: true` 是必须的——你没有 surfcore 桥接，不写的话第 2、4、5、6 项会报不通，那是**误报**，会把人带沟里。

**NapCat 这条链它查得到什么：**
- ✓ 协议端进程/端口通不通
- ✓ QQ 掉没掉线（最常断的一环）
- ✓ token 对不对
- ✗ 消息为什么没送到 AI（那是 DSH 那一侧，跟协议端无关）
- ✗ 群权限 / 被禁言 / 被踢（平台侧，本机看不出）

### AstrBot

AstrBot 自带 QQ 适配（aiocqhttp），**默认走 WebSocket，通常没有 HTTP 接口**。所以：

- **如果开了 HTTP**：同 NapCat，填 `onebotUrl` + `onebotToken` + `skipSurfcore: true`。
- **如果没开 HTTP**：把 `skipOneBot` 也设成 `true`。这项就跳过，不再假装能验。

```json
{
  "skipOneBot": true,
  "skipSurfcore": true
}
```

这时候它还剩什么用？**第 1 项**（DSH 进程在不在、端口有没有在听）。别的都查不了——**工具会明确写「已按配置跳过」，不会给你一个假的 ✓。**

### 一张表：你的栈能查哪几项

| 你的栈 | 1 DSH | 2 桥接 | 3 QQ 在线 | 4 preset | 5 唤醒失败 | 6 最后一条消息 |
|---|---|---|---|---|---|---|
| DSH + surfcore + SnowLuma | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| DSH + surfcore + NapCat | ✓ | ✓ | ✓（填 onebotUrl） | ✓ | ✓ | ✓ |
| DSH + AstrBot（无 HTTP） | ✓ | skip | skip | skip | skip | skip |
| 纯 NapCat，没有 DSH | — | skip | ✓ | skip | skip | skip |

**没有 DSH 的话，它就不是给你用的**——第 1 项查的就是 DSH。别装错了。

## 六项检查

| # | 检查 | 抓什么 |
|---|---|---|
| 1 | DSH 进程 | 进程在不在，监听哪些端口 |
| 2 | 桥接 | 端口通不通 |
| 3 | SnowLuma / OneBot | 端口通不通，QQ 在不在线（每份 `onebot_*.json` 都试） |
| 4 | preset 注册 | profile 的 `dsh.profile.bundles` 里有没有 `surfcore` |
| 5 | 最近的唤醒失败 | 最近 400 行日志里有没有硬故障 |
| 6 | 最后一条消息 | 最近一次发出 / 唤醒是什么时候 |

每项只给三样：**通没通 / 一句人话说清是什么 / 怎么修**。

退出码：全通 `0`，有不通 `1`。接进别的脚本很方便：

```bash
node check.mjs --json | jq '.results[] | select(.ok==false)'
```

## 配置

全部可省。省了就走「环境变量 → `chain.config.json` → 常见位置猜」；**用猜的会打印出来**，不让人误以为是自己配的。

```json
{
  "surfcoreDir": "D:/surfcore",
  "snowlumaDir": "D:/SnowLuma",
  "agentPreset": "qq-chat-v2",
  "processNames": ["DeepSeek", "dsh"],
  "onebotUrl": "http://127.0.0.1:3000",
  "onebotToken": "（可选）",
  "skipOneBot": false,
  "skipSurfcore": false
}
```

环境变量：`DSH_HOME` / `SURFCORE_HOME` / `SNOWLUMA_HOME`。

---

# 给大肥鱼（AI 鱼）看的注意须知

你好。你多半是被主人一句「你跑一下那个检查」叫来的。几条实话：

1. **这个脚本的输出是给人看的，不是给你「再加工」的。**
   主人要看的是「断在哪一段」。你可以复述，但别改写判定、别把 ✗ 说成「可能有点小问题」。

2. **看见 ✗，先把 `→` 那行原样交给主人，再动手。**
   里面有几步是要人点头的（重启 DSH、改 profile 配置）。**不要自己改 `package.json` 的 bundles 然后不吭声**——DSH 每次重启都会换端口，你改完不重起桥接，下一条消息照样丢。

3. **不要为了让它变绿而改标准。**
   这个脚本故意把「探针看不见端口」判成 ✓（说明里写清楚），也故意不算「忽略未授权会话」。
   如果你发现某项一直红、你想把它调成绿——停。那是真断了。

4. **别拿它当日常心跳。** 它是出问题时用的扳手，不是监护仪。每 30 分钟跑一次既没用又吵。

5. **它的日志关键词是从真实故障里长出来的**，包括：
   - 裸的 `401` 不能当关键词（QQ 号 `1584763401` 里就有这三个数字）
   - 日志会滚动，必须连 `bridge.log.1` 一起读
   
   你要是想加新关键词，先问自己：这个字符串会不会在无关的行里出现。

---

# 给真人看的注意须知

**什么时候用它：**
- 明明收到消息了，它却像没看见 → 第 5、6 项
- 改完配置、装完插件之后它不说话了 → 第 4 项
- 电脑重启过 → 第 2 项 + DSH 换端口那条

**它判不了的事（别指望）：**
- 模型本身抽风、答非所问 → 链路是通的，这是内容问题
- 群权限、被禁言、被踢 → 那是平台侧，本机看不出
- 网络慢、偶尔延迟 → 单次快照看不出趋势

**安全：**
- 只读。不写配置、不启动进程、不杀进程。
- 不会打印任何令牌，只打印「用的是哪个文件」。

**已知限制（写在明处）：**
- **端口探测可能看不见。** 沙箱或非交互会话里，`Get-NetTCPConnection` / `netstat` 只能看到寥寥几个监听口。这不是链子断了，是探针看不见——所以那一项不判失败。
- **日志会滚动。** 只读 `bridge.log` 和 `bridge.log.1`，再往前查不到。
- **Windows 优先。** Linux / macOS 分支未实测。

---

## 授权

MIT。随便改，出问题自己扛——它只读，不背锅。

## 它是谁写的

一条会被自己写的工具查错的鱼，在 Windows 上，2026 年 10 月。

第一版写完第二天就被它自己的检查抓出一个 bug（拿错令牌文件报 `unauthorized`，看着像 QQ 掉线）。
