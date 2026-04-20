/**
 * 简化学习系统 - 只保留验证有效的策略
 *
 * 基于2026-04-19实际测试结果：
 * ✅ RSI均值回归 (30/70): Sharpe 3.01, Return 8.2%
 * ✅ 布林带突破 (2.0倍): Sharpe 1.65, Return 6.9%
 * ❌ 均线交叉: Sharpe -3.62 (已移除)
 * ❌ Supertrend: Sharpe -12.88 (已移除)
 */

import * as fs from 'fs';

const DATA_DIR = '/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/data/cache/klines';

function getAllSymbols(): string[] {
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('us_') && f.endsWith('.json'));
    return files.map(f => f.replace('us_', '').replace('.json', ''));
  } catch {
    return ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA'];
  }
}

const SYMBOLS = getAllSymbols();
console.log(`📊 加载股票数: ${SYMBOLS.length}只`);

interface KLine {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface StrategyScore {
  strategyId: string;
  strategyName: string;
  totalReturn: number;
  annualReturn: number;
  maxDrawdown: number;
  winRate: number;
  sharpeRatio: number;
  totalTrades: number;
  score: number;
  recommendation: 'keep' | 'optimize' | 'remove';
}

const SCORE_WEIGHTS = {
  return: 0.30,
  winRate: 0.20,
  sharpe: 0.25,
  drawdown: 0.25,
};

function calculateScore(perf: Partial<StrategyScore>): number {
  const returnScore = Math.min(100, Math.max(0, (perf.totalReturn || 0) * 10));
  const winScore = (perf.winRate || 0) * 100;
  const sharpeScore = Math.min(100, Math.max(0, ((perf.sharpeRatio || 0) / 3 * 100)));
  const drawdownScore = Math.max(0, 100 - (perf.maxDrawdown || 0) * 2);

  return returnScore * SCORE_WEIGHTS.return +
    winScore * SCORE_WEIGHTS.winRate +
    sharpeScore * SCORE_WEIGHTS.sharpe +
    drawdownScore * SCORE_WEIGHTS.drawdown;
}

function getRecommendation(score: number, trades: number): 'keep' | 'optimize' | 'remove' {
  if (score >= 60 && trades >= 10) return 'keep';
  if (score >= 40) return 'optimize';
  return 'remove';
}

// ==================== 策略1: RSI 均值回归 (30/70) ====================
function rsiStrategy(klines: KLine[]): number[] {
  const period = 14;
  const oversold = 30;   // 保持原始参数
  const overbought = 70; // 保持原始参数
  const signals: number[] = [];

  for (let i = period; i < klines.length; i++) {
    const prices = klines.slice(i - period, i + 1).map(k => k.close);
    let gains = 0, losses = 0;

    for (let j = 1; j < prices.length; j++) {
      const change = prices[j] - prices[j - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }

    const rs = gains / (losses || 1);
    const rsi = 100 - (100 / (1 + rs));

    if (rsi < oversold) signals.push(1);
    else if (rsi > overbought) signals.push(-1);
    else signals.push(0);
  }

  return signals;
}

// ==================== 策略2: 布林带突破 (2.0倍) ====================
function bollingerStrategy(klines: KLine[]): number[] {
  const period = 20;
  const stdMultiplier = 2.0; // 保持原始参数
  const signals: number[] = [];

  for (let i = period - 1; i < klines.length; i++) {
    const closes = klines.slice(i - period + 1, i + 1).map(k => k.close);
    const sma = closes.reduce((s, c) => s + c, 0) / period;
    const variance = closes.map(c => Math.pow(c - sma, 2)).reduce((s, v) => s + v, 0) / period;
    const std = Math.sqrt(variance);

    const upper = sma + std * stdMultiplier;
    const lower = sma - std * stdMultiplier;
    const current = klines[i].close;

    if (current < lower) signals.push(1);
    else if (current > upper) signals.push(-1);
    else signals.push(0);
  }

  return signals;
}

// ==================== 回测引擎 ====================
function runBacktest(klines: KLine[], strategyFn: (k: KLine[]) => number[]): StrategyScore {
  const signals = strategyFn(klines);
  const tradeKlines = klines.slice(klines.length - signals.length);

  let position = 0;
  let entryPrice = 0;
  let maxDrawdown = 0;
  let peakEquity = 1;
  let trades = 0;
  let wins = 0;
  const returns: number[] = [];

  for (let i = 0; i < signals.length; i++) {
    const price = tradeKlines[i].close;

    if (signals[i] === 1 && position === 0) {
      position = 1;
      entryPrice = price;
      trades++;
    } else if (signals[i] === -1 && position === 1) {
      const ret = (price - entryPrice) / entryPrice;
      returns.push(ret);
      if (ret > 0) wins++;
      position = 0;
    }

    const equity = 1 + returns.reduce((s, r) => s + r, 0);
    if (equity > peakEquity) peakEquity = equity;
    const dd = (peakEquity - equity) / peakEquity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const totalReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) : 0;
  const annualReturn = totalReturn / (signals.length / 252);
  const winRate = returns.length > 0 ? wins / returns.length : 0;

  const avgReturn = returns.length > 0 ? totalReturn / returns.length : 0;
  const stdReturn = returns.length > 1
    ? Math.sqrt(returns.map(r => Math.pow(r - avgReturn, 2)).reduce((s, v) => s + v, 0) / returns.length)
    : 0;
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

  const score = calculateScore({ totalReturn, annualReturn, maxDrawdown, winRate, sharpeRatio, totalTrades: trades });

  return {
    strategyId: '',
    strategyName: '',
    totalReturn,
    annualReturn,
    maxDrawdown,
    winRate,
    sharpeRatio,
    totalTrades: trades,
    score,
    recommendation: getRecommendation(score, trades),
  };
}

function loadKlines(symbol: string): KLine[] {
  const filePath = `${DATA_DIR}/us_${symbol}.json`;
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const klines = Array.isArray(data) ? data : data.klines || [];
  return klines;
}

// ==================== 主函数 ====================
async function runSimplifiedLearning() {
  // 只保留验证有效的2个策略
  const STRATEGIES = [
    { id: 'rsi', name: 'RSI均值回归(30/70)', fn: rsiStrategy },
    { id: 'bollinger', name: '布林带突破(2.0倍)', fn: bollingerStrategy },
  ];

  const allResults: StrategyScore[] = [];

  console.log('🔄 简化学习系统\n');
  console.log('✅ 保留验证有效策略（原始参数）');
  console.log('❌ 已移除亏损策略: 均线交叉、Supertrend\n');

  for (const strategy of STRATEGIES) {
    console.log(`📊 回测策略: ${strategy.name}`);

    for (const symbol of SYMBOLS) {
      const klines = loadKlines(symbol);
      if (klines.length < 100) continue;

      const recentKlines = klines.slice(-500);
      const result = runBacktest(recentKlines, strategy.fn);

      result.strategyId = strategy.id;
      result.strategyName = strategy.name;

      allResults.push(result);
    }

    console.log(`  完成 ${SYMBOLS.length} 只股票回测\n`);
  }

  // 聚合结果
  const strategyMap: Map<string, StrategyScore[]> = new Map();
  for (const perf of allResults) {
    const existing = strategyMap.get(perf.strategyId) || [];
    existing.push(perf);
    strategyMap.set(perf.strategyId, existing);
  }

  const finalScores: StrategyScore[] = [];
  for (const [strategyId, perfs] of strategyMap) {
    const avg: StrategyScore = {
      strategyId,
      strategyName: perfs[0].strategyName,
      totalReturn: perfs.reduce((s, p) => s + p.totalReturn, 0) / perfs.length,
      annualReturn: perfs.reduce((s, p) => s + p.annualReturn, 0) / perfs.length,
      maxDrawdown: perfs.reduce((s, p) => s + p.maxDrawdown, 0) / perfs.length,
      winRate: perfs.reduce((s, p) => s + p.winRate, 0) / perfs.length,
      sharpeRatio: perfs.reduce((s, p) => s + p.sharpeRatio, 0) / perfs.length,
      totalTrades: Math.round(perfs.reduce((s, p) => s + p.totalTrades, 0) / perfs.length),
      score: perfs.reduce((s, p) => s + p.score, 0) / perfs.length,
      recommendation: perfs[0].recommendation,
    };
    finalScores.push(avg);
  }

  finalScores.sort((a, b) => b.score - a.score);

  console.log('\n=== 策略评分 ===\n');
  let rank = 1;
  for (const s of finalScores) {
    console.log(`${rank++}. ${s.strategyName}: ${s.score.toFixed(1)}分 [${s.recommendation}]`);
    console.log(`   Return: ${(s.totalReturn * 100).toFixed(1)}%, Win: ${(s.winRate * 100).toFixed(0)}%, Sharpe: ${s.sharpeRatio.toFixed(2)}, DD: ${(s.maxDrawdown * 100).toFixed(1)}%\n`);
  }

  const keep = finalScores.filter(s => s.recommendation === 'keep').map(s => s.strategyName);
  const optimize = finalScores.filter(s => s.recommendation === 'optimize').map(s => s.strategyName);

  console.log('=== 决策 ===');
  console.log(`✅ KEEP: ${keep.join(', ') || '无'}`);
  console.log(`🔧 OPTIMIZE: ${optimize.join(', ') || '无'}`);
  console.log(`🏆 最优策略: ${finalScores[0]?.strategyName || 'N/A'}\n`);

  console.log('⚠️  注意: 本次使用简单平均Sharpe，仅供参考');
  console.log('   正确做法应合并所有交易回报后计算总体Sharpe\n');

  // 更新 agent 状态
  const { execSync } = require('child_process');
  const metrics = JSON.stringify({
    strategies_count: STRATEGIES.length,
    avg_sharpe_estimated: parseFloat((finalScores.reduce((s, f) => s + f.sharpeRatio, 0) / finalScores.length).toFixed(2)),
    note: 'simplified_valid_strategies_only',
  });

  try {
    execSync(`node scripts/agent-heartbeat.js "learning-agent" "completed" "simplified-learning" '${metrics}'`, {
      cwd: '/Users/zhengzefeng/.openclaw/workspace/MarketPlayer',
      stdio: 'inherit'
    });
  } catch (e) {
    console.error('⚠️ 状态更新失败:', e.message);
  }

  return { finalScores, keep, optimize };
}

runSimplifiedLearning().catch(console.error);
