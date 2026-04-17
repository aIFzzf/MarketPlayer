/**
 * 每日策略报告服务 - Daily Strategy Report (简化版)
 * 生成每日策略评分、交易信号、执行建议，并推送飞书摘要
 */

import * as fs from 'fs';
import pg from 'pg';
import { sendFeishuText } from '../src/services/market/watcher/feishu-notify';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://trading_user:password@localhost:5432/trading_bot'
});

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

interface StrategyResult {
  name: string;
  return: number;
  trades: number;
  win: number;
}

interface TradeSignal {
  symbol: string;
  action: string;
  strategy: string;
  confidence: number;
}

function calculateATR(klines: KLine[], period = 10): number[] {
  const atr: number[] = [];
  for (let i = 0; i < klines.length; i++) {
    if (i === 0) {
      atr.push(klines[i].high - klines[i].low);
      continue;
    }
    const tr = Math.max(
      klines[i].high - klines[i].low,
      Math.abs(klines[i].high - klines[i - 1].close),
      Math.abs(klines[i].low - klines[i - 1].close)
    );
    atr.push(i < period ? (atr.reduce((s, v) => s + v, 0) + tr) / (i + 1) : (atr[i - 1] * (period - 1) + tr) / period);
  }
  return atr;
}

function rsiStrategy(klines: KLine[]): number[] {
  const period = 14;
  const signals: number[] = [];
  for (let i = period; i < klines.length; i++) {
    const prices = klines.slice(i - period, i + 1).map(k => k.close);
    let gains = 0;
    let losses = 0;
    for (let j = 1; j < prices.length; j++) {
      const change = prices[j] - prices[j - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    const rsi = 100 - (100 / (1 + gains / (losses || 1)));
    signals.push(rsi < 35 ? 1 : rsi > 65 ? -1 : 0);
  }
  return signals;
}

function maCrossStrategy(klines: KLine[]): number[] {
  const shortPeriod = 5;
  const longPeriod = 20;
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

function bollingerStrategy(klines: KLine[]): number[] {
  const period = 20;
  const stdDev = 2;
  const signals: number[] = new Array(klines.length).fill(0);
  for (let i = period; i < klines.length; i++) {
    const slice = klines.slice(i - period, i).map(k => k.close);
    const mean = slice.reduce((s, p) => s + p, 0) / slice.length;
    const std = Math.sqrt(slice.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / slice.length);
    if (klines[i].close < mean - stdDev * std) signals[i] = 1;
    else if (klines[i].close > mean + stdDev * std) signals[i] = -1;
  }
  return signals;
}

function supertrendStrategy(klines: KLine[]): number[] {
  const atrPeriod = 10;
  const multiplier = 0.5;
  const signals: number[] = new Array(klines.length).fill(0);
  const atr = calculateATR(klines, atrPeriod);
  const initAvg = klines.slice(0, atrPeriod).reduce((s, k) => s + k.close, 0) / atrPeriod;
  let trend = klines[atrPeriod].close > initAvg ? 'UP' : 'DOWN';

  for (let i = atrPeriod; i < klines.length; i++) {
    const upper = ((klines[i].high + klines[i].low) / 2) + multiplier * atr[i];
    const lower = ((klines[i].high + klines[i].low) / 2) - multiplier * atr[i];
    if (klines[i].close > upper) {
      if (trend === 'DOWN') signals[i] = 1;
      trend = 'UP';
    } else if (klines[i].close < lower) {
      if (trend === 'UP') signals[i] = -1;
      trend = 'DOWN';
    }
  }
  return signals;
}

function runBacktest(klines: KLine[], signals: number[]) {
  const tradeKlines = klines.slice(klines.length - signals.length);
  let position = 0;
  let entry = 0;
  let trades = 0;
  let wins = 0;
  const returns: number[] = [];

  for (let i = 0; i < signals.length; i++) {
    const price = tradeKlines[i].close;
    if (signals[i] === 1 && position === 0) {
      position = 1;
      entry = price;
      trades++;
    } else if (signals[i] === -1 && position === 1) {
      returns.push((price - entry) / entry);
      if (price > entry) wins++;
      position = 0;
    }
  }

  const totalReturn = returns.reduce((s, r) => s + r, 0);
  return {
    return: totalReturn * 100,
    trades,
    win: trades > 0 ? wins / trades * 100 : 0,
  };
}

function loadKlines(symbol: string): KLine[] {
  const filePath = `${DATA_DIR}/us_${symbol}.json`;
  if (!fs.existsSync(filePath)) return [];
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return Array.isArray(data) ? data : data.klines || [];
}

function buildReportText(reportDate: string, strategyResults: StrategyResult[], signals: TradeSignal[]): string {
  const ranking = strategyResults
    .map((strategy, index) => `${index + 1}. ${strategy.name}: ${strategy.return.toFixed(1)}% 回报, ${strategy.trades} 笔交易, ${strategy.win.toFixed(0)}% 胜率`)
    .join('\n');

  const signalText = signals.length > 0
    ? signals.map(signal => `- ${signal.symbol}: ${signal.action} (${signal.strategy}, ${signal.confidence}%置信度)`).join('\n')
    : '- 今日无交易信号，保持当前持仓';

  const executionText = signals.length > 0
    ? `建议执行 ${signals.length} 个交易信号`
    : '建议保持当前持仓';

  return [
    `📊 每日策略报告 ${reportDate}`,
    '',
    '=== 策略评分 ===',
    ranking,
    '',
    `🏆 最优策略: ${strategyResults[0]?.name || 'N/A'}`,
    '',
    '=== 今日交易信号 ===',
    signalText,
    '',
    '=== 执行建议 ===',
    executionText,
  ].join('\n');
}

async function generateDailyReport() {
  console.log('📊 生成每日策略报告...\n');

  const STRATEGIES = [
    { id: 'rsi', name: 'RSI均值回归', fn: rsiStrategy },
    { id: 'ma_cross', name: '均线交叉', fn: maCrossStrategy },
    { id: 'bollinger', name: '布林带突破', fn: bollingerStrategy },
    { id: 'supertrend', name: 'Supertrend', fn: supertrendStrategy },
  ];

  const strategyResults: StrategyResult[] = [];

  console.log('=== 策略评分 ===\n');
  for (const strategy of STRATEGIES) {
    let totalReturn = 0;
    let totalTrades = 0;
    let totalWins = 0;
    for (const symbol of SYMBOLS) {
      const klines = loadKlines(symbol);
      if (klines.length < 100) continue;
      const result = runBacktest(klines.slice(-500), strategy.fn(klines.slice(-500)));
      totalReturn += result.return;
      totalTrades += result.trades;
      totalWins += result.win * result.trades / 100;
    }
    const avgReturn = totalReturn / SYMBOLS.length;
    const avgWin = totalTrades > 0 ? totalWins / totalTrades * 100 : 0;
    strategyResults.push({ name: strategy.name, return: avgReturn, trades: totalTrades, win: avgWin });
    console.log(`${strategy.name}: ${avgReturn.toFixed(1)}% 回报, ${totalTrades} 笔交易, ${avgWin.toFixed(0)}% 胜率`);
  }

  strategyResults.sort((a, b) => b.return - a.return);

  console.log('\n=== 今日交易信号 ===\n');
  const signals: TradeSignal[] = [];
  const bestStrategy = STRATEGIES.find(s => s.name === strategyResults[0]?.name) || STRATEGIES[0];

  for (const symbol of SYMBOLS) {
    const klines = loadKlines(symbol);
    if (klines.length < 100) continue;
    const signalsArr = bestStrategy.fn(klines.slice(-50));
    const lastSignal = signalsArr[signalsArr.length - 1];
    if (lastSignal !== 0) {
      const action = lastSignal === 1 ? 'BUY' : 'SELL';
      signals.push({ symbol, action, strategy: bestStrategy.name, confidence: 75 });
      console.log(`${symbol}: ${action} (置信度: 75%, 策略: ${bestStrategy.name})`);
    }
  }

  console.log('\n=== 执行建议 ===');
  if (signals.length > 0) {
    console.log(`建议执行 ${signals.length} 个交易信号`);
    for (const signal of signals) console.log(`- ${signal.symbol}: ${signal.action}`);
  } else {
    console.log('今日无交易信号，保持当前持仓');
  }

  const reportDate = new Date().toISOString().split('T')[0];
  const reportText = buildReportText(reportDate, strategyResults, signals);
  const logDir = './logs';

  try {
    await pool.query(
      `
      INSERT INTO learning_actions (action, details, created_at)
      VALUES ($1, $2, NOW())
    `,
      ['daily_report', JSON.stringify({ strategies: strategyResults, signals })]
    );
    console.log('✅ 报告已保存到数据库');
  } catch {
    // ignore
  }

  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(`${logDir}/daily-report.log`, `${reportText}\n\n`);

  try {
    const sent = await sendFeishuText(reportText);
    console.log(sent ? '✅ 飞书日报已发送' : '⚠️ 飞书日报未发送');
  } catch (error) {
    console.log('⚠️ 飞书日报发送失败:', error instanceof Error ? error.message : String(error));
  }

  return reportText;
}

generateDailyReport()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
