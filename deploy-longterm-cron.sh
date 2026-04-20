#!/bin/bash
# 部署长线Agent定时任务

cd ~/.openclaw/workspace/MarketPlayer

echo "🚀 部署长线Agent定时任务..."

# 检查PostgreSQL
if ! pgrep -f postgres > /dev/null; then
    echo "⚠️  PostgreSQL未运行，请先启动: brew services start postgresql@15"
    exit 1
fi

# 添加到crontab (每周日 20:00)
(crontab -l 2>/dev/null | grep -v "long-term-agent/index.js"; echo "0 20 * * 0 cd ~/.openclaw/workspace/MarketPlayer && DATABASE_URL=\"postgresql://trading_user:password@localhost:5432/trading_bot\" /usr/local/bin/node agents/long-term-agent/index.js >> logs/longterm-agent.log 2>&1") | crontab -

echo "✅ 定时任务已添加: 每周日 20:00 执行"

# 创建日志文件
mkdir -p logs
touch logs/longterm-agent.log

echo "✅ 日志文件已创建"

# 验证crontab
echo ""
echo "📊 当前crontab配置:"
crontab -l | grep -E "longterm|learning"

echo ""
echo "🧪 测试运行长线Agent..."
DATABASE_URL="postgresql://trading_user:password@localhost:5432/trading_bot" \
  node agents/long-term-agent/index.js | head -50

echo ""
echo "✨ 部署完成！"
echo ""
echo "📌 使用说明:"
echo "  - 查看crontab: crontab -l"
echo "  - 查看日志: tail -f logs/longterm-agent.log"
echo "  - 手动运行: ./deploy-longterm-cron.sh"
echo "  - 数据库状态: psql -d trading_bot -c 'SELECT COUNT(*) FROM signal_candidates;'"
