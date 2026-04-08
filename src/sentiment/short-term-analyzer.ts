/**
 * 短线Agent分析器
 * 调用OpenClaw短线agent分析情绪事件
 */

import { spawn } from 'child_process';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://zhengzefeng:password@localhost:5432/trading_bot'
});

export interface AnalysisResult {
  analysis: string;
  action: string;
  confidence: number;
  reason: string;
  risk: string;
}

/**
 * 使用OpenClaw agent分析情绪事件
 */
export async function analyzeWithAgent(event: any): Promise<AnalysisResult | null> {
  console.log(`[analyzer] 调用短线agent分析事件...`);
  
  const symbol = event.symbol || '市场整体';
  const sentiment = event.score;
  const change = event.change;
  const eventType = event.type;
  
  // 构建prompt
  const prompt = `
你是一个短线交易分析师。请分析以下情绪事件并给出交易建议：

## 情绪事件
- 标的: ${symbol}
- 情绪分数: ${sentiment} (-100到+100)
- 变化幅度: ${change}
- 事件类型: ${eventType}

## 分析维度
1. 情绪是否已经过度反应？
2. 是否有基本面支撑？
3. 当前技术面位置如何？
4. 风险收益比如何？

## 输出格式（JSON）
{
  "analysis": "详细分析理由",
  "action": "BUY/SELL/HOLD/WAIT",
  "confidence": 0.0-1.0,
  "reason": "一句话理由",
  "risk": "low/medium/high"
}

请只输出JSON，不要其他内容。
`;
  
  try {
    // 调用 OpenClaw session 来分析
    // 这里简化为使用子进程运行分析
    
    // 构建分析结果
    const result = await runLocalAnalysis(symbol, sentiment, change, eventType);
    
    return result;
    
  } catch (error) {
    console.error('[analyzer] 分析错误:', error);
    return null;
  }
}

/**
 * 本地简化分析（替代OpenClaw调用）
 */
async function runLocalAnalysis(symbol: string, sentiment: number, change: number, eventType: string): Promise<AnalysisResult> {
  // 基于规则的分析
  
  let action = 'HOLD';
  let confidence = 0.5;
  let risk = 'medium';
  let analysis = '';
  let reason = '';
  
  if (sentiment <= -70) {
    // 极度负面
    action = 'BUY'; // 极端恐慌可能是买入机会
    confidence = 0.6;
    risk = 'high';
    analysis = `情绪极度负面(${sentiment})，市场可能过度反应。如果基本面没有恶化，可能是逆向买入机会。需要等待技术面确认。`;
    reason = `极度恐慌可能是买入机会`;
  } else if (sentiment >= 70) {
    // 极度正面
    action = 'SELL'; // 极端贪婪可能是卖出信号
    confidence = 0.6;
    risk = 'high';
    analysis = `情绪极度正面(${sentiment})，市场可能过于乐观。如果持仓已经盈利，可以考虑部分止盈。`;
    reason = `极度贪婪可能是卖出信号`;
  } else if (change > 30) {
    // 情绪急剧上升
    action = 'WAIT';
    confidence = 0.4;
    risk = 'medium';
    analysis = `情绪快速上升${change}分，需要观察持续性。不建议立即追高。`;
    reason = `等待情绪稳定`;
  } else if (change < -30) {
    // 情绪急剧下降
    action = 'BUY';
    confidence = 0.5;
    risk = 'medium';
    analysis = `情绪快速下降${Math.abs(change)}分，如果是恐慌抛售可能存在机会。`;
    reason = `恐慌可能是机会`;
  } else {
    // 一般情况
    action = 'HOLD';
    confidence = 0.3;
    risk = 'low';
    analysis = `情绪变化在正常范围内，建议继续观察。`;
    reason = `无明显信号`;
  }
  
  return {
    analysis,
    action,
    confidence,
    reason,
    risk,
  };
}

/**
 * 获取持仓信息
 */
async function getPositions(): Promise<any[]> {
  try {
    const result = await pool.query(`
      SELECT symbol, qty, market_value FROM positions WHERE qty > 0
    `);
    return result.rows;
  } catch {
    return [];
  }
}

/**
 * 检查持仓状态
 */
async function checkHoldingStatus(symbol: string): Promise<{ hasPosition: boolean; pnl: number }> {
  const positions = await getPositions();
  const pos = positions.find(p => p.symbol === symbol);
  
  if (!pos) {
    return { hasPosition: false, pnl: 0 };
  }
  
  // 简化：假设盈亏为0（需要结合成本计算）
  return { hasPosition: true, pnl: 0 };
}

export default { analyzeWithAgent, runLocalAnalysis };