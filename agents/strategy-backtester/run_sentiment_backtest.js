/**
 * 情绪因子回测对比
 * 对比基准策略 vs 情绪增强策略
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trading_bot',
  user: 'zhengzefeng',
  password: 'password'
});

// 加载向量化回测引擎
const backtestEngine = require('../../src/backtest/vectorized-engine');

// 情绪阈值配置
const SENTIMENT_CONFIG = {
  // 短线策略
  short: {
    sell_threshold: -70,    // 情绪 < -70 时减仓
    wait_threshold: 70,     // 情绪 > 70 且 RSI > 70 时等待
    rsi_overbought: 70
  },
  // 长线策略
  long: {
    trend_threshold: -20,   // 30日情绪趋势 < -20 时降低权重
    weight_reduction: 0.3   // 降低30%权重
  }
};

/**
 * 获取情绪分数
 */
async function getSentimentScore(symbol, date) {
  const result = await pool.query(`
    SELECT score
    FROM sentiment_history
    WHERE symbol = $1
    AND DATE(created_at) = DATE($2)
    ORDER BY created_at DESC
    LIMIT 1
  `, [symbol, date]);

  return result.rows.length > 0 ? result.rows[0].score : 0;
}

/**
 * 获取情绪趋势（30日平均）
 */
async function getSentimentTrend(symbol, date, days = 30) {
  const result = await pool.query(`
    SELECT AVG(score) as avg_score
    FROM sentiment_history
    WHERE symbol = $1
    AND created_at BETWEEN $2::date - INTERVAL '${days} days' AND $2::date
  `, [symbol, date]);

  return result.rows.length > 0 && result.rows[0].avg_score
    ? parseFloat(result.rows[0].avg_score)
    : 0;
}

/**
 * 应用情绪过滤到交易信号
 */
async function applySentimentFilter(signals, klines, symbol) {
  const filteredSignals = [];

  for (let i = 0; i < signals.length; i++) {
    const signal = signals[i];
    const kline = klines[signal.index];
    const date = new Date(kline.timestamp);

    // 获取当日情绪
    const sentiment = await getSentimentScore(symbol, date);

    // 获取30日情绪趋势
    const sentimentTrend = await getSentimentTrend(symbol, date, 30);

    let action = signal.action;
    let reason = signal.reason;

    // 短线规则：情绪过滤
    if (action === 'BUY') {
      // 情绪极度负面时，不买入
      if (sentiment < SENTIMENT_CONFIG.short.sell_threshold) {
        action = 'WAIT';
        reason = `${reason} | 情绪极度负面(${sentiment})，等待改善`;
      }
      // 情绪正面但RSI超买，等待
      else if (sentiment > SENTIMENT_CONFIG.short.wait_threshold && signal.rsi > SENTIMENT_CONFIG.short.rsi_overbought) {
        action = 'WAIT';
        reason = `${reason} | 情绪过热(${sentiment}) + RSI超买(${signal.rsi.toFixed(1)})，等待回调`;
      }
    }

    // 持仓时，情绪极度负面触发卖出
    if (action === 'HOLD' && sentiment < SENTIMENT_CONFIG.short.sell_threshold) {
      action = 'SELL';
      reason = `情绪极度负面(${sentiment})，提前止损`;
    }

    // 长线规则：情绪趋势影响权重
    let weight = 1.0;
    if (sentimentTrend < SENTIMENT_CONFIG.long.trend_threshold) {
      weight = 1.0 - SENTIMENT_CONFIG.long.weight_reduction;
      reason = `${reason} | 情绪趋势负面(${sentimentTrend.toFixed(1)})，降低权重${(SENTIMENT_CONFIG.long.weight_reduction * 100).toFixed(0)}%`;
    }

    filteredSignals.push({
      ...signal,
      action,
      reason,
      sentiment,
      sentimentTrend: sentimentTrend.toFixed(1),
      weight
    });
  }

  return filteredSignals;
}

/**
 * 运行回测对比
 */
async function runBacktestComparison() {
  console.log('='.repeat(60));
  console.log('情绪因子回测对比');
  console.log('='.repeat(60));
  console.log();

  try {
    // 1. 选择测试股票（有足够情绪数据的股票）
    console.log('1. 选择测试股票...');
    const stocksResult = await pool.query(`
      SELECT symbol, COUNT(*) as count
      FROM sentiment_history
      WHERE symbol != 'MARKET'
      GROUP BY symbol
      HAVING COUNT(*) >= 50
      ORDER BY count DESC
      LIMIT 5
    `);

    const testSymbols = stocksResult.rows.map(r => r.symbol);
    console.log(`   测试股票: ${testSymbols.join(', ')}`);
    console.log(`   每只股票情绪记录数: ${stocksResult.rows.map(r => r.count).join(', ')}`);
    console.log();

    // 2. 加载K线数据
    console.log('2. 加载K线数据...');
    const allResults = {
      baseline: { totalTrades: 0, wins: 0, totalReturn: 0, sharpe: 0 },
      sentiment: { totalTrades: 0, wins: 0, totalReturn: 0, sharpe: 0 }
    };

    for (const symbol of testSymbols) {
      console.log(`\n   处理 ${symbol}...`);

      // 读取K线数据
      const dataPath = path.join(__dirname, '../../data/klines', `${symbol}.json`);
      if (!fs.existsSync(dataPath)) {
        console.log(`     跳过: 无K线数据`);
        continue;
      }

      const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      const klines = rawData.klines || rawData;

      if (!klines || klines.length < 100) {
        console.log(`     跳过: K线数据不足 (${klines ? klines.length : 0}条)`);
        continue;
      }

      // 3. 基准策略回测（纯技术指标）
      const baselineParams = {
        ma_short: 11,
        ma_long: 30,
        rsi_period: 14,
        rsi_oversold: 30,
        rsi_overbought: 70
      };

      const baselineResult = backtestEngine.runBacktest(klines, baselineParams);

      // 4. 情绪增强策略回测
      // 先生成基准信号，然后应用情绪过滤
      const sentimentSignals = await applySentimentFilter(
        baselineResult.signals || [],
        klines,
        symbol
      );

      // 重新计算收益（使用过滤后的信号）
      const sentimentResult = calculateReturns(klines, sentimentSignals);

      // 5. 汇总结果
      console.log(`     基准策略: ${baselineResult.trades}笔交易, 胜率${(baselineResult.winRate * 100).toFixed(1)}%, Sharpe ${baselineResult.sharpe.toFixed(2)}`);
      console.log(`     情绪策略: ${sentimentResult.trades}笔交易, 胜率${(sentimentResult.winRate * 100).toFixed(1)}%, Sharpe ${sentimentResult.sharpe.toFixed(2)}`);

      allResults.baseline.totalTrades += baselineResult.trades;
      allResults.baseline.wins += Math.round(baselineResult.trades * baselineResult.winRate);
      allResults.baseline.totalReturn += baselineResult.totalReturn || 0;

      allResults.sentiment.totalTrades += sentimentResult.trades;
      allResults.sentiment.wins += Math.round(sentimentResult.trades * sentimentResult.winRate);
      allResults.sentiment.totalReturn += sentimentResult.totalReturn || 0;
    }

    // 6. 总结对比
    console.log();
    console.log('='.repeat(60));
    console.log('回测对比总结');
    console.log('='.repeat(60));
    console.log();

    const baselineWinRate = allResults.baseline.totalTrades > 0
      ? (allResults.baseline.wins / allResults.baseline.totalTrades * 100).toFixed(1)
      : 0;
    const sentimentWinRate = allResults.sentiment.totalTrades > 0
      ? (allResults.sentiment.wins / allResults.sentiment.totalTrades * 100).toFixed(1)
      : 0;

    console.log('基准策略（纯技术指标）:');
    console.log(`  总交易次数: ${allResults.baseline.totalTrades}`);
    console.log(`  胜率: ${baselineWinRate}%`);
    console.log(`  总收益: ${(allResults.baseline.totalReturn * 100).toFixed(2)}%`);
    console.log();

    console.log('情绪增强策略（技术指标 + 情绪因子）:');
    console.log(`  总交易次数: ${allResults.sentiment.totalTrades}`);
    console.log(`  胜率: ${sentimentWinRate}%`);
    console.log(`  总收益: ${(allResults.sentiment.totalReturn * 100).toFixed(2)}%`);
    console.log();

    const winRateDiff = sentimentWinRate - baselineWinRate;
    const returnDiff = (allResults.sentiment.totalReturn - allResults.baseline.totalReturn) * 100;

    console.log('改进效果:');
    console.log(`  胜率变化: ${winRateDiff > 0 ? '+' : ''}${winRateDiff.toFixed(1)}%`);
    console.log(`  收益变化: ${returnDiff > 0 ? '+' : ''}${returnDiff.toFixed(2)}%`);
    console.log();

    // 7. 结论
    console.log('结论:');
    if (winRateDiff >= 2 || returnDiff >= 5) {
      console.log('  ✅ 情绪因子显著改善策略表现，建议启用');
    } else if (winRateDiff >= 0 && returnDiff >= 0) {
      console.log('  ⚠️  情绪因子略有改善，可以启用但需持续观察');
    } else {
      console.log('  ❌ 情绪因子未改善策略表现，暂不建议启用');
    }
    console.log();

    console.log('='.repeat(60));

  } catch (error) {
    console.error('回测错误:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

/**
 * 计算收益（简化版）
 */
function calculateReturns(klines, signals) {
  let trades = 0;
  let wins = 0;
  let totalReturn = 0;
  let position = null;

  for (const signal of signals) {
    if (signal.action === 'BUY' && !position) {
      position = {
        entryPrice: klines[signal.index].close,
        entryIndex: signal.index
      };
    } else if (signal.action === 'SELL' && position) {
      const exitPrice = klines[signal.index].close;
      const returnPct = (exitPrice - position.entryPrice) / position.entryPrice;
      totalReturn += returnPct;
      trades++;
      if (returnPct > 0) wins++;
      position = null;
    }
  }

  const winRate = trades > 0 ? wins / trades : 0;
  const avgReturn = trades > 0 ? totalReturn / trades : 0;
  const sharpe = avgReturn > 0 ? avgReturn / 0.02 : 0; // 简化计算

  return { trades, wins, winRate, totalReturn, sharpe };
}

// 运行回测
runBacktestComparison();
