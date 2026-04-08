/**
 * 短线Agent分析器
 * 调用OpenClaw短线agent分析情绪异常事件
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import pg from 'pg';

const execAsync = promisify(exec);
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://zhengzefeng:password@localhost:5432/trading_bot'
});

export interface SentimentEvent {
  symbol: string;
  event_type: 'extreme_negative' | 'extreme_positive' | 'trend_reversal';
  sentiment_score: number;
  sentiment_change: number;
  momentum: number;
}

export interface AgentAnalysis {
  analysis: string;
  action: 'BUY' | 'SELL' | 'REDUCE' | 'HOLD' | 'WAIT';
  confidence: number;
  reason: string;
  risk_level: 'HIGH' | 'MEDIUM' | 'LOW';
  entry_price?: number;
  stop_loss?: number;
  take_profit?: number;
}

/**
 * 调用OpenClaw短线agent分析
 */
async function callShortTermAgent(event: SentimentEvent): Promise<AgentAnalysis> {
  const prompt = `
分析以下情绪异常事件，判断是否有交易机会：

股票代码：${event.symbol}
事件类型：${event.event_type}
情绪分数：${event.sentiment_score} (-100到+100)
情绪变化：${event.sentiment_change} (与昨日对比)
动量：${event.momentum}

请分析：
1. 情绪真实性：这个情绪变化是否由真实新闻驱动？
2. 技术面确认：RSI、MA等技术指标是否支持？
3. 交易机会：是否有明确的交易机会？
4. 风险评估：当前风险等级如何？

输出格式（JSON）：
{
  "analysis": "完整分析过程",
  "action": "BUY|SELL|REDUCE|HOLD|WAIT",
  "confidence": 0.0-1.0,
  "reason": "建议理由",
  "risk_level": "HIGH|MEDIUM|LOW",
  "entry_price": 建议入场价（可选）,
  "stop_loss": 止损价（可选）,
  "take_profit": 止盈价（可选）
}
`;

  try {
    // 调用OpenClaw agent
    const command = `openclaw agent --agent short-term-agent --message ${JSON.stringify(prompt)} --json`;
    const { stdout } = await execAsync(command, { timeout: 60000 });

    // 解析返回结果
    const result = JSON.parse(stdout);
    const agentResponse = result.payloads?.[0]?.text || '';

    // 尝试从响应中提取JSON
    const jsonMatch = agentResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      return analysis;
    }

    // 如果没有JSON格式，返回默认分析
    return {
      analysis: agentResponse,
      action: 'WAIT',
      confidence: 0.5,
      reason: 'Agent分析未返回明确建议',
      risk_level: 'MEDIUM'
    };
  } catch (error) {
    console.error('调用短线agent失败:', error);

    // 降级：返回保守建议
    return {
      analysis: `Agent调用失败，采用保守策略。错误：${error}`,
      action: 'WAIT',
      confidence: 0.3,
      reason: 'Agent不可用，建议观望',
      risk_level: 'HIGH'
    };
  }
}

/**
 * 保存建议到数据库
 */
async function saveSuggestion(event: SentimentEvent, analysis: AgentAnalysis): Promise<number> {
  const result = await pool.query(`
    INSERT INTO sentiment_suggestions (
      symbol, event_type, sentiment_score, sentiment_change, momentum,
      agent_analysis, suggested_action, confidence, reason, risk_level,
      entry_price, stop_loss, take_profit, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending')
    RETURNING id
  `, [
    event.symbol,
    event.event_type,
    event.sentiment_score,
    event.sentiment_change,
    event.momentum,
    analysis.analysis,
    analysis.action,
    analysis.confidence,
    analysis.reason,
    analysis.risk_level,
    analysis.entry_price || null,
    analysis.stop_loss || null,
    analysis.take_profit || null
  ]);

  return result.rows[0].id;
}

/**
 * 发送飞书通知
 */
async function sendFeishuNotification(suggestionId: number, event: SentimentEvent, analysis: AgentAnalysis): Promise<void> {
  try {
    const { sendFeishuText } = await import('../services/market/watcher/feishu-notify.js');

    const message = `
🔔 情绪异常事件 - 待审批

📊 股票：${event.symbol}
📉 情绪分数：${event.sentiment_score}
📈 情绪变化：${event.sentiment_change > 0 ? '+' : ''}${event.sentiment_change}

🤖 Agent建议：${analysis.action}
💯 置信度：${(analysis.confidence * 100).toFixed(0)}%
⚠️  风险等级：${analysis.risk_level}

📝 理由：${analysis.reason}

👉 请前往前端审批：http://localhost:3000/sentiment-suggestions.html
`;

    await sendFeishuText(message);
  } catch (error) {
    console.error('发送飞书通知失败:', error);
  }
}

/**
 * 分析情绪事件（主函数）
 */
export async function analyzeEvent(event: SentimentEvent): Promise<number> {
  console.log(`\n🔍 分析情绪事件: ${event.symbol} (${event.event_type})`);
  console.log(`   情绪分数: ${event.sentiment_score}, 变化: ${event.sentiment_change}`);

  // 调用短线agent分析
  console.log('   调用短线agent...');
  const analysis = await callShortTermAgent(event);

  console.log(`   Agent建议: ${analysis.action} (置信度: ${(analysis.confidence * 100).toFixed(0)}%)`);

  // 保存为待审批建议
  const suggestionId = await saveSuggestion(event, analysis);
  console.log(`   ✅ 建议已保存 (ID: ${suggestionId})`);

  // 发送飞书通知
  await sendFeishuNotification(suggestionId, event, analysis);
  console.log('   ✅ 飞书通知已发送');

  return suggestionId;
}

// 测试函数
if (require.main === module) {
  const testEvent: SentimentEvent = {
    symbol: 'AAPL',
    event_type: 'extreme_negative',
    sentiment_score: -75,
    sentiment_change: -35,
    momentum: -0.5
  };

  analyzeEvent(testEvent)
    .then(id => {
      console.log(`\n✅ 测试完成，建议ID: ${id}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ 测试失败:', err);
      process.exit(1);
    });
}
