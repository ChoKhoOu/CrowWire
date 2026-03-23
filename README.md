# CrowWire

自部署的新闻监控 daemon。自动抓取 RSS 源、去重、LLM 评分、LLM 辅助去重、跨源事件聚合，通过双优先级队列推送紧急快讯和定时摘要到 Discord。

`docker compose up` 一键启动，无需克隆仓库。

## 快速开始

### 1. 创建项目目录

```bash
mkdir crowwire && cd crowwire
```

### 2. 创建 docker-compose.yml

```yaml
services:
  rsshub:
    image: diygod/rsshub:latest
    ports:
      - "1200:1200"
    environment:
      NODE_ENV: production
      CACHE_TYPE: memory
      CACHE_EXPIRE: 300
      REQUEST_TIMEOUT: 30000
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:1200"]
      interval: 30s
      timeout: 10s
      retries: 3

  crowwire:
    image: ghcr.io/chokhoou/crowwire:latest
    depends_on:
      rsshub:
        condition: service_healthy
    volumes:
      - crowwire-data:/app/data
      - ./config:/app/config
    restart: unless-stopped
    environment:
      RSSHUB_URL: http://rsshub:1200

volumes:
  crowwire-data:
```

### 3. 首次启动（生成默认配置）

```bash
mkdir -p config
docker compose up -d
```

首次启动会自动在 `config/` 下生成默认配置文件：

```
config/
├── config.yaml      # LLM、Discord、daemon 参数
├── feeds.yaml       # RSS 源
├── targets.yaml     # 推送目标
└── filters.yaml     # 黑名单过滤
```

### 4. 编辑配置

```bash
# 停止服务
docker compose down
```

编辑 `config/config.yaml`，填写 LLM API 和 Discord Bot：

```yaml
llm:
  base_url: https://api.openai.com/v1
  api_key: sk-your-key-here
  model: gpt-4o-mini

discord:
  bot_token: your-bot-token-here
```

编辑 `config/targets.yaml`，填写 Discord 频道 ID：

```yaml
targets:
  - name: alerts
    type: discord
    channel_id: "123456789"    # 紧急快讯频道
    queues: [urgent]
  - name: digest
    type: discord
    channel_id: "987654321"    # 定时摘要频道
    queues: [normal]
```

> **Discord Bot 设置**：在 [Discord Developer Portal](https://discord.com/developers/applications) 创建 Application → Bot，复制 Token。邀请 Bot 到你的服务器，确保 Bot 有目标频道的发送消息权限。频道 ID 通过右键频道 → 复制频道 ID 获取（需开启开发者模式）。

### 5. 重新启动

```bash
docker compose up -d
```

### 6. 查看日志

```bash
docker compose logs -f crowwire
```

---

<details>
<summary>AI Installation Guide (for LLM agents — click to expand)</summary>

### LLM Agent Setup Flow

For Claude Code, Cursor, and other AI coding assistants to set up CrowWire automatically.

#### Prerequisites

- Docker and Docker Compose installed on the target machine
- An OpenAI API key (or compatible provider using the Responses API)
- A Discord Bot Token with message permissions

#### Steps

1. Create project directory and docker-compose.yml:
```bash
mkdir -p crowwire/config && cd crowwire
```

2. Write the `docker-compose.yml` from the Quick Start section above.

3. Start once to generate default configs:
```bash
docker compose up -d
# Wait for config files to be generated
sleep 5
docker compose down
```

4. Ask the user for the following and write to `config/config.yaml`:
   - **LLM API**: `llm.base_url`, `llm.api_key`, `llm.model` (must support OpenAI Responses API at `/v1/responses`)
   - **Discord Bot Token**: `discord.bot_token`

5. Ask the user for Discord channel IDs and write to `config/targets.yaml`:
   - `channel_id` for urgent alerts queue
   - `channel_id` for digest/normal queue

6. Optional: edit `config/feeds.yaml` to customize RSS sources, edit `config/filters.yaml` to add blacklist categories.

7. Start the service:
```bash
docker compose up -d
```

8. Verify:
```bash
docker compose logs crowwire | head -20
# Should see "[daemon] CrowWire daemon started" and feed/target count
```

#### Update

```bash
cd /path/to/crowwire
docker compose pull crowwire
docker compose up -d
```

Config files in `config/` are preserved across updates.

#### LLM API Compatibility

CrowWire uses the **OpenAI Responses API** (`/v1/responses` endpoint). This is **not** the Chat Completions API. Ensure the configured LLM provider supports this endpoint. Key differences:

- Endpoint: `/v1/responses` (not `/v1/chat/completions`)
- System prompt via `instructions` field (not messages array)
- Streaming uses `response.output_text.delta` events (not `choices[0].delta`)
- JSON mode via `text.format` (not `response_format`)

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
- **配置热重载** — feeds、targets、filters 文件变更后自动重新加载

## 配置

### 主配置（`config/config.yaml`）

```yaml
# LLM API（OpenAI Responses API）
llm:
  base_url: https://api.openai.com/v1
  api_key: sk-your-key-here
  model: gpt-4o-mini

# Discord Bot
discord:
  bot_token: your-bot-token-here

# Daemon 参数（全部可选，以下为默认值）
daemon:
  fetch_interval: 20000          # RSS 拉取间隔（ms）
  urgent_flush_interval: 10000   # 紧急队列 flush 间隔（ms）
  urgent_flush_count: 5          # 紧急队列数量触发阈值
  digest_flush_interval: 900000  # 摘要队列 flush 间隔（ms，默认 15min）
  urgency_threshold: 75          # 紧急推送阈值（0-100）
  similarity_threshold: 0.55     # 跨源聚合相似度阈值（0-1）
  dedup_ttl_hours: 72            # 去重记录保留时长（小时）
  sent_event_ttl_hours: 24       # 已发送紧急事件保留时长（小时）
  content_max_chars: 500         # 每条新闻最大内容长度
  max_items_per_run: 30          # 每次拉取最大条数
```

### RSS 源（`config/feeds.yaml`）

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

### 推送目标（`config/targets.yaml`）

```yaml
targets:
  - name: alerts
    type: discord
    channel_id: "123456789"
    queues: [urgent]
  - name: digest
    type: discord
    channel_id: "987654321"
    queues: [normal]
```

### 黑名单过滤（`config/filters.yaml`）

```yaml
blacklist:
  - "大A个股涨跌、股价、涨停板相关新闻"
  - "国家领导人常规考察、调研、座谈会等礼节性政治活动（非突发政策变动或重大人事调整）"
```

每条规则为自然语言描述，LLM 评分时判断新闻是否命中。

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

# 更新镜像
docker compose pull crowwire && docker compose up -d

# 停止
docker compose down

# 清除数据（重新开始）
docker compose down -v
```

## 开发

```bash
npm install
npm run build        # TypeScript 编译
npm test             # 运行测试
npm run test:watch   # 监听模式
CONFIG_DIR=./config npm run dev   # 本地开发运行 daemon
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
