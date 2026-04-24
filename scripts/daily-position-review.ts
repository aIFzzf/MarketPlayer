/**
 * 每日持仓复盘脚本
 * 获取当前持仓数据并生成复盘报告
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 富途 API 配置
const FUTU_HOST = '127.0.0.1';
const FUTU_PORT = 11111;

interface Position {
  code: string;
  name: string;
  shares: number;
  avgCost: number;
  marketValue: number;
  profitLoss: number;
  profitPercent: number;
}

interface ReviewData {
  totalAssets: number;
  marketValue: number;
  cash: number;
  positionPct: number;
  profitLoss: number;
  profitPercent: number;
  riskScore: number;
  positions: Position[];
}

// 模拟获取持仓数据（实际应通过富途API获取）
async function fetchPositions(): Promise<ReviewData> {
  // 使用实际的模拟数据（可替换为真实API调用）
  // 这里返回示例数据
  return {
    totalAssets: 172400,  // 总资产 17.24万
    marketValue: 72400,   // 持仓市值 7.24万
    cash: 100000,        // 可用现金 10万
    positionPct: 42.0,    // 仓位 42%
    profitLoss: -247600, // 浮动盈亏 -24.76万
    profitPercent: -77.37,
    riskScore: 47,
    positions: [
      { code: '00700', name: '腾讯控股', shares: 100, avgCost: 380.5, marketValue: 35000, profitLoss: -3500, profitPercent: -9.1, positionPct: 20.3 },
      { code: '09988', name: '阿里巴巴', shares: 200, avgCost: 120.8, marketValue: 18000, profitLoss: -5000, profitPercent: -21.7, positionPct: 10.4 },
      { code: 'BIDU', name: '百度', shares: 50, avgCost: 150.2, marketValue: 12000, profitLoss: -3500, profitPercent: -22.6, positionPct: 7.0 },
      { code: 'MSFT', name: '微软', shares: 10, avgCost: 380.0, marketValue: 7400, profitLoss: 1400, profitPercent: 23.3, positionPct: 4.3 },
    ]
  };
}

function formatNumber(n: number): string {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function generateHTMLReport(data: ReviewData): string {
  const formatPct = (p: number) => p.toFixed(1) + '%';
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>每日持仓复盘</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto;">
  <h1 style="color: #1a1a1a;">📊 每日持仓复盘</h1>
  <p style="color: #666;">复盘时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
  
  <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0;">
    <h2 style="margin-top: 0;">📈 资产概况</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>总资产</strong></td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${formatNumber(data.totalAssets)} CNY</td>
      </tr>
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>持仓市值</strong></td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${formatNumber(data.marketValue)} CNY</td>
      </tr>
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>可用现金</strong></td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${formatNumber(data.cash)} CNY</td>
      </tr>
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>仓位</strong></td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${formatPct(data.positionPct)}</td>
      </tr>
      <tr style="background: ${data.profitLoss >= 0 ? '#e8f5e9' : '#ffebee'};">
        <td style="padding: 8px;"><strong>浮动盈亏</strong></td>
        <td style="padding: 8px; text-align: right; color: ${data.profitLoss >= 0 ? '#2e7d32' : '#c62828'};">
          ${formatNumber(data.profitLoss)} CNY (${formatPct(data.profitPercent)})
        </td>
      </tr>
    </table>
  </div>

  <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0;">
    <h2 style="margin-top: 0;">⚠️ 风险指标</h2>
    <p><strong>风险评分:</strong> ${data.riskScore}/100</p>
    <p><strong>风险等级:</strong> ${data.riskScore > 60 ? '低' : data.riskScore > 40 ? '中' : '高'}</p>
  </div>

  <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0;">
    <h2 style="margin-top: 0;">📋 持仓明细</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="background: #e0e0e0;">
          <th style="padding: 10px; text-align: left;">股票</th>
          <th style="padding: 10px; text-align: right;">持仓</th>
          <th style="padding: 10px; text-align: right;">市值</th>
          <th style="padding: 10px; text-align: right;">盈亏</th>
          <th style="padding: 10px; text-align: right;">盈亏%</th>
          <th style="padding: 10px; text-align: right;">仓位%</th>
        </tr>
      </thead>
      <tbody>
        ${data.positions.map(p => `
          <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 10px;">${p.name} (${p.code})</td>
            <td style="padding: 10px; text-align: right;">${p.shares}</td>
            <td style="padding: 10px; text-align: right;">${formatNumber(p.marketValue)}</td>
            <td style="padding: 10px; text-align: right; color: ${p.profitLoss >= 0 ? '#2e7d32' : '#c62828'};">${formatNumber(p.profitLoss)}</td>
            <td style="padding: 10px; text-align: right; color: ${p.profitLoss >= 0 ? '#2e7d32' : '#c62828'};">${p.profitPercent.toFixed(2)}%</td>
            <td style="padding: 10px; text-align: right;">${p.positionPct}%</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <p style="color: #999; font-size: 12px; margin-top: 30px;">
    本报告由 MarketPlayer 自动生成 | 仅供参考，不构成投资建议
  </p>
</body>
</html>`;
}

async function sendEmail(html: string) {
  const nodemailer = await import('nodemailer');
  
  const transporter = nodemailer.createTransport({
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    auth: { user: '845567595@qq.com', pass: 'umhmlopcatfmbdga' },
  });

  const info = await transporter.sendMail({
    from: 'MarketPlayer <845567595@qq.com>',
    to: '845567595@qq.com',
    subject: `📊 每日持仓复盘 - ${new Date().toLocaleDateString('zh-CN')}`,
    html
  });

  return info.messageId;
}

async function main() {
  console.log('📊 每日持仓复盘');
  console.log('================');
  
  try {
    // 获取持仓数据
    console.log('📥 获取持仓数据...');
    const data = await fetchPositions();
    console.log(`   总资产: ${formatNumber(data.totalAssets)} CNY`);
    console.log(`   持仓市值: ${formatNumber(data.marketValue)} CNY`);
    console.log(`   可用现金: ${formatNumber(data.cash)} CNY`);
    console.log(`   仓位: ${data.positionPct.toFixed(1)}%`);
    console.log(`   浮动盈亏: ${formatNumber(data.profitLoss)} CNY (${data.profitPercent.toFixed(2)}%)`);
    console.log(`   持仓数量: ${data.positions.length} 只`);
    
    // 生成报告
    console.log('📝 生成HTML报告...');
    const html = generateHTMLReport(data);
    
    // 发送邮件
    console.log('📧 发送邮件...');
    const messageId = await sendEmail(html);
    console.log('✅ 邮件已发送:', messageId);
    
    console.log('');
    console.log('================');
    console.log('✅ 每日持仓复盘完成');
    
  } catch (error: any) {
    console.error('❌ 错误:', error.message);
    process.exit(1);
  }
}

main();