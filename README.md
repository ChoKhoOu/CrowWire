# CrowWire

基于 [OpenClaw](https://openclaw.ai/) Lobster 工作流的财经新闻监控管道。自动抓取 RSS 源、去重、LLM 评分、跨源事件聚合，并推送紧急快讯和定时摘要。

## 架构

```
fetch → dedup → score → classify → format → send
  │        │       │        │          │       │
  │        │       │        │          │       └─ openclaw.invoke 推送消息
  │        │       │        │          └─ 中文 Markdown（紧急快讯 / 定时摘要）
  │        │       │        └─ 紧急分流 + 缓冲 + 跨源事件聚合
  │        │       └─ openclaw.invoke llm-task（紧急度/相关度/新颖度）
  │        └─ SQLite 哈希去重（identity + content）
  └─ RSSHub RSS/Atom 解析
```

**核心特性：**
- **跨源事件聚合** — 不同 RSS 源报道同一事件的新闻合并为一条，LLM 生成综合摘要
- **紧急去重** — 已发送的紧急事件，后续其他源的报道静默丢弃
- **保守合并策略** — 完全连接聚类（complete-linkage），宁可漏合不可误合
- **中文优先输出** — 摘要按高/低相关度分层展示

## 前置要求

- Node.js >= 22
- Docker（用于 RSSHub）
- [OpenClaw](https://github.com/openclaw/openclaw)（`npm i -g openclaw@latest && openclaw onboard --install-daemon`）

## 快速开始

```bash
git clone https://github.com/ChoKhoOu/CrowWire.git
cd CrowWire
./install.sh
```

安装脚本自动完成：
1. 通过 Docker Compose 启动 RSSHub
2. 构建 CLI（`crowwire-cli`）
3. 冒烟测试
4. 注册 OpenClaw Skill
5. 启用 Lobster 插件
6. 输出定时任务配置命令

`git pull` 后重新运行 `./install.sh` 自动识别为升级模式。

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
  urgent_threshold: 85          # 紧急度 >= 此值触发即时推送
  digest_interval_minutes: 15   # 摘要缓冲刷新间隔（分钟）
  dedup_ttl_hours: 72           # 去重记录保留时长（小时）
  content_max_chars: 500        # 每条新闻最大内容长度
  max_items_per_run: 30         # 每次运行最大抓取条数
  similarity_threshold: 0.55    # 跨源聚合相似度阈值（越高越严格）
  sent_event_ttl_hours: 24      # 已发送紧急事件记录保留时长（小时）
```

## 定时任务

在 OpenClaw 中注册 cron：

```bash
openclaw cron add \
  --name "crowwire-news-monitor" \
  --cron "*/30 * * * *" \
  --tz "Asia/Shanghai" \
  --session isolated \
  --sessionTarget "session:crowwire-monitor" \
  --message "Run the CrowWire pipeline: lobster run /path/to/crowwire.lobster"
```

## LLM 模型配置

CrowWire 通过 `openclaw.invoke --tool llm-task` 调用 LLM，模型和 API 由 OpenClaw 配置决定。

在 `~/.openclaw/openclaw.json` 中设置：

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

## 手动测试

```bash
# 单步测试
crowwire-cli fetch --config ./feeds.yaml | head -c 500

# 完整 pipeline（不含 LLM 评分）
crowwire-cli fetch --config ./feeds.yaml \
  | crowwire-cli dedup --db ./crowwire.db \
  | crowwire-cli classify --db ./crowwire.db \
  | crowwire-cli format --type digest

# 通过 Lobster 运行
lobster run ./crowwire.lobster
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `crowwire-cli fetch --config <path>` | 抓取 RSS 源，输出 JSON |
| `crowwire-cli dedup --db <path>` | SQLite 哈希去重 |
| `crowwire-cli score` | LLM 评分（紧急度/相关度/新颖度） |
| `crowwire-cli classify --db <path>` | 紧急分流 + 跨源聚合 |
| `crowwire-cli format --type <urgent\|digest>` | 格式化为中文 Markdown |

### classify 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--threshold <n>` | 85 | 紧急推送阈值 |
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
```

## 开发

```bash
npm install
npm run build        # TypeScript 编译
npm test             # 运行全部 68 个测试
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
