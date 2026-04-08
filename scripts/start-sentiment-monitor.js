#!/usr/bin/env node
/**
 * 情绪监控服务启动脚本
 */

import { startMonitoring } from '../dist/sentiment/monitor-service.js';

console.log('启动情绪监控服务...\n');

startMonitoring().catch((error) => {
  console.error('监控服务启动失败:', error);
  process.exit(1);
});

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n\n收到退出信号，停止监控服务...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n收到终止信号，停止监控服务...');
  process.exit(0);
});
