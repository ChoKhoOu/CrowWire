# CrowWire

自部署的财经新闻监控 daemon。自动抓取 RSS 源、去重、LLM 评分、LLM 辅助去重、跨源事件聚合，通过双优先级队列推送紧急快讯和定时摘要到 Discord。

`docker compose up` 一键启动，无需任何外部平台依赖。

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/ChoKhoOu/CrowWire.git
cd CrowWire
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填写必填项：

```env
# LLM 配置（OpenAI 兼容 API）
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-your-key-here
LLM_MODEL=gpt-4o-mini

# Discord Bot
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_URGENT_CHANNEL_ID=123456789
DISCORD_DIGEST_CHANNEL_ID=987654321
```

> **Discord Bot 设置**：在 [Discord Developer Portal](https://discord.com/developers/applications) 创建 Application → Bot，复制 Token。邀请 Bot 到你的服务器，确保 Bot 有目标频道的发送消息权限。频道 ID 通过右键频道 → 复制频道 ID 获取（需开启开发者模式）。

### 3. 配置推送目标（可选）

编辑 `targets.yaml` 自定义推送路由：

```yaml
targets:
  - name: alerts
    type: discord
    channel_id: "${DISCORD_URGENT_CHANNEL_ID}"
    queues: [urgent]
  - name: digest
    type: discord
    channel_id: "${DISCORD_DIGEST_CHANNEL_ID}"
    queues: [normal]
```

`${VAR}` 语法会自动从 `.env` 读取对应环境变量。

### 4. 启动

```bash
docker compose up -d
```

完成。CrowWire daemon + RSSHub 将自动启动并开始监控。

### 5. 查看日志

```bash
docker compose logs -f crowwire
```

---

<details>
<summary>🤖 AI 安装指引（LLM 专用 — 点击展开）</summary>

### LLM Agent 安装流程

适用于 Claude Code、Cursor 等 AI 编程助手自动安装 CrowWire。

#### 步骤

1. 克隆仓库到目标目录：
```bash
git clone https://github.com/ChoKhoOu/CrowWire.git
cd CrowWire
```

2. 复制环境变量模板：
```bash
cp .env.example .env
```

3. 向用户询问以下信息并写入 `.env`：
   - **LLM API**：`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`（支持任何 OpenAI 兼容端点）
   - **Discord Bot Token**：`DISCORD_BOT_TOKEN`
   - **Discord 频道 ID**：`DISCORD_URGENT_CHANNEL_ID`（紧急快讯频道）、`DISCORD_DIGEST_CHANNEL_ID`（定时摘要频道）

4. 可选：编辑 `feeds.yaml` 自定义 RSS 源，编辑 `targets.yaml` 自定义推送路由。

5. 启动服务：
```bash
docker compose up -d
```

6. 验证：
```bash
docker compose logs crowwire | head -20
# 应看到 "[daemon] CrowWire daemon started" 和 feed/target 数量信息
```

#### 更新

```bash
cd /path/to/CrowWire
git pull
docker compose build crowwire
docker compose up -d
```

`.env`、`feeds.yaml`、`targets.yaml` 在更新时不会被覆盖。

</details>

---

## 架构

```
┌─────────────────────────────────────────────────┐
│                  CrowWire Daemon                │
│                                                 │
│  ┌──────────┐    ┌──────────────────────────┐  │
│  │ RSS Timer │───>│ fetch → dedup → score    │  │
│  │ (20s)     │    │ → llm-dedup → classify   │  │
│  └──────────┘    └──────┬───────────────────┘  │
│                         │                       │
│              ┌──────────┴──────────┐            │
│              ▼                     ▼            │
│  ┌───────────────────┐ ┌───────────────────┐   │
│  │  Urgent Queue     │ │  Normal Queue     │   │
│  │  flush: 10s/count │ │  flush: 15min     │   │
│  └────────┬──────────┘ └────────┬──────────┘   │
│           │                     │               │
│           ▼                     ▼               │
│  ┌──────────────────────────────────────────┐  │
│  │  format → push targets (Discord Bot API) │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

**核心特性：**
- **双优先级队列** — 紧急消息每 10s 或达数量阈值立即推送；普通消息每 15min 汇总推送
- **LLM 评分** — 每条新闻评估紧急度/相关性/新颖度（0-100）并生成中文摘要
- **LLM 辅助去重** — 相似度模糊区间的新闻由 LLM 判断是否同一事件
- **跨源事件聚合** — 不同 RSS 源报道同一事件合并为一条，LLM 生成综合摘要
- **紧急去重** — 已发送的紧急事件不会重复推送
- **保守合并** — 完全连接聚类（complete-linkage），宁可漏合不可误合
- **崩溃恢复** — 紧急队列持久化到 SQLite，daemon 重启后自动恢复
- **零外部依赖** — 不依赖任何特定平台，通过 OpenAI 兼容 API 调用 LLM

## 配置

### 环境变量（`.env`）

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `LLM_BASE_URL` | ✅ | — | OpenAI 兼容 API 端点 |
| `LLM_API_KEY` | ✅ | — | API Key |
| `LLM_MODEL` | ✅ | — | 模型名称（如 `gpt-4o-mini`、`deepseek-chat`） |
| `DISCORD_BOT_TOKEN` | ✅ | — | Discord Bot Token |
| `DISCORD_URGENT_CHANNEL_ID` | ✅ | — | 紧急快讯频道 ID |
| `DISCORD_DIGEST_CHANNEL_ID` | ✅ | — | 定时摘要频道 ID |
| `FETCH_INTERVAL` | | `20000` | RSS 拉取间隔（ms） |
| `URGENT_FLUSH_INTERVAL` | | `10000` | 紧急队列 flush 间隔（ms） |
| `URGENT_FLUSH_COUNT` | | `5` | 紧急队列数量触发阈值 |
| `DIGEST_FLUSH_INTERVAL` | | `900000` | 摘要队列 flush 间隔（ms，默认 15min） |
| `URGENCY_THRESHOLD` | | `75` | 紧急推送阈值（0-100） |
| `SIMILARITY_THRESHOLD` | | `0.55` | 跨源聚合相似度阈值 |
| `DEDUP_TTL_HOURS` | | `72` | 去重记录保留时长（小时） |
| `SENT_EVENT_TTL_HOURS` | | `24` | 已发送紧急事件保留时长（小时） |
| `CONTENT_MAX_CHARS` | | `500` | 每条新闻最大内容长度 |
| `MAX_ITEMS_PER_RUN` | | `30` | 每次拉取最大条数 |

### RSS 源（`feeds.yaml`）

```yaml
feeds:
  - name: bloomberg-markets
    url: http://localhost:1200/bloomberg/markets
    enabled: true
  - name: jin10-important
    url: http://localhost:1200/jin10/1
    enabled: true
  # 更多源参考 https://docs.rsshub.app
```

### 推送目标（`targets.yaml`）

```yaml
targets:
  - name: alerts           # 目标名称
    type: discord           # 推送类型（目前支持 discord）
    channel_id: "${DISCORD_URGENT_CHANNEL_ID}"  # 频道 ID（支持 ${ENV_VAR} 展开）
    queues: [urgent]        # 接收的队列类型
  - name: digest
    type: discord
    channel_id: "${DISCORD_DIGEST_CHANNEL_ID}"
    queues: [normal]
```

支持将紧急消息和摘要推送到不同频道。推送目标接口可扩展，未来可添加 Telegram、Slack 等。

## 输出格式

**紧急快讯**（urgency ≥ 75 时通过紧急队列推送）：
```
🚨 紧急快讯 🟠 高

- 美联储宣布降息25个基点，鲍威尔称通胀压力已明显缓解 _(Bloomberg)_ <https://...>
```

**定时摘要**（每 15 分钟汇总推送）：
```
📰 新闻摘要 — 2026-03-22 12:00 | 共 11 条

🔥 重点关注
- 中国2月CPI同比上涨0.7%，低于市场预期 _(jin10-important)_ <https://...>

📋 其他资讯（8条）
- 台交所加权股价指数收高1.5% _(cls-telegraph)_ <https://...>

CrowWire · 2026-03-22 12:00
```

## 聚合原理

1. **哈希去重**（精确匹配）— 移除完全相同的条目
2. **TF 余弦相似度**（标题+正文，unigram+bigram 分词）— 计算两两相似度
3. **LLM 辅助去重** — 相似度在模糊区间（0.3-0.55）的配对由 LLM 判断，结果缓存到 SQLite
4. **完全连接聚类**（complete-linkage）— 组内所有配对都必须超过阈值才合并
5. **同源守卫** — 同一 RSS 源的条目永不合并
6. **LLM 合并摘要** — 多源事件组生成中文综合摘要（失败时退化为标题列表）
7. **紧急去重** — 新的紧急条目与最近已发送事件做相似度比对

## 运维

```bash
# 查看日志
docker compose logs -f crowwire

# 重启
docker compose restart crowwire

# 查看 RSSHub 日志
docker compose logs rsshub

# 更新
git pull && docker compose build crowwire && docker compose up -d

# 停止
docker compose down

# 清除数据（重新开始）
docker compose down -v
```

## 开发

```bash
npm install
npm run build        # TypeScript 编译
npm test             # 运行全部 130 个测试
npm run test:watch   # 监听模式
npm run dev          # 本地开发运行 daemon
```

## 默认 RSS 源

| 来源 | RSSHub 路由 | 语言 |
|------|-------------|------|
| Bloomberg Markets | `/bloomberg/markets` | EN |
| Bloomberg Technology | `/bloomberg/technology` | EN |
| Bloomberg Business | `/bloomberg/bbiz` | EN |
| 金十数据（重要） | `/jin10/1` | CN |
| 华尔街见闻 资讯 | `/wallstreetcn/news` | CN |
| 华尔街见闻 实时 | `/wallstreetcn/live/global/2` | CN |
| 财联社 电报 | `/cls/telegraph` | CN |
| 财联社 热门 | `/cls/hot` | CN |
| 财联社 深度 | `/cls/depth` | CN |

## License

MIT
