/**
 * P1-2: 参数优化结果推送给实时策略
 * 
 * 监控 quant_parameter_evolution 表，新参数自动更新到实时策略配置
 */

const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://trading_user:password@localhost:5432/trading_bot' });

const STRATEGY_CONFIG_PATH = '/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/config/strategy-config.json';

async function getPendingOptimizations() {
  const result = await pool.query(`
    SELECT id, param_name, old_value, new_value, hypothesis, created_at
    FROM quant_parameter_evolution
    WHERE status = 'optimized'
    ORDER BY created_at DESC
    LIMIT 5
  `);
  return result.rows;
}

function updateStrategyConfig(paramName, newParams) {
  let config = {};
  
  if (fs.existsSync(STRATEGY_CONFIG_PATH)) {
    try { config = JSON.parse(fs.readFileSync(STRATEGY_CONFIG_PATH, 'utf-8')); }
    catch { config = {}; }
  }
  
  // 解析参数名
  const symbol = paramName.replace('sentiment_', '');
  
  if (!config.strategies) config.strategies = {};
  if (!config.strategies.short_term) config.strategies.short_term = {};
  
  config.strategies.short_term[symbol] = {
    ...config.strategies.short_term[symbol],
    ...newParams,
    optimized_at: new Date().toISOString(),
    source: 'quant_parameter_evolution'
  };
  
  fs.writeFileSync(STRATEGY_CONFIG_PATH, JSON.stringify(config, null, 2));
  return config;
}

async function sendNotification(opt) {
  // 处理两种 new_value 格式：数值(60) 或 JSON对象('{"rsi_buy_threshold":28}')
  let params;
  let isNumericFormat = false;
  try {
    params = JSON.parse(opt.new_value);
    if (typeof params !== 'object' || params === null) {
      params = { min_confidence: parseFloat(opt.new_value) / 100 };
      isNumericFormat = true;
    }
  } catch (e) {
    params = { min_confidence: parseFloat(opt.new_value) / 100 };
    isNumericFormat = true;
  }
  
  // 使用绝对路径引用
  const { sendFeishuText } = require('/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/dist/services/market/watcher/feishu-notify.js');
  
  const message = `📢 策略参数更新通知

🎯 参数: ${opt.param_name}
🔢 新参数:
${isNumericFormat ? `   • 最小置信度: ${params.min_confidence?.toFixed(2)}` : `   • RSI买入阈值: ${params.rsi_buy_threshold}
   • 止损比例: ${(params.stop_loss_pct * 100).toFixed(1)}%
   • 止盈比例: ${(params.profit_target_pct * 100).toFixed(1)}%`}
🕐 时间: ${new Date().toISOString()}`;

  await sendFeishuText(message);
  console.log('✅ 飞书通知已发送');
}

async function main() {
  console.log('=== P1-2: 参数优化推送实时策略 ===\n');
  
  const optimizations = await getPendingOptimizations();
  
  if (optimizations.length === 0) {
    console.log('⚠️ 无待推送的优化参数');
    await pool.end();
    return;
  }
  
  console.log(`发现 ${optimizations.length} 条待推送参数:\n`);
  
  for (const opt of optimizations) {
    console.log(`处理: ${opt.param_name}`);
    
    // new_value 是数值(如60)，表示min_confidence
    const newParams = { min_confidence: opt.new_value / 100 };
    const config = updateStrategyConfig(opt.param_name, newParams);
    
    // 标记已应用
    await pool.query(`
      UPDATE quant_parameter_evolution 
      SET applied_at = NOW(), status = 'applied'
      WHERE id = $1
    `, [opt.id]);
    
    // 发送通知
    await sendNotification(opt);
    console.log(`✅ ${opt.param_name} 已推送并标记应用\n`);
  }
  
  console.log('=== 实时策略配置 ===');
  console.log(JSON.stringify(config, null, 2));
  
  await pool.end();
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });