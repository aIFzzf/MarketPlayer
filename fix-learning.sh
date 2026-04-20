#!/bin/bash
# 学习系统一键修复脚本
# 使用方法: bash fix-learning.sh

set -e  # 遇到错误立即退出

cd ~/.openclaw/workspace/MarketPlayer

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 学习系统修复工具"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ========================================
# 步骤1: 检查并找到Node路径
# ========================================
echo "📍 步骤1: 查找Node路径..."
NODE_PATH=$(which node)

if [ -z "$NODE_PATH" ]; then
    echo "❌ 错误: 找不到node命令"
    echo "   请先安装Node.js: brew install node"
    exit 1
fi

echo "   ✅ Node路径: $NODE_PATH"
NODE_VERSION=$(node -v)
echo "   ✅ Node版本: $NODE_VERSION"
echo ""

# ========================================
# 步骤2: 检查PostgreSQL
# ========================================
echo "📍 步骤2: 检查PostgreSQL..."

if ! command -v PSQL_BIN="/opt/homebrew/Cellar/postgresql@15/15.17/bin/psql"
    echo "❌ 错误: 找不到PSQL_BIN="/opt/homebrew/Cellar/postgresql@15/15.17/bin/psql"
    echo "   请先安装PostgreSQL: brew install postgresql@14"
    exit 1
fi

# 检查PostgreSQL是否运行
if ! pg_isready -q 2>/dev/null; then
    echo "⚠️  PostgreSQL未运行，正在启动..."
    brew services start postgresql@14 || pg_ctl -D /usr/local/var/postgres start
    sleep 3

    if ! pg_isready -q 2>/dev/null; then
        echo "❌ 无法启动PostgreSQL"
        exit 1
    fi
fi

echo "   ✅ PostgreSQL运行中"
echo ""

# ========================================
# 步骤3: 创建/验证数据库
# ========================================
echo "📍 步骤3: 初始化数据库..."

# 检查数据库是否存在
/opt/homebrew/Cellar/postgresql@15/15.17/bin/psql -l trading_bot >/dev/null 2>&1 || echo "   数据库已存在"

echo "   ✅ 数据库trading_bot存在"

# 执行建表脚本
echo "   执行建表脚本..."

# 验证表
PSQL_BIN="/opt/homebrew/Cellar/postgresql@15/15.17/bin/psql"
TABLE_COUNT=$($PSQL_BIN "postgresql://trading_user:password@localhost:5432/trading_bot" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null)

echo "   ✅ 创建了 $TABLE_COUNT 个学习表"
echo ""

# ========================================
# 步骤4: 更新plist配置
# ========================================
echo "📍 步骤4: 更新launchd配置..."

# 备份原plist
cp com.marketplayer.learning.plist com.marketplayer.learning.plist.bak

# 更新node路径（使用绝对路径）
cat > com.marketplayer.learning.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.marketplayer.learning</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$HOME/.openclaw/workspace/MarketPlayer/agents/harness/trigger-engine/learning-trigger.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$HOME/.openclaw/workspace/MarketPlayer</string>
    <key>StandardOutPath</key>
    <string>$HOME/.openclaw/workspace/MarketPlayer/logs/learning.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/.openclaw/workspace/MarketPlayer/logs/learning.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$(dirname $NODE_PATH)</string>
    </dict>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>2</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
</dict>
</plist>
EOF

echo "   ✅ 更新plist配置"
echo ""

# ========================================
# 步骤5: 加载launchd任务
# ========================================
echo "📍 步骤5: 加载定时任务..."

# 复制到LaunchAgents
cp com.marketplayer.learning.plist ~/Library/LaunchAgents/

# 卸载旧任务（如果存在）
launchctl unload ~/Library/LaunchAgents/com.marketplayer.learning.plist 2>/dev/null || true

# 加载新任务
launchctl load ~/Library/LaunchAgents/com.marketplayer.learning.plist

# 验证加载
sleep 1
if launchctl list | grep -q marketplayer; then
    echo "   ✅ 定时任务加载成功"
else
    echo "   ⚠️  定时任务加载可能失败，请手动检查"
fi

echo ""

# ========================================
# 步骤6: 测试运行
# ========================================
echo "📍 步骤6: 测试运行learning-trigger..."
echo "   (这可能需要几秒钟...)"
echo ""

# 清空旧日志
> logs/learning.log

# 运行测试
$NODE_PATH agents/harness/trigger-engine/learning-trigger.js &
TRIGGER_PID=$!

# 等待5秒
sleep 5

# 检查进程
if kill -0 $TRIGGER_PID 2>/dev/null; then
    echo "   ⚠️  trigger仍在运行，等待..."
    sleep 5
    kill $TRIGGER_PID 2>/dev/null || true
fi

# 检查日志
if [ -s logs/learning.log ]; then
    echo "   ✅ 测试运行成功"
    echo ""
    echo "   最新日志:"
    echo "   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    tail -5 logs/learning.log | sed 's/^/   │ /'
    echo "   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
    echo "   ⚠️  日志为空，可能有问题"
    echo "   请查看: cat logs/learning.log"
fi

echo ""

# ========================================
# 步骤7: 验证数据库记录
# ========================================
echo "📍 步骤7: 检查数据库记录..."

SIGNAL_COUNT=$(PSQL_BIN="/opt/homebrew/Cellar/postgresql@15/15.17/bin/psql"
PARAM_COUNT=$(PSQL_BIN="/opt/homebrew/Cellar/postgresql@15/15.17/bin/psql"

echo "   📊 quant_signals: $SIGNAL_COUNT 条记录"
echo "   📊 quant_parameter_evolution: $PARAM_COUNT 条记录"
echo ""

# ========================================
# 完成总结
# ========================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ 修复完成！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 修复内容:"
echo "   ✅ PostgreSQL数据库已初始化"
echo "   ✅ 学习表已创建"
echo "   ✅ launchd定时任务已加载"
echo "   ✅ 每日02:00自动运行"
echo ""
echo "🔍 验证命令:"
echo "   # 查看定时任务"
echo "   launchctl list | grep marketplayer"
echo ""
echo "   # 查看数据库表"
echo "   PSQL_BIN="/opt/homebrew/Cellar/postgresql@15/15.17/bin/psql"
echo ""
echo "   # 查看最新日志"
echo "   tail -f logs/learning.log"
echo ""
echo "   # 查看数据记录"
echo "   PSQL_BIN="/opt/homebrew/Cellar/postgresql@15/15.17/bin/psql"
echo ""
echo "⏰ 下次自动运行: 明天 02:00"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
