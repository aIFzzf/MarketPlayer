/**
 * sentiment-signal-monitor.js
 * 每5分钟扫描 sentiment_signals 中未执行的信号，提醒飞书
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://trading_user:password@localhost:5432/trading_bot');

const FEISHU_WEBHOOK = process.env.FEISHU_WEBHOOK || 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx';

async function sendFeishu(text) {
  try {
    const fetch = (await import('node-fetch')).default;
    await fetch(FEISHU_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } })
    });
  } catch (e) {
    console.log('飞书发送失败:', e.message);
  }
}

async function scanPendingSignals() {
  console.log('=== 情绪信号监控 ===\n');
  
  // 查找5分钟前创建的未执行信号
  const result = await pool.query(`
    SELECT id, symbol, action, priority, reason, confidence, created_at
    FROM sentiment_signals
    WHERE status = 'active'
    AND created_at < NOW() - INTERVAL '5 minutes'
    ORDER BY priority DESC, created_at DESC
    LIMIT 10
  `);
  
  if (result.rows.length === 0) {
    console.log('✅ 无待执行信号');
    return;
  }
  
  console.log(`⚠️ 发现 ${result.rows.length} 条未执行信号:\n`);
  
  for (const s of result.rows) {
    const emoji = s.priority === 'HIGH' ? '🚨' : '⏰';
    console.log(`${emoji} ${s.symbol}: ${s.action} (${(s.confidence*100).toFixed(0)}%) - ${s.reason}`);
  }
  
  // 飞书提醒
  const highPriority = result.rows.filter(s => s.priority === 'HIGH');
  if (highPriority.length > 0) {
    const list = highPriority.map(s => `• ${s.symbol}: ${s.action}`).join('\n');
    await sendFeishu(`🚨 情绪信号待执行 (${highPriority.length}条 HIGH优先级)\n${list}`);
  }
  
  await pool.end();
}

scanPendingSignals()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });