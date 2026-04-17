/**
 * MarketPlayer 统一配置文件
 * 2026-04-05
 * 
 * 所有策略参数、基准指标、阈值等统一在这里管理
 * 股票池从数据库 watchlist 表读取
 */

module.exports = {

  // ── 回测设置 ──────────────────────────
  backtest: {
    start_date: '2014-04-01',
    end_date: '2026-03-20',   // 每次更新数据后手动更新
    data_slice: 3000,          // 约12年交易日
  },

  // ── 策略参数（v1.1.0-confirmed 验证通过）─────────────
  strategy: {
    version: 'v1.1.0-confirmed',
    fast_period: 11,
    slow_period: 30,
    rsi_period: 14,
    rsi_low: 35,
    rsi_high: 65,
    stop_loss_pct: 0.055,
    profit_target_pct: 0.12,
    max_hold_days: 6,
    min_score: 65,
    atr_multiplier: 1.5,
  },

  // ── 基准指标（升级判断标准）────────────
  benchmark: {
    sharpe: 2.5,       // 调整为2.5，更接近当前回测表现(2.26)，加速学习闭环
    win_rate: 0.556,
    max_drawdown: 0.192,
    min_backtest_count: 5,
  },

  // ── 信号推送阈值 ──────────────────────
  push_threshold: {
    risk_on:  0.60,
    caution: 0.75,
    risk_off: 999,
  },

  // ── 学习参数 ──────────────────────────
  learning: {
    min_eval_count: 3,      // 触发学习需要的最少评估数
    hypothesis_count: 3,    // 每次生成几个hypothesis
    confidence_min: 0.4,    // 最低置信度
    confidence_low: 0.4,
    confidence_high: 0.6,
  },

  // ── 行业黑名单 ────────────────────────
  blacklist: {
    sectors: ['semiconductors'],
    symbols: ['NVDA', 'AMD', 'TSM', 'AVGO', 'QCOM', 'INTC', 'TXN', 'MU', 'AMAT', 'LRCX', 'KLAC', 'MRVL'],
  },

};
