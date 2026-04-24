/**
 * trigger-engine - scan-events.js
 * 每5分钟执行，开盘时段高频扫描
 */

const { execSync } = require('child_process');
const NODE_BIN = '/usr/local/bin/node';

function isMarketOpen() {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    
    // 周一到周五
    if (day === 0 || day === 6) return false;
    
    // A股: 9:30-15:00
    if (hour >= 9 && hour < 15) return true;
    
    // 港股: 9:30-16:00
    if (hour >= 9 && hour < 16) return true;
    
    // 美股: 16:00-23:30 (EST 9:30-16:00)
    // 北京时间 16:00 次日 01:00
    if (hour >= 16 || hour < 1) return true;
    
    return false;
}

console.log('[scan-events] 高频事件扫描启动');

if (!isMarketOpen()) {
    console.log('[scan-events] 非交易时段，跳过');
    process.exit(0);
}

try {
    const cmd = `${NODE_BIN} agents/harness/routing-policy/routing-policy.js '{"workflow":"scan_events","priority":"high"}'`;
    const result = execSync(cmd, { cwd: process.cwd(), encoding: 'utf-8' });
    console.log(result);
} catch (e) {
    console.error('scan-events 执行失败:', e.message);
}

console.log('[scan-events] 扫描完成');