# CrowWire

基于 [OpenClaw](https://openclaw.ai/) Lobster 工作流的财经新闻监控管道。自动抓取 RSS 源、去重、LLM 评分、跨源事件聚合，并推送紧急快讯和定时摘要。

## 安装 / 更新

将下面这条消息发给你的 AI 助手（OpenClaw 会话）即可：

```
请阅读 https://raw.githubusercontent.com/ChoKhoOu/CrowWire/main/README.md 并按照「AI 安装指引」帮我安装 CrowWire
```

更新时同样发送：

```
请阅读 https://raw.githubusercontent.com/ChoKhoOu/CrowWire/main/README.md 并按照「AI 更新指引」帮我更新 CrowWire
```

---

<details>
<summary>🤖 AI 安装指引（LLM 专用 — 点击展开）</summary>

### 首次安装流程

**重要原则：在所有配置完成之前，不要重启 OpenClaw 网关。**

#### 第 1 步：克隆并运行安装脚本

```bash
cd /opt  # 或用户指定的安装目录
git clone https://github.com/ChoKhoOu/CrowWire.git
cd CrowWire
./install.sh
```

安装脚本会自动完成：Docker Compose 启动 RSSHub、构建 CLI、冒烟测试、注册 Skill、启用 Lobster 插件。

等待脚本执行完毕后再进行下一步。

#### 第 2 步：配置消息投递目标

先向用户询问平台：

> 你希望将新闻推送到哪个平台？（Discord / Slack / Telegram / 其他 OpenClaw 支持的 channel）

再根据平台获取目标信息：

| 平台 | `channel` 值 | `target` 格式 | 获取方式 |
|------|-------------|--------------|---------|
| Discord | `discord` | `channel:<频道ID>` | 右键频道 → 复制频道 ID（需开启开发者模式） |
| Slack | `slack` | `channel:<频道ID>` | 频道详情 → 复制频道 ID |
| Telegram | `telegram` | `chat:<chat_id>` | 通过 Bot API 获取 chat ID |

拿到信息后，编辑安装目录下的 `crowwire.local.json`（install.sh 已自动创建）：

```bash
INSTALL_DIR="/opt/CrowWire"  # 或实际安装目录
node -e "
  const fs = require('fs');
  const p = '$INSTALL_DIR/crowwire.local.json';
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  cfg.channel = '<用户选择的平台>';
  cfg.target = '<用户提供的目标>';
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
"
```

注意：`channel` 是消息平台，`target` 是该平台上的具体投递目标。不要修改 `crowwire.lobster`——它是 Git 跟踪的工作流模板，更新时会被覆盖。

#### 第 3 步：配置 exec safe-bin 白名单

为避免 cron 执行时频繁触发 exec 审批，需将 `lobster` 配置为 OpenClaw 的受限安全二进制。

先获取 `lobster` 所在目录：

```bash
LOBSTER_BIN_DIR=$(dirname "$(which lobster)")
echo "$LOBSTER_BIN_DIR"
```

然后在 `~/.openclaw/openclaw.json` 的 `tools.exec` 下添加以下配置（与已有字段合并，不要覆盖其他配置）：

```json5
{
  "tools": {
    "exec": {
      "safeBins": ["lobster"],
      "safeBinTrustedDirs": ["<替换为上面输出的 LOBSTER_BIN_DIR>"],
      "safeBinProfiles": {
        "lobster": {
          "minPositional": 2,
          "maxPositional": 2
        }
      }
    }
  }
}
```

字段说明：
- `safeBins` — 仅允许 `lobster`，**不要**添加 `crowwire-cli`、`bash` 等其他二进制
- `safeBinTrustedDirs` — 限制只信任 `lobster` 实际安装路径
- `safeBinProfiles` — 约束 `lobster` 只能以 `lobster run <path>` 形式执行（恰好 2 个 positional 参数）

#### 第 4 步：注册定时任务

向用户询问：

> 你希望每隔几分钟检查一次新闻？（建议 2 分钟，最大 15 分钟）

先将用户选择的间隔和时区写入 `crowwire.local.json`：

```bash
INSTALL_DIR="/opt/CrowWire"  # 或实际安装目录
node -e "
  const fs = require('fs');
  const p = '$INSTALL_DIR/crowwire.local.json';
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  cfg.cron = '*/<用户选择的分钟数> * * * *';
  cfg.tz = '<用户时区>';
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
"
```

然后从 deploy config 构建 `--args-json` 并注册 cron：

```bash
INSTALL_DIR="/opt/CrowWire"  # 或实际安装目录
ARGS_JSON=$(node -e "
  const cfg = JSON.parse(require('fs').readFileSync('$INSTALL_DIR/crowwire.local.json', 'utf8'));
  console.log(JSON.stringify({ channel: cfg.channel, target: cfg.target, config: cfg.config, db: cfg.db }));
")
CRON_EXPR=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$INSTALL_DIR/crowwire.local.json','utf8')).cron)")
CRON_TZ=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$INSTALL_DIR/crowwire.local.json','utf8')).tz)")

openclaw cron add \
  --name "crowwire-news-monitor" \
  --cron "$CRON_EXPR" \
  --tz "$CRON_TZ" \
  --session isolated \
  --sessionTarget "session:crowwire-monitor" \
  --message "Run the CrowWire pipeline: lobster run $INSTALL_DIR/crowwire.lobster --args-json '$ARGS_JSON'"
```

注意：
- 间隔不应超过 15 分钟（否则会错过紧急新闻）
- `--args-json` 覆盖工作流模板中的占位符，确保使用本地配置的 channel/target

#### 第 5 步：确认配置并重启（仅在此步骤重启）

确认用户对以下配置满意：
- RSS 源列表（`feeds.yaml`）
- 消息平台和目标（`channel` + `target`）
- 定时间隔
- 紧急阈值（默认 75）

全部确认后，由于第 3 步修改了 `openclaw.json`（safe-bin 白名单），执行：

```bash
openclaw gateway restart
```

如果跳过了第 3 步（未修改 `openclaw.json`），则无需重启。

#### 第 6 步：验证

```bash
INSTALL_DIR="/opt/CrowWire"  # 或实际安装目录

# 测试抓取
crowwire-cli fetch --config $INSTALL_DIR/feeds.yaml | head -c 300

# 构建 args-json 并测试完整 pipeline
ARGS_JSON=$(node -e "
  const cfg = JSON.parse(require('fs').readFileSync('$INSTALL_DIR/crowwire.local.json', 'utf8'));
  console.log(JSON.stringify({ channel: cfg.channel, target: cfg.target, config: cfg.config, db: cfg.db }));
")
lobster run $INSTALL_DIR/crowwire.lobster --args-json "$ARGS_JSON"

# 确认 cron 已注册
openclaw cron list
```

向用户确认消息投递目标是否收到了消息。

</details>

<details>
<summary>🤖 AI 更新指引（LLM 专用 — 点击展开）</summary>

### 更新流程

**重要原则：在所有步骤完成之前，不要重启 OpenClaw 网关。**

#### 第 1 步：拉取并重新安装

```bash
cd /opt/CrowWire  # 或实际安装目录
git pull
./install.sh
```

安装脚本自动检测为升级模式：
- `crowwire.local.json` 中的 `channel`/`target` 会被保留，仅同步 `config`/`db` 路径
- `crowwire.lobster` 模板会被 git pull 覆盖，这是预期行为（运行时参数来自 local config）

#### 第 2 步：检查配置变更

确认 `crowwire.local.json` 中的 channel/target 仍正确：

```bash
cat /opt/CrowWire/crowwire.local.json
```

如果 `feeds.yaml` 有新增配置项，确认用户是否需要调整。

#### 第 3 步：仅在必要时重启

只有当 `openclaw.json` 发生变更时（如新增插件），才需要重启：

```bash
openclaw gateway restart
```

普通代码更新无需重启，下次 cron 触发时会自动使用新版本。

#### 第 4 步：验证

```bash
INSTALL_DIR="/opt/CrowWire"  # 或实际安装目录
ARGS_JSON=$(node -e "
  const cfg = JSON.parse(require('fs').readFileSync('$INSTALL_DIR/crowwire.local.json', 'utf8'));
  console.log(JSON.stringify({ channel: cfg.channel, target: cfg.target, config: cfg.config, db: cfg.db }));
")
lobster run $INSTALL_DIR/crowwire.lobster --args-json "$ARGS_JSON"
openclaw cron list
```

向用户确认更新后的 pipeline 正常运行。

</details>

---

## 架构

```
fetch → dedup → score → classify → format → send
  │        │       │        │          │       │
  │        │       │        │          │       └─ 逐条发送（自动分割长消息）
  │        │       │        │          └─ 中文 Markdown（紧急快讯 / 定时摘要）
  │        │       │        └─ 紧急分流 + 缓冲 + 跨源事件聚合
  │        │       └─ openclaw.invoke llm-task（紧急度/相关度/新颖度 + 摘要）
  │        └─ SQLite 哈希去重（identity + content）
  └─ RSSHub RSS/Atom 解析
```

**核心特性：**
- **跨源事件聚合** — 不同 RSS 源报道同一事件的新闻合并为一条，LLM 生成综合摘要
- **紧急去重** — 已发送的紧急事件，后续其他源的报道静默丢弃
- **保守合并策略** — 完全连接聚类（complete-linkage），宁可漏合不可误合
- **LLM 内容摘要** — 每条新闻生成独立摘要，不重复标题
- **Discord 友好** — 自动分割长消息，URL 抑制预览卡片

## 前置要求

- Node.js >= 22
- Docker（用于 RSSHub）
- [OpenClaw](https://github.com/openclaw/openclaw)（`npm i -g openclaw@latest && openclaw onboard --install-daemon`）
- [Lobster](https://github.com/openclaw/lobster)（安装脚本会自动安装，也可手动：`npm i -g @clawdbot/lobster@latest`）
- OpenClaw **llm-task 插件**（安装脚本会自动启用；LLM 评分和摘要依赖此插件提供的 `openclaw.invoke` shim）

## 配置

编辑 `feeds.yaml`：

```yaml
feeds:
  - name: bloomberg-markets
    url: http://localhost:1200/bloomberg/markets
    enabled: true
  - name: jin10-important
    url: http://localhost:1200/jin10/1
    enabled: true
  # 更多源参考 https://docs.rsshub.app

settings:
  urgent_threshold: 75          # 紧急度 >= 此值触发即时推送
  digest_interval_minutes: 15   # 摘要缓冲刷新间隔（分钟）
  dedup_ttl_hours: 72           # 去重记录保留时长（小时）
  content_max_chars: 500        # 每条新闻最大内容长度
  max_items_per_run: 30         # 每次运行最大抓取条数
  similarity_threshold: 0.55    # 跨源聚合相似度阈值（越高越严格）
  sent_event_ttl_hours: 24      # 已发送紧急事件记录保留时长（小时）
```

## 输出格式

**紧急快讯**（urgency ≥ 75 时立即推送）：
```
🚨 紧急快讯 🟠 高

- 美联储宣布降息25个基点，鲍威尔称通胀压力已明显缓解，市场预期6月首次降息概率升至78% _(Bloomberg)_ <https://...>
```

**定时摘要**（每 15 分钟）：
```
📰 新闻摘要 — 2026-03-17 14:00 | 共 11 条

🔥 重点关注
- 中国2月CPI同比上涨0.7%，低于市场预期的0.9%，核心CPI连续三个月回落 _(jin10-important)_ <https://...>

📋 其他资讯（8条）
- 台交所加权股价指数收高1.5% _(cls-telegraph)_ <https://...>
- 蚂蚁集团向母校上海交大捐赠1.3亿 _(cls-hot)_ <https://...>

CrowWire · 2026-03-17 14:00
```

## LLM 模型配置

CrowWire 通过 `openclaw.invoke --tool llm-task` 调用 LLM，模型和 API 由 OpenClaw 配置决定。
`install.sh` 会自动启用 llm-task 插件并添加到 agent allowlist。如需手动确认：

```bash
openclaw plugins info llm-task   # 应显示 Status: enabled
command -v openclaw.invoke       # 应返回路径
```

在 `~/.openclaw/openclaw.json` 中设置模型和 API Key：

```json5
{
  // 模型格式：provider/model
  agents: {
    defaults: {
      model: {
        primary: "anthropic/claude-haiku-4-5-20251001",  // 用 Haiku 省成本
        fallback: "openai/gpt-4.1-mini"                  // 备选模型
      }
    }
  },
  // API Key
  providers: {
    anthropic: { apiKey: "sk-ant-xxx" },
    openai: { apiKey: "sk-xxx" }
  }
}
```

支持的 provider：Anthropic、OpenAI、OpenRouter、Ollama（本地）、Google Gemini 等。

## 定时任务

运行时参数从 `crowwire.local.json` 读取，通过 `--args-json` 注入：

```bash
INSTALL_DIR="/path/to/CrowWire"
ARGS_JSON=$(node -e "
  const cfg = JSON.parse(require('fs').readFileSync('$INSTALL_DIR/crowwire.local.json', 'utf8'));
  console.log(JSON.stringify({ channel: cfg.channel, target: cfg.target, config: cfg.config, db: cfg.db }));
")

openclaw cron add \
  --name "crowwire-news-monitor" \
  --cron "*/2 * * * *" \
  --tz "Asia/Shanghai" \
  --session isolated \
  --sessionTarget "session:crowwire-monitor" \
  --message "Run the CrowWire pipeline: lobster run $INSTALL_DIR/crowwire.lobster --args-json '$ARGS_JSON'"
```

## 手动测试

```bash
# 单步测试
crowwire-cli fetch --config ./feeds.yaml | head -c 500

# 完整 pipeline（不含 LLM 评分）
crowwire-cli fetch --config ./feeds.yaml \
  | crowwire-cli dedup --db ./crowwire.db \
  | crowwire-cli classify --db ./crowwire.db \
  | crowwire-cli format --type digest

# 通过 Lobster 运行（从 deploy config 注入参数）
lobster run ./crowwire.lobster --args-json "$(node -e "
  const cfg = JSON.parse(require('fs').readFileSync('./crowwire.local.json', 'utf8'));
  console.log(JSON.stringify({ channel: cfg.channel, target: cfg.target, config: cfg.config, db: cfg.db }));
")"
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `crowwire-cli fetch --config <path>` | 抓取 RSS 源，输出 JSON |
| `crowwire-cli dedup --db <path>` | SQLite 哈希去重 |
| `crowwire-cli score` | LLM 评分（紧急度/相关度/新颖度 + 摘要） |
| `crowwire-cli classify --db <path>` | 紧急分流 + 跨源聚合 |
| `crowwire-cli format --type <urgent\|digest>` | 格式化为中文 Markdown |
| `crowwire-cli send --channel <provider> --target <dest>` | 分割长消息并逐条发送 |

### classify 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--threshold <n>` | 75 | 紧急推送阈值 |
| `--digest-interval <min>` | 15 | 摘要刷新间隔（分钟） |
| `--similarity-threshold <n>` | 0.55 | 跨源聚合相似度阈值 |
| `--sent-event-ttl <hours>` | 24 | 已发送紧急事件 TTL（小时） |

## 聚合原理

1. **哈希去重**（精确匹配）— 移除完全相同的条目
2. **TF 余弦相似度**（标题+正文，unigram+bigram 分词）— 计算两两相似度
3. **完全连接聚类**（complete-linkage）— 组内所有配对都必须超过阈值才合并
4. **同源守卫** — 同一 RSS 源的条目永不合并
5. **LLM 合并摘要** — 多源事件组生成中文综合摘要（失败时退化为标题列表）
6. **紧急去重** — 新的紧急条目与最近已发送事件做独立 2-doc 相似度比对

## 运维

```bash
# 查看定时任务
openclaw cron list

# 手动触发
openclaw cron run <jobId>

# 查看执行历史
openclaw cron runs --id <jobId>

# RSSHub 日志
docker compose logs rsshub

# 更新
git pull && ./install.sh

# 避免 cron 执行时 exec approval 抖动，将 lobster 配为 safe bin
# 在 ~/.openclaw/openclaw.json 的 tools.exec 下添加：
# {
#   "safeBins": ["lobster"],
#   "safeBinTrustedDirs": ["<lobster 所在目录>"],
#   "safeBinProfiles": {
#     "lobster": { "minPositional": 2, "maxPositional": 2 }
#   }
# }
# 注意：仅允许 lobster，不要添加 crowwire-cli、bash 等其他二进制
```

## 开发

```bash
npm install
npm run build        # TypeScript 编译
npm test             # 运行全部 75 个测试
npm run test:watch   # 监听模式
```

## 默认 RSS 源

| 来源 | 路由 | 语言 |
|------|------|------|
| Bloomberg Markets | `/bloomberg/markets` | EN |
| Bloomberg Technology | `/bloomberg/technology` | EN |
| Bloomberg Business | `/bloomberg/bbiz` | EN |
| 金十数据（重要） | `/jin10/1` | CN |
| 华尔街见闻 资讯 | `/wallstreetcn/news` | CN |
| 华尔街见闻 实时（重要） | `/wallstreetcn/live/global/2` | CN |
| 财联社 电报 | `/cls/telegraph` | CN |
| 财联社 热门 | `/cls/hot` | CN |
| 财联社 深度 | `/cls/depth` | CN |

## License

MIT
