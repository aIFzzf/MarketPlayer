/**
 * 动量因子计算模块
 * 实现5个核心动量因子
 */

export interface Kline {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MomentumFactors {
  MOM_20: number;   // 20日动量 (%)
  MOM_60: number;   // 60日动量 (%)
  RSI_14: number;   // 14日RSI
  VOL_20: number;   // 20日波动率（年化%）
  ATR_14: number;   // 14日平均真实波动幅度
}

/**
 * 计算动量因子
 * @param klines K线数据数组（至少需要120条）
 * @returns 动量因子对象
 */
export function calculateMomentum(klines: Kline[]): MomentumFactors {
  if (klines.length < 120) {
    throw new Error('至少需要120条K线数据');
  }

  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const len = closes.length;

  // 1. MOM_20: 20日动量
  const mom20 = ((closes[len - 1] / closes[len - 21]) - 1) * 100;

  // 2. MOM_60: 60日动量
  const mom60 = ((closes[len - 1] / closes[len - 61]) - 1) * 100;

  // 3. RSI_14: 14日相对强弱指标
  let gains = 0;
  let losses = 0;
  for (let i = len - 14; i < len; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses -= change;
    }
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  const rs = avgGain / (avgLoss || 0.0001);
  const rsi14 = 100 - (100 / (1 + rs));

  // 4. VOL_20: 20日波动率（年化）
  const returns: number[] = [];
  for (let i = len - 20; i < len; i++) {
    returns.push((closes[i] / closes[i - 1]) - 1);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  const vol20 = Math.sqrt(variance) * Math.sqrt(252) * 100;

  // 5. ATR_14: 14日平均真实波动幅度
  let atrSum = 0;
  for (let i = len - 14; i < len; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    atrSum += tr;
  }
  const atr14 = atrSum / 14;

  return {
    MOM_20: parseFloat(mom20.toFixed(2)),
    MOM_60: parseFloat(mom60.toFixed(2)),
    RSI_14: parseFloat(rsi14.toFixed(2)),
    VOL_20: parseFloat(vol20.toFixed(2)),
    ATR_14: parseFloat(atr14.toFixed(2))
  };
}

/**
 * 批量计算多只股票的动量因子
 */
export function calculateMomentumBatch(stocksData: { symbol: string; klines: Kline[] }[]): Map<string, MomentumFactors> {
  const results = new Map<string, MomentumFactors>();

  for (const { symbol, klines } of stocksData) {
    try {
      const factors = calculateMomentum(klines);
      results.set(symbol, factors);
    } catch (error) {
      console.error(`计算 ${symbol} 因子失败:`, error);
    }
  }

  return results;
}
