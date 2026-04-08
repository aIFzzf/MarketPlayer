/**
 * 情绪信号生成模块
 * 基于情绪量化生成交易信号
 */

import pg from 'pg';

const { Pool } = pg;

let pool: any;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://zhengzefeng:password@localhost:5432/trading_bot'
    });
  }
  return pool;
}

// 交易信号
export type SignalAction = 'BUY' | 'SELL' | 'HOLD' | 'WAIT' | 'REDUCE' | 'ADD';
export type SignalType = 'sentiment' | 'momentum' | 'value' | 'liquidity';

// 信号规则配置
const SIGNAL_RULES = {
  // 短线规则
  short_term: {
    // 极度负面情绪 → 减仓
    extreme_negative: -70,
    // 极度正面情绪 + RSI超买 → 等待
    extreme_positive: 70,
    rsi_overbought: 70,
  },
  
  // 长线规则
  long_term: {
    // 30日情绪趋势负 → 降低权重
    trend_threshold: -20,
    // 持仓天数阈值
    hold_days: 30,
  },
};

/**
 * 获取持仓
 */
async function getPositions(symbol?: string): Promise<any[]> {
  const query = symbol
    ? `SELECT * FROM positions WHERE symbol = $1 AND qty > 0`
    : `SELECT * FROM positions WHERE qty > 0`;
  
  const params = symbol ? [symbol] : [];
  const result = await getPool().query(query, params);
  return result.rows;
}

/**
 * 获取RSI
 */
async function getRSI(symbol: string): Promise<number> {
  try {
    // 从 factors 表查询
    const result = await getPool().query(`
      SELECT factor_value FROM factors
      WHERE symbol = $1 AND factor_name = 'RSI_14'
      ORDER BY date DESC
      LIMIT 1
    `, [symbol]);
    
    if (result.rows.length > 0) {
      return parseFloat(result.rows[0].factor_value);
    }
  } catch {
    // 表不存在
  }
  
  // 从因子计算器获取
  try {
    const { calculateAllFactors } = await import('./src/factors/calculator.ts');
    const factors = calculateAllFactors(symbol);
    return factors?.factors?.RSI_14 || 50;
  } catch {
    return 50;
  }
}

/**
 * 获取30日持仓变化
 */
async function getPositionChange(symbol: string): Promise<number> {
  try {
    // 简化：获取持仓天数
    const result = await getPool().query(`
      SELECT created_at FROM positions
      WHERE symbol = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [symbol]);
    
    if (result.rows.length === 0) {
      return 0;
    }
    
    const createdAt = new Date(result.rows[0].created_at);
    const days = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    return days;
  } catch {
    return 0;
  }
}

/**
 * 生成交易信号
 */
export async function generateSignal(symbol?: string): Promise<{
  symbol: string;
  action: SignalAction;
  type: SignalType;
  reason: string;
  sentiment_score: number;
  momentum: number;
  confidence: number;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}[]> {
  const signals: any[] = [];
  
  // 获取情绪
  const { quantifySentiment, calculateMomentum } = await import('./quantifier.ts');
  const sentiment = await quantifySentiment(symbol);
  const momentumData = await calculateMomentum(symbol);
  
  // Get RSI (simplified - would need proper factors table)
  const rsi = 50; // Default neutral
  
  // 获取持仓
  const positions = await getPositions(symbol);
  const hasPosition = positions.length > 0;
  
  // 短线信号生成
  if (hasPosition) {
    for (const pos of positions) {
      const symbol = pos.symbol;
      const sentimentScore = sentiment.score;
      const momentumValue = momentumData.momentum;
      let action: SignalAction = 'HOLD';
      let reason = '';
      let confidence = 0;
      let priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
      
      // 规则1: 情绪极度负面 + 持仓 → REDUCE
      if (sentimentScore <= SIGNAL_RULES.short_term.extreme_negative) {
        action = 'REDUCE';
        reason = `情绪极度负面 (${sentimentScore.toFixed(0)})`;
        confidence = Math.abs(sentimentScore) / 100;
        priority = 'HIGH';
      }
      // 规则2: 情绪极度正面 + RSI超买 → WAIT
      else if (sentimentScore >= SIGNAL_RULES.short_term.extreme_positive && rsi > SIGNAL_RULES.short_term.rsi_overbought) {
        action = 'WAIT';
        reason = `情绪正面 (${sentimentScore.toFixed(0)}) 但 RSI 超买 (${rsi.toFixed(0)})`;
        confidence = 0.8;
        priority = 'MEDIUM';
      }
      // 规则3: 情绪正面 + RSI未超买 → BUY (如果想加仓)
      else if (sentimentScore > 30 && rsi < 60) {
        action = 'HOLD'; // 持有信号，不主动买
        reason = `情绪良好 (${sentimentScore.toFixed(0)})，继续持有`;
        confidence = 0.5;
        priority = 'LOW';
      }
      // 规则4: 情绪负面但不是极端 → 观察
      else if (sentimentScore < -30) {
        action = 'WAIT';
        reason = `情绪偏弱 (${sentimentScore.toFixed(0)})，观察中`;
        confidence = 0.3;
        priority = 'LOW';
      }
      
      if (action !== 'HOLD' || sentimentScore < -50) {
        signals.push({
          symbol,
          action,
          type: 'sentiment',
          reason,
          sentiment_score: sentimentScore,
          momentum: momentumValue,
          confidence,
          priority,
        });
      }
    }
  } else {
    // 无持仓：生成买入建议
    if (sentiment.score > 30 && momentumData.trend === 'improving') {
      signals.push({
        symbol: symbol || 'MARKET',
        action: 'BUY',
        type: 'sentiment',
        reason: `情绪正面 (${sentiment.score.toFixed(0)}) 且趋势改善`,
        sentiment_score: sentiment.score,
        momentum: momentumData.momentum,
        confidence: 0.7,
        priority: 'MEDIUM',
      });
    }
  }
  
  // 写入信号表
  for (const signal of signals) {
    try {
      await getPool().query(`
        INSERT INTO sentiment_signals 
        (symbol, action, type, reason, sentiment_score, momentum, confidence, priority, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `, [
        signal.symbol,
        signal.action,
        signal.type,
        signal.reason,
        signal.sentiment_score,
        signal.momentum,
        signal.confidence,
        signal.priority,
      ]);
    } catch {
      // 表可能不存在
    }
  }
  
  return signals;
}

/**
 * 生成所有信号
 */
export async function generateAllSignals(): Promise<any[]> {
  // 获取有持仓的股票
  const positions = await getPositions();
  
  const allSignals: any[] = [];
  
  for (const pos of positions) {
    const signals = await generateSignal(pos.symbol);
    allSignals.push(...signals);
  }
  
  // 也生成市场整体信号
  const marketSignals = await generateSignal();
  allSignals.push(...marketSignals);
  
  return allSignals;
}

/**
 * 获取历史信号
 */
export async function getSignals(symbol?: string, limit: number = 10): Promise<any[]> {
  const query = symbol
    ? `SELECT * FROM sentiment_signals WHERE symbol = $1 ORDER BY created_at DESC LIMIT $2`
    : `SELECT * FROM sentiment_signals ORDER BY created_at DESC LIMIT $1`;
  
  const params = symbol ? [symbol, limit] : [limit];
  const result = await getPool().query(query, params);
  return result.rows;
}

// 测试
if (require.main === module) {
  generateSignal('AAPL').then(signals => {
    console.log('信号数量:', signals.length);
    if (signals.length > 0) {
      console.log('Sample:', JSON.stringify(signals[0], null, 2));
    }
    pool.end();
  }).catch(console.error);
}

export default generateSignal;