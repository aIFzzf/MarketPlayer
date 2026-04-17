#!/usr/bin/env node
/**
 * 每日强势股筛选 - 邮件推送脚本
 * 带MCP服务器超时重试机制
 */

const nodemailer = require('nodemailer');
const { fetch_top_gainers, fetch_top_volume, fetch_top_turnover } = require('../dist/mcp/tools/rank');
const { fetch_industry_board } = require('../dist/mcp/tools/board');

// MCP服务器重试配置
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

/**
 * MCP调用重试包装器
 * @param {Function} fetchFunc - MCP异步函数
 * @param {Object} params - 调用参数
 * @param {string} dataName - 数据名称（用于日志）
 * @returns {Promise} 返回数据或降级数据
 */
async function mcpFetchWithRetry(fetchFunc, params, dataName) {
  let lastError = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[${dataName}] 尝试 ${attempt}/${MAX_RETRIES}...`);
      const result = await fetchFunc(params);
      
      if (result && result.data && result.data.length > 0) {
        console.log(`[${dataName}] ✅ 成功 (${result.data.length}条)`);
        return result;
      }
      
      console.log(`[${dataName}] ⚠️ 返回为空，尝试下`);
      lastError = new Error('返回数据为空');
    } catch (error) {
      lastError = error;
      console.log(`[${dataName}] ❌ 尝试 ${attempt} 失败:`, error.message);
    }
    
    // 不是最后一次，等待后重试
    if (attempt < MAX_RETRIES) {
      console.log(`[${dataName}] ${RETRY_DELAY_MS/1000}秒后重试...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  
  // 全部失败，使用降级数据
  console.log(`[${dataName}] ❌ 全部重试失败，使用降级空数据`);
  return { data: [], source: 'fallback' };
}

async function main() {
  // 获取数据（带重试机制）
  const [gainersResult, volumeResult, turnoverResult, industryResult] = await Promise.all([
    mcpFetchWithRetry(fetch_top_gainers, { limit: 50 }, '涨幅榜'),
    mcpFetchWithRetry(fetch_top_volume, { limit: 50 }, '成交额榜'),
    mcpFetchWithRetry(fetch_top_turnover, { limit: 50 }, '换手率榜'),
    mcpFetchWithRetry(fetch_industry_board, { limit: 20 }, '行业板块')
  ]);

  const gainers = gainersResult.data || [];
  const volume = volumeResult.data || [];
  const turnover = turnoverResult.data || [];
  const industry = industryResult.data || [];

  // 综合筛选：同时满足涨幅>5% 成交额>10亿 换手率>5%
  const strongStocks = gainers.filter(s => s.changePercent > 0.05 && s.amount > 100000 && s.turnover > 0.05);

  // 创建邮件
  const transporter = nodemailer.createTransport({
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    auth: { user: '845567595@qq.com', pass: 'umhmlopcatfmbdga' }
  });

  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>每日强势股筛选</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; max-width: 900px; margin: 0 auto; background: #f5f5f5;">
  <div style="background: white; border-radius: 12px; padding: 24px; margin: 20px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h1 style="color: #e53935; margin-top: 0;">🔥 每日强势股筛选</h1>
    <p style="color: #666;">筛选时间: ${now}</p>
  </div>

  <div style="background: white; border-radius: 12px; padding: 24px; margin: 20px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h2 style="color: #1a1a1a; margin-top: 0;">📈 今日热点板块 TOP 10</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr style="background: #f5f5f5;">
        <th style="padding: 12px; text-align: left;">排名</th>
        <th style="padding: 12px; text-align: left;">板块名称</th>
        <th style="padding: 12px; text-align: right;">涨跌幅</th>
      </tr>
      ${industry.slice(0, 10).map(b => `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 12px;">${b.rank}</td>
        <td style="padding: 12px; font-weight: 500;">${b.boardName}</td>
        <td style="padding: 12px; text-align: right; color: ${b.changePercent > 0 ? '#e53935' : '#4caf50'};">${(b.changePercent * 100).toFixed(2)}%</td>
      </tr>
      `).join('')}
    </table>
  </div>

  <div style="background: white; border-radius: 12px; padding: 24px; margin: 20px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h2 style="color: #1a1a1a; margin-top: 0;">💰 成交额 TOP 10</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr style="background: #f5f5f5;">
        <th style="padding: 12px; text-align: left;">排名</th>
        <th style="padding: 12px; text-align: left;">股票代码</th>
        <th style="padding: 12px; text-align: left;">股票名称</th>
        <th style="padding: 12px; text-align: right;">成交额(亿)</th>
        <th style="padding: 12px; text-align: right;">涨跌幅</th>
      </tr>
      ${volume.slice(0, 10).map(s => `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 12px;">${s.rank}</td>
        <td style="padding: 12px;">${s.symbol}</td>
        <td style="padding: 12px; font-weight: 500;">${s.name}</td>
        <td style="padding: 12px; text-align: right;">${(s.amount / 10000).toFixed(2)}</td>
        <td style="padding: 12px; text-align: right; color: ${s.changePercent > 0 ? '#e53935' : '#4caf50'};">${(s.changePercent * 100).toFixed(2)}%</td>
      </tr>
      `).join('')}
    </table>
  </div>

  <div style="background: white; border-radius: 12px; padding: 24px; margin: 20px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h2 style="color: #1a1a1a; margin-top: 0;">🔄 换手率 TOP 10</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr style="background: #f5f5f5;">
        <th style="padding: 12px; text-align: left;">排名</th>
        <th style="padding: 12px; text-align: left;">股票代码</th>
        <th style="padding: 12px; text-align: left;">股票名称</th>
        <th style="padding: 12px; text-align: right;">换手率</th>
        <th style="padding: 12px; text-align: right;">涨跌幅</th>
      </tr>
      ${turnover.slice(0, 10).map(s => `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 12px;">${s.rank}</td>
        <td style="padding: 12px;">${s.symbol}</td>
        <td style="padding: 12px; font-weight: 500;">${s.name}</td>
        <td style="padding: 12px; text-align: right;">${(s.turnover * 100).toFixed(2)}%</td>
        <td style="padding: 12px; text-align: right; color: ${s.changePercent > 0 ? '#e53935' : '#4caf50'};">${(s.changePercent * 100).toFixed(2)}%</td>
      </tr>
      `).join('')}
    </table>
  </div>

  <div style="background: white; border-radius: 12px; padding: 24px; margin: 20px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h2 style="color: #1a1a1a; margin-top: 0;">⚡ 综合强势股 (涨幅>5% 且 成交额>10亿 且 换手率>5%)</h2>
    ${strongStocks.length > 0 ? `
    <table style="width: 100%; border-collapse: collapse;">
      <tr style="background: #f5f5f5;">
        <th style="padding: 12px; text-align: left;">股票代码</th>
        <th style="padding: 12px; text-align: left;">股票名称</th>
        <th style="padding: 12px; text-align: right;">现价</th>
        <th style="padding: 12px; text-align: right;">涨跌幅</th>
        <th style="padding: 12px; text-align: right;">成交额(亿)</th>
        <th style="padding: 12px; text-align: right;">换手率</th>
      </tr>
      ${strongStocks.slice(0, 20).map(s => `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 12px;">${s.symbol}</td>
        <td style="padding: 12px; font-weight: 500;">${s.name}</td>
        <td style="padding: 12px; text-align: right;">${s.price.toFixed(2)}</td>
        <td style="padding: 12px; text-align: right; color: #e53935;">${(s.changePercent * 100).toFixed(2)}%</td>
        <td style="padding: 12px; text-align: right;">${(s.amount / 10000).toFixed(2)}</td>
        <td style="padding: 12px; text-align: right;">${(s.turnover * 100).toFixed(2)}%</td>
      </tr>
      `).join('')}
    </table>
    ` : '<p style="color: #666;">今日无满足条件的综合强势股</p>'}
  </div>

  <div style="background: #fff3e0; border-radius: 12px; padding: 24px; margin: 20px 0;">
    <h3 style="color: #e65100; margin-top: 0;">📋 筛选条件说明</h3>
    <ul style="color: #5d4037;">
      <li>涨幅榜：全市场涨跌幅排行</li>
      <li>成交额：全市场成交额排行</li>
      <li>换手率：全市场换手率排行</li>
      <li>综合强势股：涨幅>5% 且 成交额>10亿 且 换手率>5%</li>
    </ul>
  </div>
</body>
</html>`;

  const result = await transporter.sendMail({
    from: '845567595@qq.com',
    to: '845567595@qq.com',
    subject: '🔥 每日强势股筛选 - ' + new Date().toLocaleDateString('zh-CN'),
    html: html
  });
  console.log('Email sent:', result.messageId);
}

main().catch(console.error);