/**
 * 情绪增强多策略学习闭环 - Sentiment-Enhanced Multi-Strategy Learning
 * 
 * 对比两组策略：
 * 1. 纯技术策略（RSI/MA/Bollinger）
 * 2. 情绪增强策略（技术 + 情绪过滤）
 */

import * as fs from 'fs';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://trading_user:password@localhost:5432/trading_bot' });

const DATA_DIR = '/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/data/cache/klines';
const SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA'];

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

// 评分权重
const SCORE_WEIGHTS = { return: 0.30, winRate: 0.20, sharpe: 0.25, drawdown: 0.25 };

function calculateScore(perf: Partial<StrategyScore>): number {
  const returnScore = Math.min(100, Math.max(0, (perf.totalReturn || 0) * 10));
  const winScore = (perf.winRate || 0) * 100;
  const sharpeScore = Math.min(100, Math.max(0, ((perf.sharpeRatio || 0) / 3 * 100)));
  const drawdownScore = Math.max(0, 100 - (perf.maxDrawdown || 0) * 2);
  return returnScore * SCORE_WEIGHTS.return + winScore * SCORE_WEIGHTS.winRate +
    sharpeScore * SCORE_WEIGHTS.sharpe + drawdownScore * SCORE_WEIGHTS.drawdown;
}

function getRecommendation(score: number, trades: number): 'keep' | 'optimize' | 'remove' {
  if (score >= 60 && trades >= 10) return 'keep';
  if (score >= 40) return 'optimize';
  return 'remove';
}

// ==================== 读取情绪数据 ====================
const sentimentCache: Map<string, number> = new Map();

async function loadSentimentData() {
  const result = await pool.query(`
    SELECT symbol, AVG(score) as avg_score
    FROM sentiment_history
    WHERE created_at > NOW() - INTERVAL '30 days'
    GROUP BY symbol
  `);
  
  for (const row of result.rows) {
    sentimentCache.set(row.symbol, parseFloat(row.avg_score) / 100); // 归一化到 -1 到 1
  }
  console.log(`📊 已加载 ${sentimentCache.size} 只股票的情绪数据`);
}

// ==================== 策略1: RSI ====================
function rsiStrategy(klines: KLine[]): number[] {
  const period = 14;
  const signals: number[] = [];
  for (let i = period; i < klines.length; i++) {
    const prices = klines.slice(i - period, i + 1).map(k => k.close);
    let gains = 0, losses = 0;
    for (let j = 1; j < prices.length; j++) {
      const change = prices[j] - prices[j - 1];
      if (change > 0) gains += change; else losses -= change;
    }
    const rsi = 100 - (100 / (1 + gains / (losses || 1)));
    signals.push(rsi < 30 ? 1 : rsi > 70 ? -1 : 0);
  }
  return signals;
}

// ==================== 策略2: MA Cross ====================
function maCrossStrategy(klines: KLine[]): number[] {
  const shortPeriod = 5, longPeriod = 20;
  const signals: number[] = new Array(klines.length).fill(0);
  for (let i = longPeriod; i < klines.length; i++) {
    const shortMA = klines.slice(i - shortPeriod, i).reduce((s, k) => s + k.close, 0) / shortPeriod;
    const longMA = klines.slice(i - longPeriod, i).reduce((s, k) => s + k.close, 0) / longPeriod;
    const prevShortMA = klines.slice(i - shortPeriod - 1, i - 1).reduce((s, k) => s + k.close, 0) / shortPeriod;
    const prevLongMA = klines.slice(i - longPeriod - 1, i - 1).reduce((s, k) => s + k.close, 0) / longPeriod;
    if (prevShortMA <= prevLongMA && shortMA > longMA) signals[i] = 1;
    else if (prevShortMA >= prevLongMA && shortMA < longMA) signals[i] = -1;
  }
  return signals;
}

// ==================== 策略3: Bollinger ====================
function bollingerStrategy(klines: KLine[]): number[] {
  const period = 20, stdDev = 2;
  const signals: number[] = new Array(klines.length).fill(0);
  for (let i = period; i < klines.length; i++) {
    const slice = klines.slice(i - period, i).map(k => k.close);
    const mean = slice.reduce((s, p) => s + p, 0) / slice.length;
    const variance = slice.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / slice.length;
    const std = Math.sqrt(variance);
    const upper = mean + stdDev * std;
    const lower = mean - stdDev * std;
    const currentClose = klines[i].close;
    if (currentClose < lower) signals[i] = 1;
    else if (currentClose > upper) signals[i] = -1;
  }
  return signals;
}

// ==================== 情绪增强策略 ====================
function sentimentEnhancedStrategy(klines: KLine[], baseStrategy: (k: KLine[]) => number[], symbol: string, enhance: boolean): number[] {
  if (!enhance) return baseStrategy(klines);
  
  const baseSignals = baseStrategy(klines);
  const sentiment = sentimentCache.get(symbol) || 0; // -1 到 1
  
  const enhanced: number[] = [];
  for (let i = 0; i < baseSignals.length; i++) {
    const signal = baseSignals[i];
    
    if (signal === 1) { // 买入信号
      if (sentiment > 0.3) {
        enhanced.push(1); // 情绪正面，增强买入
      } else if (sentiment < -0.3) {
        enhanced.push(0); // 情绪负面，忽略买入信号
      } else {
        enhanced.push(1);
      }
    } else if (signal === -1) {
      if (sentiment < -0.3) {
        enhanced.push(-1); // 情绪负面，加速卖出
      } else if (sentiment > 0.3) {
        enhanced.push(0); // 情绪正面，延迟卖出
      } else {
        enhanced.push(-1);
      }
    } else {
      enhanced.push(0);
    }
  }
  
  return enhanced;
}

// ==================== 回测 ====================
function runBacktest(klines: KLine[], signals: number[]): StrategyScore {
  const tradeKlines = klines.slice(klines.length - signals.length);
  let position = 0, entryPrice = 0, maxDrawdown = 0, peakEquity = 1, trades = 0, wins = 0;
  const returns: number[] = [];
  
  for (let i = 0; i < signals.length; i++) {
    const price = tradeKlines[i].close;
    if (signals[i] === 1 && position === 0) { position = 1; entryPrice = price; trades++; }
    else if (signals[i] === -1 && position === 1) {
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
  const stdReturn = returns.length > 1 ? Math.sqrt(returns.map(r => Math.pow(r - avgReturn, 2)).reduce((s, v) => s + v, 0) / returns.length) : 0;
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;
  const score = calculateScore({ totalReturn, annualReturn, maxDrawdown, winRate, sharpeRatio, totalTrades: trades });
  
  return { strategyId: '', strategyName: '', totalReturn, annualReturn, maxDrawdown, winRate, sharpeRatio, totalTrades: trades, score, recommendation: getRecommendation(score, trades) };
}

function loadKlines(symbol: string): KLine[] {
  const filePath = `${DATA_DIR}/us_${symbol}.json`;
  if (!fs.existsSync(filePath)) return [];
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return Array.isArray(data) ? data : data.klines || [];
}

// ==================== 主函数 ====================
async function runSentimentEnhancedLearning() {
  // 加载情绪数据
  await loadSentimentData();
  
  const STRATEGIES = [
    { id: 'rsi', name: 'RSI', fn: rsiStrategy },
    { id: 'ma_cross', name: '均线交叉', fn: maCrossStrategy },
    { id: 'bollinger', name: '布林带', fn: bollingerStrategy },
  ];
  
  const results: { base: StrategyScore; enhanced: StrategyScore; symbol: string; strategy: string }[] = [];
  
  console.log('\n🔄 情绪增强策略对比测试\n');
  
  for (const strategy of STRATEGIES) {
    console.log(`📊 策略: ${strategy.name}`);
    
    for (const symbol of SYMBOLS) {
      const klines = loadKlines(symbol);
      if (klines.length < 100) continue;
      
      const recentKlines = klines.slice(-500);
      
      // 纯技术策略
      const baseSignals = strategy.fn(recentKlines);
      const baseResult = runBacktest(recentKlines, baseSignals);
      baseResult.strategyId = strategy.id;
      baseResult.strategyName = strategy.name;
      
      // 情绪增强策略
      const enhancedSignals = sentimentEnhancedStrategy(recentKlines, strategy.fn, symbol, true);
      const enhancedResult = runBacktest(recentKlines, enhancedSignals);
      enhancedResult.strategyId = `${strategy.id}_sentiment`;
      enhancedResult.strategyName = `${strategy.name}+情绪`;
      
      results.push({ base: baseResult, enhanced: enhancedResult, symbol, strategy: strategy.name });
      
      console.log(`  ${symbol}:`);
      console.log(`    技术: ${(baseResult.totalReturn * 100).toFixed(1)}% return, ${baseResult.totalTrades} trades, ${(baseResult.winRate * 100).toFixed(0)}% win`);
      console.log(`    情绪增强: ${(enhancedResult.totalReturn * 100).toFixed(1)}% return, ${enhancedResult.totalTrades} trades, ${(enhancedResult.winRate * 100).toFixed(0)}% win`);
      console.log(`    差异: ${((enhancedResult.totalReturn - baseResult.totalReturn) * 100).toFixed(1)}%`);
    }
  }
  
  // 聚合结果
  console.log('\n=== 聚合对比结果 ===\n');
  
  for (const strategy of STRATEGIES) {
    const strategyResults = results.filter(r => r.strategy === strategy.name);
    if (strategyResults.length === 0) continue;
    
    const baseAvg = strategyResults.reduce((acc, r) => ({
      return: acc.return + r.base.totalReturn,
      trades: acc.trades + r.base.totalTrades,
      wins: acc.wins + r.base.winRate * r.base.totalTrades,
    }), { return: 0, trades: 0, wins: 0 });
    
    const enhancedAvg = strategyResults.reduce((acc, r) => ({
      return: acc.return + r.enhanced.totalReturn,
      trades: acc.trades + r.enhanced.totalTrades,
      wins: acc.wins + r.enhanced.winRate * r.enhanced.totalTrades,
    }), { return: 0, trades: 0, wins: 0 });
    
    const baseReturn = baseAvg.return / strategyResults.length;
    const enhancedReturn = enhancedAvg.return / strategyResults.length;
    const baseWin = baseAvg.trades > 0 ? baseAvg.wins / baseAvg.trades : 0;
    const enhancedWin = enhancedAvg.trades > 0 ? enhancedAvg.wins / enhancedAvg.trades : 0;
    
    console.log(`${strategy.name}:`);
    console.log(`  技术: ${(baseReturn * 100).toFixed(1)}%, 胜率 ${(baseWin * 100).toFixed(0)}%`);
    console.log(`  情绪增强: ${(enhancedReturn * 100).toFixed(1)}%, 胜率 ${(enhancedWin * 100).toFixed(0)}%`);
    console.log(`  收益率变化: ${((enhancedReturn - baseReturn) * 100).toFixed(1)}%`);
  }
  
  await pool.end();
  return results;
}

runSentimentEnhancedLearning()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });