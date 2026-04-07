/**
 * 持仓异常检测器
 * 检测单股集中度、总持仓比例、止损未触发
 */

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://zhengzefeng:password@localhost:5432/trading_bot'
});

// 阈值配置
const THRESHOLDS = {
  single_position_limit: 0.30,  // 单股 > 30%
  total_position_limit: 0.90,   // 总持仓 > 90%
  stop_loss_pct: 0.05          // 止损线 5%
};

/**
 * 主函数：检测持仓异常
 */
export async function detectPositionAnomalies(): Promise<{
  detected: number;
  anomalies: any[];
}> {
  console.log('[position-anomaly] 检测持仓异常...');
  
  const anomalies = [];
  
  try {
    // 从富途API获取持仓 (通过代理或数据库)
    const positions = await getFutuPositions();
    
    if (positions.length === 0) {
      console.log('[position-anomaly] 无持仓数据');
      return { detected: 0, anomalies: [] };
    }
    
    // 计算总市值
    const totalValue = positions.reduce((sum, p) => sum + (p.market_value || 0), 0);
    const totalRatio = totalValue / 100000; // 假设总可用100万
    
    console.log(`[position-anomaly] 总持仓: ${totalValue.toFixed(2)}, 比例: ${(totalRatio * 100).toFixed(1)}%`);
    
    // 1. 检测单股集中度 > 30%
    for (const pos of positions) {
      const ratio = (pos.market_value || 0) / (totalValue || 1);
      
      if (ratio > THRESHOLDS.single_position_limit) {
        anomalies.push({
          detector_type: 'position_anomaly',
          symbol: pos.symbol,
          anomaly_type: 'concentration_high',
          severity: ratio > 0.5 ? 'HIGH' : 'MEDIUM',
          message: `单股集中: ${pos.symbol} 持仓占比 ${(ratio * 100).toFixed(1)}%`,
          details: {
            position_value: pos.market_value,
            total_value: totalValue,
            ratio
          }
        });
      }
    }
    
    // 2. 检测总持仓比例 > 90%
    if (totalRatio > THRESHOLDS.total_position_limit) {
      anomalies.push({
        detector_type: 'position_anomaly',
        symbol: null,
        anomaly_type: 'total_position_high',
        severity: 'HIGH',
        message: `总持仓过高: ${(totalRatio * 100).toFixed(1)}%`,
        details: {
          total_value: totalValue,
          ratio: totalRatio
        }
      });
    }
    
    // 3. 检测止损未触发 (如果有持仓数据)
    // 从 signals 表获取信号，对比实际持仓
    await detectStopLossNotTriggered(positions, anomalies);
    
    // 写入数据库
    for (const anomaly of anomalies) {
      await logAnomaly(anomaly);
    }
    
    console.log(`[position-anomaly] 检测完成: ${anomalies.length} 个异常`);
    
    return {
      detected: anomalies.length,
      anomalies
    };
    
  } catch (error: any) {
    console.error('[position-anomaly] 错误:', error.message);
    return { detected: 0, anomalies: [] };
  }
}

/**
 * 获取富途持仓
 */
async function getFutuPositions(): Promise<any[]> {
  try {
    // 方式1: 从数据库获取
    const result = await pool.query(`
      SELECT symbol, qty, market_value, cost, current_price 
      FROM positions 
      WHERE qty > 0
    `);
    
    return result.rows.map(r => ({
      symbol: r.symbol,
      qty: parseFloat(r.qty),
      market_value: parseFloat(r.market_value || 0),
      cost: parseFloat(r.cost || 0),
      current_price: parseFloat(r.current_price || 0)
    }));
  } catch {
    // 如果没有 positions 表，返回空
    console.log('[position-anomaly] positions 表不存在或无法访问');
    return [];
  }
}

/**
 * 检测止损未触发
 */
async function detectStopLossNotTriggered(positions: any[], anomalies: any[]): Promise<void> {
  try {
    // 获取最近的卖出信号
    const signals = await pool.query(`
      SELECT symbol, price as signal_price, created_at
      FROM signals
      WHERE action = 'SELL' AND status = 'generated'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    for (const sig of signals.rows) {
      const pos = positions.find(p => p.symbol === sig.symbol);
      
      if (pos) {
        // 计算亏损
        const cost = pos.cost / pos.qty;
        const current = pos.current_price;
        const lossPct = (cost - current) / cost;
        
        // 如果亏损超过止损线但未平仓
        if (lossPct > THRESHOLDS.stop_loss_pct) {
          anomalies.push({
            detector_type: 'position_anomaly',
            symbol: sig.symbol,
            anomaly_type: 'stop_loss_missed',
            severity: lossPct > 0.1 ? 'HIGH' : 'MEDIUM',
            message: `止损未触发: ${sig.symbol} 亏损 ${(lossPct * 100).toFixed(1)}%`,
            details: {
              cost,
              current,
              loss_pct: lossPct,
              signal_price: sig.signal_price
            }
          });
        }
      }
    }
  } catch (error: any) {
    console.log('[position-anomaly] 止损检测跳过:', error.message);
  }
}

/**
 * 记录异常
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

// 直接运行
if (require.main === module) {
  detectPositionAnomalies().then(async (result) => {
    console.log('检测结果:', result.detected, '个异常');
    await pool.end();
    process.exit(0);
  }).catch(error => {
    console.error('错误:', error);
    process.exit(1);
  });
}

export default detectPositionAnomalies;