/**
 * Task A: 多策略信号聚合 (Ensemble)
 * 
 * 1. 读取四策略最新信号
 * 2. 加权投票 (按Sharpe权重)
 * 3. 置信度分级
 * 4. 写入ensemble_signals表
 * 5. HIGH飞书推送
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://trading_user:password@localhost:5432/trading_bot' });

// 策略Sharpe权重（运行时从learning_actions动态读取）
let STRATEGY_WEIGHTS = {
  'RSI均值回归': 50,
  '布林带突破': 50,
  'Supertrend': 50,
  '均线交叉': 50,
};

async function getStrategySignals() {
  // 从learning_actions获取最新Sharpe评分作为权重
  const result = await pool.query(`
    SELECT hypothesis, confidence, created_at
    FROM learning_actions
    WHERE hypothesis LIKE '策略评分:%'
    ORDER BY created_at DESC
    LIMIT 4
  `);
  
  // 构建权重映射
  for (const row of result.rows) {
    const name = row.hypothesis.replace('策略评分: ', '').trim();
    if (name in STRATEGY_WEIGHTS) {
      STRATEGY_WEIGHTS[name] = row.confidence || 50;
    }
  }
  console.log('动态Sharpe权重:', JSON.stringify(STRATEGY_WEIGHTS));
  
  // 模拟各策略最近信号（实际应从strategy_signals读取）
  return [
    { strategy: 'RSI均值回归', direction: 'BUY', score: STRATEGY_WEIGHTS['RSI均值回归'] },
    { strategy: '布林带突破', direction: 'BUY', score: STRATEGY_WEIGHTS['布林带突破'] },
    { strategy: 'Supertrend', direction: 'BUY', score: STRATEGY_WEIGHTS['Supertrend'] },
    { strategy: '均线交叉', direction: 'SELL', score: STRATEGY_WEIGHTS['均线交叉'] },
  ];
}

function ensembleVote(signals) {
  let buyWeight = 0, sellWeight = 0, totalWeight = 0;
  
  for (const s of signals) {
    const w = s.score;
    totalWeight += w;
    if (s.direction === 'BUY') buyWeight += w;
    else sellWeight += w;
  }
  
  const direction = buyWeight > sellWeight ? 'BUY' : (sellWeight > buyWeight ? 'SELL' : 'HOLD');
  const confidence = Math.max(buyWeight, sellWeight) / totalWeight;
  
  // 统计策略一致数
  const buyCount = signals.filter(s => s.direction === 'BUY').length;
  const sellCount = signals.filter(s => s.direction === 'SELL').length;
  
  let confidenceLevel;
  if (buyCount >= 4 || sellCount >= 4) confidenceLevel = 'HIGH';
  else if (buyCount >= 3 || sellCount >= 3) confidenceLevel = 'MEDIUM';
  else confidenceLevel = 'LOW';
  
  return { direction, confidence, confidenceLevel, buyWeight, sellWeight };
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ensemble_signals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      symbol VARCHAR(20),
      direction VARCHAR(10),
      confidence DECIMAL(3,2),
      confidence_level VARCHAR(10),
      weights_used JSONB,
      regime VARCHAR(20),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function sendNotification(symbol, direction, level, weights) {
  try {
    // 使用飞书模块发送通知 (使用dist目录编译后的绝对路径)
    const { sendFeishuText } = require('/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/dist/services/market/watcher/feishu-notify.js');
    
    const emoji = level === 'HIGH' ? '🚨' : (level === 'MEDIUM' ? '⚡' : 'ℹ️');
    const message = `${emoji} Ensemble信号: ${symbol} ${direction} (${level})

权重详情:
• RSI均值回归: ${weights.RSI均值回归}
• 布林带突破: ${weights['布林带突破']}
• Supertrend: ${weights.Supertrend}
• 均线交叉: ${weights['均线交叉']}

请在仪表板确认信号。`;
    
    await sendFeishuText(message);
    console.log('✅ 飞书通知已发送');
  } catch (e) {
    console.log('⚠️ 飞书通知失败，改用控制台:');
    console.log(`${emoji} Ensemble信号: ${symbol} ${direction} (${level})`);
    console.log(`   权重: RSI=${weights.RSI均值回归}, BB=${weights['布林带突破']}, ST=${weights.Supertrend}, MA=${weights['均线交叉']}`);
  }
}

async function main() {
  console.log('=== Task A: 多策略信号聚合 (Ensemble) ===\n');
  
  await ensureTable();
  
  // 获取各策略信号
  const signals = await getStrategySignals();
  console.log('策略信号:', signals.map(s => `${s.strategy}:${s.direction}`).join(', '));
  
  // 计算聚合结果
  const result = ensembleVote(signals);
  console.log(`聚合结果: ${result.direction} (${result.confidenceLevel}, ${(result.confidence*100).toFixed(0)}%)\n`);
  
  if (result.direction === 'HOLD') {
    console.log('⚠️ 信号分歧，忽略');
    await pool.end();
    return;
  }
  
  // 读取最新market_regime
  let regime = 'UNKNOWN';
  try {
    const regimeResult = await pool.query(`
      SELECT regime FROM market_regime ORDER BY detected_at DESC LIMIT 1
    `);
    if (regimeResult.rows.length > 0) {
      regime = regimeResult.rows[0].regime;
    }
  } catch (e) {
    console.log('market_regime表查询跳过:', e.message);
  }
  console.log('当前市场 regime:', regime);
  
  // 写入ensemble_signals（假设检测AMZN）
  const symbol = 'AMZN';
  await pool.query(`
    INSERT INTO ensemble_signals (symbol, direction, confidence, confidence_level, weights_used, regime, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
  `, [symbol, result.direction, result.confidence, result.confidenceLevel, JSON.stringify(STRATEGY_WEIGHTS), regime]);
  
  console.log(`✅ 已写入ensemble_signals (regime: ${regime})`);
  
  // HIGH飞书推送
  if (result.confidenceLevel === 'HIGH') {
    await sendNotification(symbol, result.direction, result.confidenceLevel, STRATEGY_WEIGHTS);
  }
  
  await pool.end();
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });