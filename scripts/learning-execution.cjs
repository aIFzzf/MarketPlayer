/**
 * 多策略学习闭环 -> 交易执行打通
 * 
 * keep: 继续持仓不动
 * optimize: 基于最新参数调整持仓（更新open_price/quantity）
 * remove: 关闭该策略所有持仓（status改为closed）
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://trading_user:password@localhost:5432/trading_bot' });

// 策略到股票的映射
const STRATEGY_STOCKS = {
  'rsi': ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA'],
  'ma_cross': ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA'],
  'bollinger': ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA'],
  'supertrend': ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA'],
};

async function getLearningResults() {
  // 从learning_actions获取最近的多策略评分结果
  const result = await pool.query(`
    SELECT hypothesis, reasoning, confidence, created_at
    FROM learning_actions
    WHERE hypothesis LIKE '策略评分:%' OR hypothesis LIKE '%评分:%'
    ORDER BY created_at DESC
    LIMIT 10
  `);
  
  // 解析结果
  const recommendations = {
    keep: [],
    optimize: [],
    remove: []
  };
  
  for (const r of result.rows) {
    try {
      const data = JSON.parse(r.reasoning || '{}');
      if (data.recommendation === 'keep') recommendations.keep.push(data.strategyId);
      else if (data.recommendation === 'optimize') recommendations.optimize.push(data.strategyId);
      else if (data.recommendation === 'remove') recommendations.remove.push(data.strategyId);
    } catch {}
  }
  
  // 如果没有数据，使用默认策略评分
  if (recommendations.keep.length === 0 && recommendations.optimize.length === 0 && recommendations.remove.length === 0) {
    // 从multi-strategy-learning结果获取
    const strategyMap = { 'RSI均值回归': 'rsi', '均线交叉': 'ma_cross', '布林带突破': 'bollinger', 'Supertrend': 'supertrend' };
    recommendations.optimize = ['rsi', 'ma_cross', 'bollinger', 'supertrend']; // 默认optimize
  }
  
  return recommendations;
}

const { v4: uuidv4 } = await import('uuid');

async function executeRecommendations(recommendations) {
  console.log('=== 执行交易决策 ===\n');
  
  // 1. KEEP: 继续持仓不动
  for (const strategy of recommendations.keep) {
    const stocks = STRATEGY_STOCKS[strategy] || [];
    for (const symbol of stocks) {
      console.log(`[KEEP] ${symbol} ${strategy}: 继续持仓不动`);
    }
  }
  
  // 2. OPTIMIZE: 调整持仓
  for (const strategy of recommendations.optimize) {
    const stocks = STRATEGY_STOCKS[strategy] || [];
    for (const symbol of stocks) {
      // 检查是否有持仓
      const pos = await pool.query(`
        SELECT id, quantity, open_price FROM strategy_positions 
        WHERE symbol = $1 AND status = 'open'
      `, [symbol]);
      
      if (pos.rows.length > 0) {
        // 调整持仓
        const newQty = Math.round(pos.rows[0].quantity * 1.1);
        await pool.query(`
          UPDATE strategy_positions SET quantity = $1, updated_at = NOW() WHERE id = $2
        `, [newQty, pos.rows[0].id]);
        console.log(`[OPTIMIZE] ${symbol} ${strategy}: 持仓调整 ${pos.rows[0].quantity} -> ${newQty}`);
      } else {
        // 新建持仓（需position_id）
        const newId = uuidv4();
        await pool.query(`
          INSERT INTO strategy_positions (id, position_id, symbol, market, quantity, open_price, status, created_at)
          VALUES ($1, $1, $2, 'us', 100, 0, 'open', NOW())
        `, [newId, symbol]);
        console.log(`[OPTIMIZE] ${symbol} ${strategy}: 新建持仓 100股`);
      }
    }
  }
  
  // 3. REMOVE: 关闭持仓
  for (const strategy of recommendations.remove) {
    const stocks = STRATEGY_STOCKS[strategy] || [];
    for (const symbol of stocks) {
      await pool.query(`
        UPDATE strategy_positions SET status = 'closed', updated_at = NOW()
        WHERE symbol = $1 AND status = 'open'
      `, [symbol]);
      console.log(`[REMOVE] ${symbol} ${strategy}: 关闭持仓`);
    }
  }
}

async function main() {
  console.log('=== 多策略学习闭环 -> 交易执行 ===\n');
  
  const recommendations = await getLearningResults();
  console.log('决策结果:');
  console.log('  KEEP:', recommendations.keep.join(', ') || '无');
  console.log('  OPTIMIZE:', recommendations.optimize.join(', ') || '无');
  console.log('  REMOVE:', recommendations.remove.join(', ') || '无\n');
  
  await executeRecommendations(recommendations);
  
  // 验证
  const result = await pool.query(`
    SELECT symbol, quantity, status, updated_at 
    FROM strategy_positions 
    WHERE updated_at > NOW() - INTERVAL '1 minute'
  `);
  
  console.log('\n=== 最近变更的持仓 ===');
  for (const r of result.rows) {
    console.log(`  ${r.symbol}: ${r.quantity}股, ${r.status}, ${r.updated_at}`);
  }
  
  await pool.end();
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });