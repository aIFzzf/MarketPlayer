/**
 * 因子计算引擎
 * 支持动量、价值、质量、波动率、流动性5大类因子
 */

import * as fs from 'fs';
import * as path from 'path';

// 数据目录
const KLINES_DIR = path.join(process.cwd(), 'data', 'cache', 'klines');
const FUNDAMENTAL_DIR = path.join(process.cwd(), 'data', 'fundamental');

export interface KLineData {
  close: number[];
  open: number[];
  high: number[];
  low: number[];
  volume: number[];
}

export interface FactorResult {
  symbol: string;
  date: string;
  factors: Record<string, number>;
}

/**
 * 加载K线数据
 */
export function loadKLines(symbol: string): KLineData | null {
  const filePaths = [
    path.join(KLINES_DIR, `us_${symbol}.json`),
    path.join(KLINES_DIR, `hk_${symbol}.json`),
    path.join(KLINES_DIR, `a_${symbol}.json`),
  ];
  
  for (const filePath of filePaths) {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const klines = data.klines || data;
      
      return {
        close: klines.map((k: any) => parseFloat(k.close || k.c)),
        open: klines.map((k: any) => parseFloat(k.open || k.o)),
        high: klines.map((k: any) => parseFloat(k.high || k.h)),
        low: klines.map((k: any) => parseFloat(k.low || k.l)),
        volume: klines.map((k: any) => parseFloat(k.volume || k.v)),
      };
    }
  }
  return null;
}

/**
 * 加载财务数据
 */
export function loadFundamental(symbol: string): Record<string, any> | null {
  const filePath = path.join(FUNDAMENTAL_DIR, `${symbol}_fundamental.json`);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  return null;
}

// ==================== 动量因子 ====================

/**
 * 动量因子：N日收益率
 */
export function momentumFactor(close: number[], period: number): number {
  if (close.length < period + 1) return 0;
  return close[close.length - 1] / close[close.length - period - 1] - 1;
}

/**
 * RSI 因子
 */
export function rsiFactor(close: number[], period: number = 14): number {
  if (close.length < period + 1) return 0;
  
  let gains = 0, losses = 0;
  for (let i = close.length - period; i < close.length; i++) {
    const change = close[i] - close[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * MACD 因子
 * 返回: { macd, signal, histogram }
 */
export function macdFactor(close: number[], fast: number = 12, slow: number = 26, signal: number = 9): { macd: number; signal: number; histogram: number } {
  if (close.length < slow + signal) {
    return { macd: 0, signal: 0, histogram: 0 };
  }
  
  // 计算EMA
  const ema = (data: number[], p: number): number => {
    const k = 2 / (p + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  };
  
  const emaFast = ema(close, fast);
  const emaSlow = ema(close, slow);
  const macdLine = emaFast - emaSlow;
  const signalLine = ema([macdLine], signal);
  const histogram = macdLine - signalLine;
  
  return { macd: macdLine, signal: signalLine, histogram };
}

// ==================== 价值因子 ====================

/**
 * PE 因子
 */
export function peFactor(fundamental: Record<string, any>, currentPrice: number): number {
  const eps = fundamental?.eps || 0;
  if (eps === 0) return 0;
  return currentPrice / eps;
}

/**
 * PB 因子
 */
export function pbFactor(fundamental: Record<string, any>, currentPrice: number): number {
  const bookValue = fundamental?.bookValuePerShare || 0;
  if (bookValue === 0) return 0;
  return currentPrice / bookValue;
}

/**
 * PS 因子
 */
export function psFactor(fundamental: Record<string, any>, currentPrice: number): number {
  const revenuePerShare = fundamental?.revenuePerShare || 0;
  if (revenuePerShare === 0) return 0;
  return currentPrice / revenuePerShare;
}

/**
 * PCF 因子
 */
export function pcfFactor(fundamental: Record<string, any>, currentPrice: number): number {
  const cfps = fundamental?.cashFlowPerShare || 0;
  if (cfps === 0) return 0;
  return currentPrice / cfps;
}

/**
 * EV/EBITDA 因子
 */
export function evEbitdaFactor(fundamental: Record<string, any>): number {
  const ebitda = fundamental?.ebitda || 0;
  const ev = fundamental?.enterpriseValue || 0;
  if (ebitda === 0) return 0;
  return ev / ebitda;
}

// ==================== 质量因子 ====================

/**
 * ROE 因子
 */
export function roeFactor(fundamental: Record<string, any>): number {
  return fundamental?.roe || 0;
}

/**
 * ROA 因子
 */
export function roaFactor(fundamental: Record<string, any>): number {
  return fundamental?.roa || 0;
}

/**
 * 毛利率因子
 */
export function grossMarginFactor(fundamental: Record<string, any>): number {
  return fundamental?.grossMargin || 0;
}

/**
 * 资产负债率因子
 */
export function debtRatioFactor(fundamental: Record<string, any>): number {
  return fundamental?.debtRatio || 0;
}

/**
 * 流动比率因子
 */
export function currentRatioFactor(fundamental: Record<string, any>): number {
  return fundamental?.currentRatio || 0;
}

// ==================== 波动率因子 ====================

/**
 * 波动率因子
 */
export function volatilityFactor(close: number[], period: number = 20): number {
  if (close.length < period + 1) return 0;
  
  const returns: number[] = [];
  for (let i = close.length - period; i < close.length; i++) {
    returns.push((close[i] - close[i - 1]) / close[i - 1]);
  }
  
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  
  return Math.sqrt(variance);
}

/**
 * ATR 因子
 */
export function atrFactor(high: number[], low: number[], close: number[], period: number = 14): number {
  if (close.length < period + 1) return 0;
  
  const tr: number[] = [];
  for (let i = 1; i < close.length; i++) {
    const h_l = high[i] - low[i];
    const h_c = Math.abs(high[i] - close[i - 1]);
    const l_c = Math.abs(low[i] - close[i - 1]);
    tr.push(Math.max(h_l, h_c, l_c));
  }
  
  return tr.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ==================== 流动性因子 ====================

/**
 * 换手率因子
 */
export function turnoverFactor(volume: number[], period: number = 20): number {
  if (volume.length < period) return 0;
  
  const avgVolume = volume.slice(-period).reduce((a, b) => a + b, 0) / period;
  const currentVolume = volume[volume.length - 1];
  
  if (avgVolume === 0) return 0;
  return currentVolume / avgVolume;
}

/**
 * 量比因子
 */
export function volumeRatioFactor(volume: number[]): number {
  if (volume.length < 6) return 0;
  
  const avg5 = volume.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const current = volume[volume.length - 1];
  
  if (avg5 === 0) return 0;
  return current / avg5;
}

// ==================== 主函数：计算单只股票所有因子 ====================

/**
 * 计算单只股票所有因子
 */
export function calculateAllFactors(symbol: string): FactorResult | null {
  const klines = loadKLines(symbol);
  if (!klines || klines.close.length < 50) {
    return null;
  }
  
  const fundamental = loadFundamental(symbol);
  const currentPrice = klines.close[klines.close.length - 1];
  
  const factors: Record<string, number> = {};
  
  // 动量因子
  factors.MOM_20 = momentumFactor(klines.close, 20);
  factors.MOM_60 = momentumFactor(klines.close, 60);
  factors.MOM_120 = momentumFactor(klines.close, 120);
  factors.RSI_14 = rsiFactor(klines.close, 14);
  const macd = macdFactor(klines.close);
  factors.MACD = macd.histogram;
  
  // 价值因子
  if (fundamental) {
    factors.PE = peFactor(fundamental, currentPrice);
    factors.PB = pbFactor(fundamental, currentPrice);
    factors.PS = psFactor(fundamental, currentPrice);
    factors.PCF = pcfFactor(fundamental, currentPrice);
    factors.EV_EBITDA = evEbitdaFactor(fundamental);
    
    // 质量因子
    factors.ROE = roeFactor(fundamental);
    factors.ROA = roaFactor(fundamental);
    factors.GROSS_MARGIN = grossMarginFactor(fundamental);
    factors.DEBT_RATIO = debtRatioFactor(fundamental);
    factors.CURRENT_RATIO = currentRatioFactor(fundamental);
  }
  
  // 波动率因子
  factors.VOL_20 = volatilityFactor(klines.close, 20);
  factors.VOL_60 = volatilityFactor(klines.close, 60);
  factors.ATR_14 = atrFactor(klines.high, klines.low, klines.close, 14);
  
  // 流动性因子
  factors.TURNOVER_20 = turnoverFactor(klines.volume, 20);
  factors.VOLUME_RATIO = volumeRatioFactor(klines.volume);
  
  return {
    symbol,
    date: new Date().toISOString().split('T')[0],
    factors,
  };
}

/**
 * 批量计算多只股票因子
 */
export function calculateBatchFactors(symbols: string[]): FactorResult[] {
  const results: FactorResult[] = [];
  
  for (const symbol of symbols) {
    const result = calculateAllFactors(symbol);
    if (result) {
      results.push(result);
    }
  }
  
  return results;
}

// 直接运行测试
if (require.main === module) {
  const testSymbols = ['AAPL', 'MSFT', 'GOOGL'];
  
  console.log(`[factors] 计算 ${testSymbols.length} 只股票因子...`);
  
  const start = Date.now();
  const results = calculateBatchFactors(testSymbols);
  const elapsed = Date.now() - start;
  
  console.log(`[factors] 完成: ${results.length} 只, 耗时 ${elapsed}ms`);
  
  if (results.length > 0) {
    console.log('Sample (AAPL):');
    console.log(JSON.stringify(results[0].factors, null, 2));
  }
}

export default calculateAllFactors;