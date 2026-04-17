/**
 * P1-1: 长线候选股指导短线参数优化
 * 
 * 读取长线候选股评分，高评分股票在短线参数优化时给予更宽松的入场条件
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://trading_user:password@localhost:5432/trading_bot' });

// 宽松参数配置（针对高分长线股）
const PARAM_ADJUSTMENT = {
  // RSI阈值调整：高分股票更宽松
  rsi_buy_threshold: { default: 30, lenient: 25 },   // 低于30买入 -> 高分股25
  rsi_sell_threshold: { default: 70, lenient: 75 },  // 高于70卖出 -> 高分股75
  
  // 止损比例调整：高分股票允许更大波动
  stop_loss_pct: { default: 0.02, lenient: 0.03 },   // 2%止损 -> 高分股3%
  
  // 持仓天数：高分股票允许更长持有
  max_hold_days: { default: 10, lenient: 15 },
  
  // 置信度阈值
  min_confidence: { default: 0.65, lenient: 0.55 },
};

const LONG_TERM_SCORE_THRESHOLD = 50;  // 长线评分>=50视为高分

async function getLongTermCandidates() {
  const result = await pool.query(`
    SELECT symbol, score, metadata::json->>'reason' as reason
    FROM signal_candidates 
    WHERE signal_type = 'long_term' 
    AND score >= $1
    ORDER BY score DESC
  `, [LONG_TERM_SCORE_THRESHOLD]);
  return result.rows;
}

function getAdjustedParams(longTermScore) {
  // 分数越高，参数越宽松
  const leniency = Math.min(1, (longTermScore - LONG_TERM_SCORE_THRESHOLD) / 40);
  
  return {
    rsi_buy_threshold: Math.round(PARAM_ADJUSTMENT.rsi_buy_threshold.default - 
      (PARAM_ADJUSTMENT.rsi_buy_threshold.default - PARAM_ADJUSTMENT.rsi_buy_threshold.lenient) * leniency),
    rsi_sell_threshold: Math.round(PARAM_ADJUSTMENT.rsi_sell_threshold.default + 
      (PARAM_ADJUSTMENT.rsi_sell_threshold.lenient - PARAM_ADJUSTMENT.rsi_sell_threshold.default) * leniency),
    stop_loss_pct: PARAM_ADJUSTMENT.stop_loss_pct.default + 
      (PARAM_ADJUSTMENT.stop_loss_pct.lenient - PARAM_ADJUSTMENT.stop_loss_pct.default) * leniency,
    max_hold_days: Math.round(PARAM_ADJUSTMENT.max_hold_days.default + 
      (PARAM_ADJUSTMENT.max_hold_days.lenient - PARAM_ADJUSTMENT.max_hold_days.default) * leniency),
    min_confidence: Math.round((PARAM_ADJUSTMENT.min_confidence.default - 
      (PARAM_ADJUSTMENT.min_confidence.default - PARAM_ADJUSTMENT.min_confidence.lenient) * leniency) * 100) / 100,
  };
}

async function main() {
  console.log('=== P1-1: 长线候选股 → 短线参数优化 ===\n');
  
  const candidates = await getLongTermCandidates();
  
  if (candidates.length === 0) {
    console.log('⚠️ 无高分长线候选股');
    await pool.end();
    return;
  }
  
  console.log(`发现 ${candidates.length} 只高分长线股:\n`);
  
  for (const c of candidates) {
    const params = getAdjustedParams(c.score);
    console.log(`${c.symbol} (长线评分: ${c.score})`);
    console.log(`  RSI买入阈值: ${params.rsi_buy_threshold} (默认30)`);
    console.log(`  RSI卖出阈值: ${params.rsi_sell_threshold} (默认70)`);
    console.log(`  止损比例: ${(params.stop_loss_pct*100).toFixed(1)}% (默认2%)`);
    console.log(`  持仓天数: ${params.max_hold_days} (默认10)`);
    console.log(`  置信度: ${(params.min_confidence*100).toFixed(0)}% (默认65%)\n`);
  }
  
  // 记录优化结果到数据库
  for (const c of candidates) {
    const params = getAdjustedParams(c.score);
    await pool.query(`
      INSERT INTO quant_parameter_evolution (
        param_name, old_value, new_value, hypothesis, 
        backtest_result, status, reason, created_at
      ) VALUES ($1, $2, $3, $4, $5, 'optimized', $6, NOW())
    `, [
      `sentiment_${c.symbol}`,
      65,
      params.min_confidence * 100,
      { long_term_score: c.score },
      { adjusted: params },
      `Long term score ${c.score} guides short term params`
    ]);
  }
  
  console.log('✅ 参数优化记录已保存');
  await pool.end();
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });