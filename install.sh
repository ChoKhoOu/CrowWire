#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FEEDS_YAML="$SCRIPT_DIR/feeds.yaml"
LOBSTER_FILE="$SCRIPT_DIR/crowwire.lobster"
DB_PATH="$SCRIPT_DIR/crowwire.db"
DEPLOY_CONFIG="$SCRIPT_DIR/crowwire.local.json"
SKILL_DIR="$HOME/.openclaw/workspace/skills/crowwire"
OPENCLAW_CONFIG="$HOME/.openclaw/openclaw.json"
VERSION_FILE="$SCRIPT_DIR/.installed-version"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
fail()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step()  { echo -e "\n${CYAN}==>${NC} $1"; }

# ------------------------------------------------------------------
# Detect install vs update
# ------------------------------------------------------------------
CURRENT_VERSION=$(node -e "console.log(require('$SCRIPT_DIR/package.json').version)" 2>/dev/null || echo "unknown")

if [ -f "$VERSION_FILE" ]; then
    PREV_VERSION=$(cat "$VERSION_FILE")
    MODE="update"
    echo -e "${CYAN}CrowWire-Lobster 升级模式${NC}（${PREV_VERSION} → ${CURRENT_VERSION}）"
else
    PREV_VERSION=""
    MODE="install"
    echo -e "${CYAN}CrowWire-Lobster 首次安装${NC}（${CURRENT_VERSION}）"
fi

# ------------------------------------------------------------------
# Pre-flight checks
# ------------------------------------------------------------------
step "检查环境依赖..."

command -v node >/dev/null 2>&1 || fail "未找到 Node.js，请先安装 Node >= 22"
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
[ "$NODE_MAJOR" -ge 22 ] || fail "需要 Node >= 22，当前 $(node -v)"
info "Node $(node -v)"

command -v docker >/dev/null 2>&1 || fail "未找到 Docker，请先安装"
docker info >/dev/null 2>&1 || fail "Docker 守护进程未运行"
info "Docker OK"

command -v docker compose >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1 || fail "未找到 docker compose"
info "Docker Compose OK"

command -v openclaw >/dev/null 2>&1 || fail "未找到 OpenClaw，请运行: npm install -g openclaw@latest && openclaw onboard --install-daemon"
info "OpenClaw OK"

if ! command -v lobster >/dev/null 2>&1; then
    warn "未找到 Lobster CLI，正在自动安装..."
    npm install -g @clawdbot/lobster@latest 2>/dev/null || sudo npm install -g @clawdbot/lobster@latest
    command -v lobster >/dev/null 2>&1 || fail "Lobster 安装失败，请手动运行: npm install -g @clawdbot/lobster@latest"
fi
info "Lobster OK ($(lobster --version 2>/dev/null || echo 'installed'))"

# Verify openclaw.invoke shim (comes with lobster)
command -v openclaw.invoke >/dev/null 2>&1 || warn "openclaw.invoke 未在 PATH 中，部分功能（LLM 评分、消息发送）将降级运行"

# ------------------------------------------------------------------
# Step 1: RSSHub
# ------------------------------------------------------------------
if curl -sf http://localhost:1200 >/dev/null 2>&1; then
    step "RSSHub 已在运行，拉取最新镜像..."
    cd "$SCRIPT_DIR"
    docker compose pull --quiet
    docker compose up -d
    info "RSSHub 已更新并重启"
else
    step "启动 RSSHub..."
    cd "$SCRIPT_DIR"
    docker compose up -d

    echo -n "等待 RSSHub 就绪"
    for i in $(seq 1 30); do
        if curl -sf http://localhost:1200 >/dev/null 2>&1; then
            echo ""
            info "RSSHub 运行在 http://localhost:1200"
            break
        fi
        echo -n "."
        sleep 2
        if [ "$i" -eq 30 ]; then
            echo ""
            fail "RSSHub 启动失败，请检查: docker compose logs rsshub"
        fi
    done
fi

# ------------------------------------------------------------------
# Step 2: Build crowwire-cli
# ------------------------------------------------------------------
step "构建 crowwire-cli..."

cd "$SCRIPT_DIR"
npm install
npm run build

# npm link: check if already linked
if command -v crowwire-cli >/dev/null 2>&1; then
    LINKED_PATH=$(which crowwire-cli 2>/dev/null || true)
    if [ -n "$LINKED_PATH" ]; then
        info "crowwire-cli 已链接: $LINKED_PATH（重新构建完成）"
    fi
else
    npm link 2>/dev/null || sudo npm link
    command -v crowwire-cli >/dev/null 2>&1 || fail "npm link 后仍未找到 crowwire-cli"
    info "crowwire-cli 已安装: $(which crowwire-cli)"
fi

# ------------------------------------------------------------------
# Step 3: Smoke test
# ------------------------------------------------------------------
step "冒烟测试..."

FETCH_OUTPUT=$(crowwire-cli fetch --config "$FEEDS_YAML" 2>/dev/null || true)
ITEM_COUNT=$(echo "$FETCH_OUTPUT" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{try{console.log(JSON.parse(d).length)}catch{console.log(0)}})
" 2>/dev/null)

if [ "$ITEM_COUNT" -gt 0 ]; then
    info "成功抓取 $ITEM_COUNT 条资讯"
else
    warn "抓取 0 条（部分源可能需要时间填充）"
fi

# ------------------------------------------------------------------
# Step 4: Deploy config (crowwire.local.json)
# ------------------------------------------------------------------
step "检查部署配置..."

if [ -f "$DEPLOY_CONFIG" ]; then
    # Update: preserve channel/target, only sync paths
    node -e "
      const fs = require('fs');
      const cfg = JSON.parse(fs.readFileSync('$DEPLOY_CONFIG', 'utf8'));
      cfg.config = '$FEEDS_YAML';
      cfg.db = '$DB_PATH';
      fs.writeFileSync('$DEPLOY_CONFIG', JSON.stringify(cfg, null, 2) + '\n');
    "
    info "已同步路径（channel/target 保持不变）"
else
    # First install: create with placeholders
    node -e "
      const fs = require('fs');
      const cfg = {
        channel: 'discord',
        target: 'channel:YOUR_CHANNEL_ID',
        config: '$FEEDS_YAML',
        db: '$DB_PATH',
        cron: '*/2 * * * *',
        tz: 'Asia/Shanghai'
      };
      fs.writeFileSync('$DEPLOY_CONFIG', JSON.stringify(cfg, null, 2) + '\n');
    "
    info "已创建部署配置: $DEPLOY_CONFIG"
    warn "请编辑 $DEPLOY_CONFIG 填入你的 channel 和 target"
fi

# Build --args-json from deploy config for cron / skill usage
ARGS_JSON=$(node -e "
  const cfg = JSON.parse(require('fs').readFileSync('$DEPLOY_CONFIG', 'utf8'));
  console.log(JSON.stringify({ channel: cfg.channel, target: cfg.target, config: cfg.config, db: cfg.db }));
")

# ------------------------------------------------------------------
# Step 5: Register / update OpenClaw Skill
# ------------------------------------------------------------------
step "注册 OpenClaw Skill..."

mkdir -p "$SKILL_DIR"
cat > "$SKILL_DIR/SKILL.md" << SKILLEOF
---
name: crowwire
description: CrowWire financial news monitoring pipeline — fetches RSS, deduplicates, LLM scores, classifies urgent/digest, and delivers notifications
---

You have access to the CrowWire news monitoring pipeline.

## Run the full pipeline (uses deploy config)

\`\`\`bash
lobster run $LOBSTER_FILE --args-json '$ARGS_JSON'
\`\`\`

## Deploy config

Local deployment settings are stored in \`$DEPLOY_CONFIG\`.
Edit this file to change channel, target, cron interval, or timezone.
The lobster workflow template (\`crowwire.lobster\`) should not be modified directly.

## Pipeline stages

1. **fetch** — pull latest articles from RSS feeds (Bloomberg, Jin10, Wallstreetcn, CLS)
2. **dedup** — skip already-seen items (SQLite identity/content hash)
3. **score** — LLM scores each item for urgency/relevance/novelty (0-100)
4. **classify** — urgent (>= 75) sent immediately; others buffered for digest
5. **format** — render as urgent alert or digest summary (Chinese output)
6. **send** — deliver to configured channel (--channel provider --target destination)

## Manual CLI usage

\`\`\`bash
crowwire-cli fetch --config $FEEDS_YAML | crowwire-cli dedup --db $DB_PATH | crowwire-cli classify --db $DB_PATH | crowwire-cli format --type digest
\`\`\`
SKILLEOF

if [ "$MODE" = "update" ]; then
    info "Skill 已更新"
else
    info "Skill 已注册: $SKILL_DIR"
fi

# ------------------------------------------------------------------
# Step 6: Enable plugins & tool allowlist (idempotent)
# ------------------------------------------------------------------
step "检查插件配置..."

if [ -f "$OPENCLAW_CONFIG" ]; then
    node -e "
      const fs = require('fs');
      const cfg = JSON.parse(fs.readFileSync('$OPENCLAW_CONFIG', 'utf8'));
      let changed = false;

      // 1. tools.alsoAllow: lobster + llm-task
      cfg.tools = cfg.tools || {};
      const allow = cfg.tools.alsoAllow || [];
      for (const t of ['lobster', 'llm-task']) {
        if (!allow.includes(t)) { allow.push(t); changed = true; }
      }
      cfg.tools.alsoAllow = allow;

      // 2. plugins.entries.llm-task.enabled = true
      cfg.plugins = cfg.plugins || {};
      cfg.plugins.entries = cfg.plugins.entries || {};
      if (!cfg.plugins.entries['llm-task'] || !cfg.plugins.entries['llm-task'].enabled) {
        cfg.plugins.entries['llm-task'] = { enabled: true };
        changed = true;
      }

      // 3. agents: ensure main agent allows llm-task
      cfg.agents = cfg.agents || {};
      cfg.agents.list = cfg.agents.list || [{ id: 'main' }];
      const main = cfg.agents.list.find(a => a.id === 'main') || cfg.agents.list[0];
      main.tools = main.tools || {};
      const agentAllow = main.tools.alsoAllow || [];
      if (!agentAllow.includes('llm-task')) { agentAllow.push('llm-task'); changed = true; }
      main.tools.alsoAllow = agentAllow;

      if (changed) {
        fs.writeFileSync('$OPENCLAW_CONFIG', JSON.stringify(cfg, null, 2) + '\n');
        console.log('UPDATED');
      } else {
        console.log('OK');
      }
    " 2>/dev/null && {
        PLUGIN_RESULT=$(node -e "
          const fs = require('fs');
          const cfg = JSON.parse(fs.readFileSync('$OPENCLAW_CONFIG', 'utf8'));
          const llm = cfg.plugins?.entries?.['llm-task']?.enabled ? 'yes' : 'no';
          const lobster = (cfg.tools?.alsoAllow || []).includes('lobster') ? 'yes' : 'no';
          console.log(llm + ':' + lobster);
        " 2>/dev/null)
        info "llm-task 插件: 已启用 | Lobster: 已允许"
    } || {
        warn "自动配置失败，请手动在 $OPENCLAW_CONFIG 中添加:"
        echo '  plugins.entries."llm-task".enabled = true'
        echo '  tools.alsoAllow: ["lobster", "llm-task"]'
        echo '  agents.list[main].tools.alsoAllow: ["llm-task"]'
    }
else
    warn "$OPENCLAW_CONFIG 不存在，请先运行 'openclaw onboard'，然后重新执行本脚本"
fi

# ------------------------------------------------------------------
# Step 7: Cron job (only on first install)
# ------------------------------------------------------------------
CRON_EXPR=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$DEPLOY_CONFIG','utf8')).cron || '*/2 * * * *')")
CRON_TZ=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$DEPLOY_CONFIG','utf8')).tz || 'Asia/Shanghai')")

if [ "$MODE" = "install" ]; then
    step "设置定时任务..."
    echo ""
    echo "运行以下命令添加定时任务："
    echo ""
    echo -e "  ${GREEN}openclaw cron add \\\\${NC}"
    echo -e "  ${GREEN}  --name \"crowwire-news-monitor\" \\\\${NC}"
    echo -e "  ${GREEN}  --cron \"$CRON_EXPR\" \\\\${NC}"
    echo -e "  ${GREEN}  --tz \"$CRON_TZ\" \\\\${NC}"
    echo -e "  ${GREEN}  --session isolated \\\\${NC}"
    echo -e "  ${GREEN}  --sessionTarget \"session:crowwire-monitor\" \\\\${NC}"
    echo -e "  ${GREEN}  --message \"Run the CrowWire pipeline: lobster run $LOBSTER_FILE --args-json '$ARGS_JSON'\"${NC}"
    echo ""
else
    step "定时任务无需修改（已在首次安装时配置）"
    info "如需更新 cron，运行: openclaw cron list"
fi

# ------------------------------------------------------------------
# Record version
# ------------------------------------------------------------------
echo "$CURRENT_VERSION" > "$VERSION_FILE"

# ------------------------------------------------------------------
# Done
# ------------------------------------------------------------------
if [ "$MODE" = "update" ]; then
    step "升级完成！（${PREV_VERSION} → ${CURRENT_VERSION}）"
else
    step "安装完成！"
fi

echo ""
echo "  RSSHub:        http://localhost:1200"
echo "  Feeds 配置:    $FEEDS_YAML"
echo "  数据库:        $DB_PATH"
echo "  部署配置:      $DEPLOY_CONFIG"
echo "  工作流模板:    $LOBSTER_FILE"
echo "  Skill:         $SKILL_DIR/SKILL.md"
echo ""
echo "快速测试："
echo "  crowwire-cli fetch --config $FEEDS_YAML | head -c 200"
echo ""
echo "完整 Pipeline："
echo "  lobster run $LOBSTER_FILE --args-json '$ARGS_JSON'"
echo ""
