/**
 * 情绪监控服务
 * 定期检查情绪变化并生成交易信号
 * 兼容短线和长线策略
 */

import { generateSignal } from './signal-generator.js';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://zhengzefeng:password@localhost:5432/trading_bot'
});

// 监控配置
const CONFIG = {
  // 检查间隔（毫秒）
  checkInterval: 5 * 60 * 1000, // 5分钟

  // 策略类型
  strategies: {
    short_term: {
      enabled: true,
      // 短线阈值（更敏感）
      sentiment_buy_threshold: -30,
      sentiment_sell_threshold: -70,
      rsi_overbought: 70,
      rsi_oversold: 30,
    },
    long_term: {
      enabled: true,
      // 长线阈值（更保守）
      sentiment_trend_threshold: -20,
      hold_days_min: 30,
      weight_reduction: 0.3,
    }
  }
};

/**
 * 获取所有监控股票
 */
async function getWatchlist(): Promise<string[]> {
  try {
    // 从 watchlist 表获取
    const result = await pool.query(`
      SELECT DISTINCT symbol FROM watchlist
      ORDER BY symbol
    `);

    if (result.rows.length > 0) {
      return result.rows.map(r => r.symbol);
    }
  } catch (error) {
    console.error('获取 watchlist 失败:', error);
  }

  // 降级：从持仓获取
  try {
    const result = await pool.query(`
      SELECT DISTINCT symbol FROM strategy_positions
      WHERE status = 'open'
    `);

    if (result.rows.length > 0) {
      return result.rows.map(r => r.symbol);
    }
  } catch (error) {
    console.error('获取持仓失败:', error);
  }

  // 最后降级：使用有情绪数据的股票
  try {
    const result = await pool.query(`
      SELECT DISTINCT symbol FROM sentiment_history
      WHERE symbol != 'MARKET'
      AND created_at >= NOW() - INTERVAL '7 days'
      ORDER BY symbol
      LIMIT 20
    `);
    return result.rows.map(r => r.symbol);
  } catch {
    return [];
  }
}

/**
 * 获取持仓信息
 */
async function getPosition(symbol: string): Promise<any> {
  const result = await pool.query(`
    SELECT * FROM strategy_positions
    WHERE symbol = $1 AND status = 'open'
    ORDER BY open_date DESC
    LIMIT 1
  `, [symbol]);

  return result.rows[0] || null;
}

/**
 * 判断策略类型（短线 or 长线）
 */
function getStrategyType(position: any): 'short_term' | 'long_term' {
  if (!position) {
    return 'short_term'; // 无持仓默认短线
  }

  // 根据持仓天数判断
  const openDate = new Date(position.open_date);
  const holdDays = (Date.now() - openDate.getTime()) / (1000 * 60 * 60 * 24);

  return holdDays >= CONFIG.strategies.long_term.hold_days_min ? 'long_term' : 'short_term';
}

/**
 * 生成兼容短线和长线的信号
 */
async function generateCompatibleSignal(symbol: string): Promise<any> {
  // 获取持仓
  const position = await getPosition(symbol);
  const strategyType = getStrategyType(position);

  // 获取情绪数据
  const { quantifySentiment, calculateMomentum } = await import('./quantifier.js');
  const sentiment = await quantifySentiment(symbol);
  const momentum = await calculateMomentum(symbol);

  // 获取30日情绪趋势
  const trendResult = await pool.query(`
    SELECT AVG(score) as avg_score
    FROM sentiment_history
    WHERE symbol = $1
    AND created_at >= NOW() - INTERVAL '30 days'
  `, [symbol]);

  const sentimentTrend = trendResult.rows[0]?.avg_score || 0;

  let action = 'HOLD';
  let reason = '';
  let priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
  let confidence = 0;

  if (strategyType === 'short_term') {
    // 短线策略
    const config = CONFIG.strategies.short_term;

    if (position) {
      // 有持仓：只生成减仓/卖出信号
      if (sentiment.score <= config.sentiment_sell_threshold) {
        action = 'REDUCE';
        reason = `短线：情绪极度负面 (${sentiment.score.toFixed(0)})`;
        priority = 'HIGH';
        confidence = 0.9;
      } else if (sentiment.score < -30) {
        action = 'WAIT';
        reason = `短线：情绪偏弱 (${sentiment.score.toFixed(0)})，观察中`;
        priority = 'LOW';
        confidence = 0.5;
      }
    } else {
      // 无持仓：只在情绪明显正面时生成买入信号
      if (sentiment.score >= 30 && momentum.trend === 'improving') {
        action = 'BUY';
        reason = `短线：情绪正面 (${sentiment.score.toFixed(0)}) + 动量改善`;
        priority = 'MEDIUM';
        confidence = 0.7;
      }
      // 不再为情绪中性的股票生成买入信号
    }
  } else {
    // 长线策略
    const config = CONFIG.strategies.long_term;

    if (position) {
      if (sentimentTrend < config.sentiment_trend_threshold) {
        action = 'REDUCE';
        reason = `长线：30日情绪趋势负面 (${sentimentTrend.toFixed(1)})，建议降低权重${(config.weight_reduction * 100).toFixed(0)}%`;
        priority = 'MEDIUM';
        confidence = 0.7;
      }
    }
    // 长线不主动生成买入信号
  }

  return {
    symbol,
    action,
    type: 'sentiment',
    strategy_type: strategyType,
    reason,
    sentiment_score: sentiment.score,
    sentiment_trend: parseFloat(sentimentTrend.toFixed(1)),
    momentum: momentum.momentum,
    confidence,
    priority,
    created_at: new Date()
  };
}

/**
 * 保存信号到数据库
 */
async function saveSignal(signal: any): Promise<void> {
  try {
    await pool.query(`
      INSERT INTO sentiment_signals
      (symbol, action, type, reason, sentiment_score, momentum, confidence, priority, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      signal.symbol,
      signal.action,
      signal.type,
      signal.reason,
      signal.sentiment_score,
      signal.momentum,
      signal.confidence,
      signal.priority,
      signal.created_at
    ]);

    console.log(`✅ 信号已保存: ${signal.symbol} ${signal.action} (${signal.strategy_type}) - ${signal.reason}`);

    // 高优先级信号发送飞书通知
    if (signal.priority === 'HIGH') {
      const { sendFeishuText } = await import('../services/market/watcher/feishu-notify.js');
      const message = `🔔 [${signal.strategy_type === 'short_term' ? '短线' : '长线'}] ${signal.symbol} ${signal.action}\n${signal.reason}\n置信度: ${(signal.confidence * 100).toFixed(0)}%`;
      await sendFeishuText(message);
    }
  } catch (error) {
    console.error('保存信号失败:', error);
  }
}

/**
 * 运行一次监控检查
 */
async function runCheck(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log(`情绪监控检查 - ${new Date().toLocaleString('zh-CN')}`);
  console.log('='.repeat(60));

  try {
    // 获取监控列表
    const watchlist = await getWatchlist();
    console.log(`监控股票: ${watchlist.length} 只`);

    if (watchlist.length === 0) {
      console.log('⚠️  监控列表为空');
      return;
    }

    let signalCount = 0;

    // 逐个检查
    for (const symbol of watchlist) {
      try {
        const signal = await generateCompatibleSignal(symbol);

        // 只保存非 HOLD 信号
        if (signal.action !== 'HOLD') {
          await saveSignal(signal);
          signalCount++;
        }
      } catch (error) {
        console.error(`检查 ${symbol} 失败:`, error);
      }
    }

    console.log(`\n✅ 检查完成，生成 ${signalCount} 个信号`);
  } catch (error) {
    console.error('监控检查失败:', error);
  }
}

/**
 * 启动监控服务
 */
async function startMonitoring(): Promise<void> {
  console.log('🚀 情绪监控服务启动');
  console.log(`检查间隔: ${CONFIG.checkInterval / 1000 / 60} 分钟`);
  console.log(`短线策略: ${CONFIG.strategies.short_term.enabled ? '启用' : '禁用'}`);
  console.log(`长线策略: ${CONFIG.strategies.long_term.enabled ? '启用' : '禁用'}`);
  console.log();

  // 立即运行一次
  await runCheck();

  // 定时运行
  setInterval(async () => {
    await runCheck();
  }, CONFIG.checkInterval);

  console.log('\n✅ 监控服务运行中...');
}

// 启动
// if (import.meta.url === `file://${process.argv[1]}`) {
//   startMonitoring().catch(console.error);
// }

export { startMonitoring, runCheck, generateCompatibleSignal };
