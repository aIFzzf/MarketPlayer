/**
 * 策略偏离检测器
 * 监控策略实际表现与预期的偏差
 */

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://zhengzefeng:password@localhost:5432/trading_bot'
});

// 预期指标配置 (从配置文件或 MEMORY.md)
const EXPECTED_METRICS = {
  win_rate: 55.0,    // 预期胜率 55%
  sharpe_ratio: 2.5, // 预期 Sharpe 2.5
  max_drawdown: 0.15  // 预期最大回撤 15%
};

// 偏差阈值
const THRESHOLDS = {
  win_rate_deviation: 0.10,   // 胜率偏差 > 10%
  sharpe_deviation: 0.20,     // Sharpe 偏差 > 20%
  drawdown_excess: 0.05      // 回撤超出 > 5%
};

/**
 * 主函数：检测策略偏离
 */
export async function detectStrategyDrift(): Promise<{
  detected: number;
  anomalies: any[];
}> {
  console.log('[strategy-drift] 检测策略偏离...');
  
  const anomalies = [];
  
  try {
    // 获取最近 N 次回测结果
    const backtestResult = await pool.query(`
      SELECT win_rate, sharpe_ratio, max_drawdown, created_at
      FROM backtest_runs
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    if (backtestResult.rows.length === 0) {
      console.log('[strategy-drift] 无回测数据');
      return { detected: 0, anomalies: [] };
    }
    
    // 计算平均值
    const avgWinRate = backtestResult.rows.reduce((sum, r) => sum + parseFloat(r.win_rate || 0), 0) / backtestResult.rows.length;
    const avgSharpe = backtestResult.rows.reduce((sum, r) => sum + parseFloat(r.sharpe_ratio || 0), 0) / backtestResult.rows.length;
    const avgDrawdown = backtestResult.rows.reduce((sum, r) => sum + parseFloat(r.max_drawdown || 0), 0) / backtestResult.rows.length;
    
    console.log(`[strategy-drift] 平均胜率: ${avgWinRate.toFixed(1)}%, Sharpe: ${avgSharpe.toFixed(2)}, 回撤: ${(avgDrawdown * 100).toFixed(1)}%`);
    
    // 1. 检测胜率偏离
    const winRateDeviation = Math.abs(avgWinRate - EXPECTED_METRICS.win_rate) / EXPECTED_METRICS.win_rate;
    if (winRateDeviation > THRESHOLDS.win_rate_deviation) {
      const anomaly = {
        detector_type: 'strategy_drift',
        symbol: null,
        anomaly_type: 'win_rate_deviation',
        severity: winRateDeviation > 0.2 ? 'HIGH' : 'MEDIUM',
        message: `胜率偏离: 实际 ${avgWinRate.toFixed(1)}% vs 预期 ${EXPECTED_METRICS.win_rate}% (偏差 ${(winRateDeviation * 100).toFixed(1)}%)`,
        details: {
          expected: EXPECTED_METRICS.win_rate,
          actual: avgWinRate,
          deviation: winRateDeviation
        }
      };
      anomalies.push(anomaly);
    }
    
    // 2. 检测 Sharpe 偏离
    const sharpeDeviation = Math.abs(avgSharpe - EXPECTED_METRICS.sharpe_ratio) / EXPECTED_METRICS.sharpe_ratio;
    if (sharpeDeviation > THRESHOLDS.sharpe_deviation) {
      const anomaly = {
        detector_type: 'strategy_drift',
        symbol: null,
        anomaly_type: 'sharpe_deviation',
        severity: sharpeDeviation > 0.4 ? 'HIGH' : 'MEDIUM',
        message: `Sharpe偏离: 实际 ${avgSharpe.toFixed(2)} vs 预期 ${EXPECTED_METRICS.sharpe_ratio} (偏差 ${(sharpeDeviation * 100).toFixed(1)}%)`,
        details: {
          expected: EXPECTED_METRICS.sharpe_ratio,
          actual: avgSharpe,
          deviation: sharpeDeviation
        }
      };
      anomalies.push(anomaly);
    }
    
    // 3. 检测回撤超出
    const drawdownExcess = avgDrawdown - EXPECTED_METRICS.max_drawdown;
    if (drawdownExcess > THRESHOLDS.drawdown_excess) {
      const anomaly = {
        detector_type: 'strategy_drift',
        symbol: null,
        anomaly_type: 'drawdown_excess',
        severity: drawdownExcess > 0.1 ? 'HIGH' : 'MEDIUM',
        message: `回撤超出: 实际 ${(avgDrawdown * 100).toFixed(1)}% vs 预期 ${(EXPECTED_METRICS.max_drawdown * 100).toFixed(1)}%`,
        details: {
          expected: EXPECTED_METRICS.max_drawdown,
          actual: avgDrawdown,
          excess: drawdownExcess
        }
      };
      anomalies.push(anomaly);
    }
    
    // 写入数据库
    for (const anomaly of anomalies) {
      await logAnomaly(anomaly);
    }
    
    console.log(`[strategy-drift] 检测完成: ${anomalies.length} 个异常`);
    
    return {
      detected: anomalies.length,
      anomalies
    };
    
  } catch (error) {
    console.error('[strategy-drift] 错误:', error);
    return { detected: 0, anomalies: [] };
  }
}

/**
 * 记录异常到数据库
 */
async function logAnomaly(anomaly: any): Promise<void> {
  await pool.query(`
    INSERT INTO anomaly_log 
    (detector_type, symbol, anomaly_type, severity, message, details)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [
    anomaly.detector_type,
    anomaly.symbol,
    anomaly.anomaly_type,
    anomaly.severity,
    anomaly.message,
    JSON.stringify(anomaly.details)
  ]);
}

/**
 * 发送飞书通知
 */
export async function sendFeishuNotification(anomalies: any[]): Promise<void> {
  if (anomalies.length === 0) return;
  
  const message = anomalies.map(a => `• ${a.message}`).join('\n');
  
  await pool.query(`
    INSERT INTO notification_log (id, channel, message, status)
    VALUES ($1, 'feishu', $2, 'sent')
  `, ['anomaly_' + Date.now(), `🔴 策略偏离告警\n${message}`]);
  
  console.log('[strategy-drift] 飞书通知已发送');
}

// 直接运行
if (require.main === module) {
  detectStrategyDrift().then(async (result) => {
    if (result.detected > 0) {
      await sendFeishuNotification(result.anomalies);
    }
    await pool.end();
    process.exit(0);
  });
}

export default detectStrategyDrift;