#!/usr/bin/env node
/**
 * 情绪扫描器启动脚本
 */

import { startScanner } from '../dist/sentiment/scanner.js';

console.log('启动情绪扫描器...\n');

startScanner().catch((error) => {
  console.error('扫描器启动失败:', error);
  process.exit(1);
});

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n\n收到退出信号，停止扫描器...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n收到终止信号，停止扫描器...');
  process.exit(0);
});
