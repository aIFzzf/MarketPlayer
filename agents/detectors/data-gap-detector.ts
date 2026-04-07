/**
 * 数据断点检测器
 * 检测K线数据缺失和异常值
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://zhengzefeng:password@localhost:5432/trading_bot'
});

const DATA_DIR = path.join(process.cwd(), 'data', 'cache', 'klines');

// 阈值配置
const THRESHOLDS = {
  max_age_hours: 24,        // 数据超过24小时未更新
  price_change_threshold: 0.20,  // 价格突变 > 20%
  min_volume: 0            // 成交量为0
};

/**
 * 主函数：检测数据断点
 */
export async function detectDataGaps(): Promise<{
  detected: number;
  anomalies: any[];
}> {
  console.log('[data-gap] 检测数据断点...');
  
  const anomalies = [];
  const now = Date.now();
  const maxAgeMs = THRESHOLDS.max_age_hours * 60 * 60 * 1000;
  
  // 扫描数据目录
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  
  for (const file of files) {
    try {
      const filePath = path.join(DATA_DIR, file);
      const stats = fs.statSync(filePath);
      
      // 1. 检测数据过时
      const ageMs = now - stats.mtimeMs;
      if (ageMs > maxAgeMs) {
        const symbol = file.replace('.json', '').replace(/^(us_|hk_|a_)/, '');
        anomalies.push({
          detector_type: 'data_gap',
          symbol,
          anomaly_type: 'data_stale',
          severity: ageMs > maxAgeMs * 2 ? 'HIGH' : 'MEDIUM',
          message: `数据过时: ${symbol} 最后更新 ${(ageMs / (1000 * 60 * 60)).toFixed(1)} 小时前`,
          details: {
            file,
            last_update: new Date(stats.mtime).toISOString(),
            age_hours: ageMs / (1000 * 60 * 60)
          }
        });
      }
      
      // 2. 检测数据异常
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const klines = data.klines || data;
      
      if (klines.length < 10) {
        const symbol = file.replace('.json', '').replace(/^(us_|hk_|a_)/, '');
        anomalies.push({
          detector_type: 'data_gap',
          symbol,
          anomaly_type: 'insufficient_data',
          severity: 'LOW',
          message: `数据不足: ${symbol} 只有 ${klines.length} 条记录`,
          details: { count: klines.length }
        });
        continue;
      }
      
      // 检测价格突变
      const lastClose = parseFloat(klines[klines.length - 1]?.close || 0);
      const prevClose = parseFloat(klines[klines.length - 2]?.close || 0);
      
      if (prevClose > 0) {
        const change = Math.abs(lastClose - prevClose) / prevClose;
        if (change > THRESHOLDS.price_change_threshold) {
          const symbol = file.replace('.json', '').replace(/^(us_|hk_|a_)/, '');
          anomalies.push({
            detector_type: 'data_gap',
            symbol,
            anomaly_type: 'price_spike',
            severity: 'HIGH',
            message: `价格突变: ${symbol} 日变化 ${(change * 100).toFixed(1)}%`,
            details: {
              prev_close: prevClose,
              last_close: lastClose,
              change_pct: change * 100
            }
          });
        }
      }
      
      // 检测成交量为0
      const lastVolume = parseFloat(klines[klines.length - 1]?.volume || 0);
      if (lastVolume === 0) {
        const symbol = file.replace('.json', '').replace(/^(us_|hk_|a_)/, '');
        anomalies.push({
          detector_type: 'data_gap',
          symbol,
          anomaly_type: 'zero_volume',
          severity: 'MEDIUM',
          message: `成交量异常: ${symbol} 最新成交量为0`,
          details: { volume: lastVolume }
        });
      }
      
    } catch (error: any) {
      console.error(`[data-gap] 处理 ${file} 错误:`, error.message);
    }
  }
  
  // 写入数据库
  for (const anomaly of anomalies) {
    await logAnomaly(anomaly);
  }
  
  console.log(`[data-gap] 检测完成: ${anomalies.length} 个异常`);
  
  return {
    detected: anomalies.length,
    anomalies
  };
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
  detectDataGaps().then(async (result) => {
    console.log('检测结果:', result.detected, '个异常');
    await pool.end();
    process.exit(0);
  }).catch(error => {
    console.error('错误:', error);
    process.exit(1);
  });
}

export default detectDataGaps;