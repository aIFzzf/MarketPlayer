/**
 * trigger-engine - scan-portfolio.js
 * 每10分钟执行，开盘时段持仓扫描
 */

const { execSync } = require('child_process');
const NODE_BIN = '/usr/local/bin/node';

function isMarketOpen() {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    if (day === 0 || day === 6) return false;
    if (hour >= 9 && hour < 15) return true;  // A股
    if (hour >= 9 && hour < 16) return true;  // 港股
    if (hour >= 16 || hour < 1) return true;  // 美股
    return false;
}

console.log('[scan-portfolio] 持仓扫描启动');

if (!isMarketOpen()) {
    console.log('[scan-portfolio] 非交易时段，跳过');
    process.exit(0);
}

try {
    const cmd = `${NODE_BIN} agents/harness/routing-policy/routing-policy.js '{"workflow":"scan_portfolio","priority":"medium"}'`;
    const result = execSync(cmd, { cwd: process.cwd(), encoding: 'utf-8' });
    console.log(result);
} catch (e) {
    console.error('scan-portfolio 执行失败:', e.message);
}

console.log('[scan-portfolio] 扫描完成');