# 期货交易接入方案 - MarketPlayer

**制定时间**: 2026-04-20  
**制定人**: neo-claude  
**状态**: 方案设计（未开发）

---

## 🎯 目标

在OpenClaw/MarketPlayer框架下接入期货交易，实现多资产类别交易能力。

---

## 📊 期货市场特点分析

### 与股票交易的差异

| 特性 | 股票 | 期货 |
|------|------|------|
| 杠杆 | 无（或融资融券1-2倍） | 5-20倍 |
| 交易时间 | 日盘 | 日盘+夜盘（几乎24小时） |
| 保证金 | 全额 | 5%-20% |
| 到期日 | 无 | 有（需要移仓） |
| 方向 | 只能做多（或融券做空） | 双向交易 |
| 结算 | T+1 | T+0（当日多次） |
| 合约标准化 | 否 | 是（固定乘数） |
| 强平风险 | 低 | 高（保证金不足） |

### 风险等级

- **股票交易**: 中等风险
- **期货交易**: 高风险（杠杆+爆仓）
- **建议**: 期货仓位不超过总资金20%

---

## 🏗️ 架构设计

### 1. 整体架构

```
MarketPlayer (现有)
├── brokers/
│   ├── base_broker.py (现有)
│   ├── alpaca/ (股票 - 现有)
│   └── futures/ (新增)
│       ├── base_futures_broker.py
│       ├── ctp_broker.py (国内期货 - CTP接口)
│       ├── ib_futures_broker.py (国际期货 - Interactive Brokers)
│       └── binance_futures_broker.py (加密货币期货)
├── strategies/
│   ├── stock/ (现有)
│   └── futures/ (新增)
│       ├── trend_following.ts (趋势跟踪)
│       ├── arbitrage.ts (套利)
│       └── basis_trading.ts (基差交易)
├── risk/
│   ├── stock_risk.py (现有)
│   └── futures_risk.py (新增)
│       ├── margin_monitor.py (保证金监控)
│       ├── position_limiter.py (仓位限制)
│       └── forced_liquidation_防御.py (强平防御)
└── data/
    ├── stock/ (现有)
    └── futures/ (新增)
        ├── contracts/ (合约信息)
        ├── tick/ (Tick数据)
        └── rollover/ (移仓数据)
```

### 2. 数据库扩展

#### PostgreSQL新表

```sql
-- 期货合约信息表
CREATE TABLE futures_contracts (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,          -- 合约代码 (如 IF2406)
    exchange VARCHAR(10),                 -- 交易所 (CFFEX/SHFE/DCE/CZCE)
    underlying VARCHAR(20),               -- 标的 (IF/CU/RB等)
    expiry_date DATE NOT NULL,           -- 到期日
    multiplier INTEGER NOT NULL,         -- 合约乘数
    tick_size DECIMAL(10,4),            -- 最小变动价位
    margin_rate DECIMAL(5,4),           -- 保证金率
    trading_hours JSONB,                -- 交易时间
    status VARCHAR(20) DEFAULT 'active', -- 状态
    created_at TIMESTAMP DEFAULT NOW()
);

-- 期货持仓表
CREATE TABLE futures_positions (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES futures_contracts(id),
    direction VARCHAR(10) NOT NULL,      -- long/short
    quantity INTEGER NOT NULL,
    avg_price DECIMAL(15,4),
    current_price DECIMAL(15,4),
    unrealized_pnl DECIMAL(15,2),
    margin_used DECIMAL(15,2),
    open_time TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 期货订单表
CREATE TABLE futures_orders (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES futures_contracts(id),
    order_type VARCHAR(20),              -- market/limit/stop
    direction VARCHAR(10),               -- buy/sell (开多/开空/平多/平空)
    offset_flag VARCHAR(10),             -- open/close
    quantity INTEGER,
    price DECIMAL(15,4),
    filled_quantity INTEGER DEFAULT 0,
    status VARCHAR(20),
    broker_order_id VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    filled_at TIMESTAMP
);

-- 移仓记录表
CREATE TABLE futures_rollovers (
    id SERIAL PRIMARY KEY,
    old_contract_id INTEGER REFERENCES futures_contracts(id),
    new_contract_id INTEGER REFERENCES futures_contracts(id),
    quantity INTEGER,
    basis DECIMAL(10,4),                 -- 基差
    rollover_cost DECIMAL(15,2),         -- 移仓成本
    executed_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🔌 Broker接口设计

### 基础期货Broker接口

```python
# brokers/futures/base_futures_broker.py

from abc import ABC, abstractmethod
from typing import List, Dict, Optional
from datetime import date

class BaseFuturesBroker(ABC):
    """期货Broker抽象基类"""
    
    @abstractmethod
    def get_active_contracts(self, underlying: str) -> List[Dict]:
        """获取活跃合约列表"""
        pass
    
    @abstractmethod
    def get_main_contract(self, underlying: str) -> Dict:
        """获取主力合约"""
        pass
    
    @abstractmethod
    def submit_futures_order(
        self,
        contract: str,
        direction: str,      # buy/sell
        offset: str,         # open/close
        quantity: int,
        order_type: str = 'market',
        price: float = None
    ) -> Dict:
        """提交期货订单"""
        pass
    
    @abstractmethod
    def get_margin_info(self) -> Dict:
        """获取保证金信息"""
        pass
    
    @abstractmethod
    def get_position_risk(self, contract: str) -> Dict:
        """获取持仓风险"""
        pass
    
    @abstractmethod
    def check_rollover_needed(self, contract: str, days_before: int = 5) -> bool:
        """检查是否需要移仓"""
        pass
    
    @abstractmethod
    def execute_rollover(self, old_contract: str, new_contract: str, quantity: int) -> Dict:
        """执行移仓"""
        pass
```

### 国内期货CTP接口

```python
# brokers/futures/ctp_broker.py

class CTPBroker(BaseFuturesBroker):
    """
    国内期货CTP接口
    
    支持交易所：
    - CFFEX: 中金所 (IF/IH/IC股指期货)
    - SHFE: 上期所 (CU/AL/RB等)
    - DCE: 大商所 (I/J/JM等)
    - CZCE: 郑商所 (CF/SR/TA等)
    - INE: 能源中心 (SC原油)
    """
    
    def __init__(self, front_addr: str, broker_id: str, 
                 investor_id: str, password: str):
        """
        初始化CTP连接
        
        Args:
            front_addr: CTP前置地址
            broker_id: 期货公司代码
            investor_id: 投资者账号
            password: 密码
        """
        pass
    
    # 实现抽象方法...
```

---

## ⚠️ 风险管理系统

### 1. 保证金监控

```typescript
// risk/futures_risk.ts

interface MarginMonitor {
  // 实时监控保证金占用率
  checkMarginRatio(): number;  // 当前占用/可用
  
  // 触发预警
  alertLevels: {
    warning: 0.70,   // 70%占用发出警告
    danger: 0.85,    // 85%占用限制开仓
    critical: 0.95   // 95%占用强制平仓
  };
  
  // 自动减仓
  autoReducePosition(targetRatio: number): void;
}
```

### 2. 强平防御机制

```typescript
interface ForcedLiquidationDefense {
  // 距离强平价的安全距离
  safetyMargin: number;  // 建议5%以上
  
  // 自动补充保证金
  autoAddMargin(amount: number): void;
  
  // 紧急平仓
  emergencyClose(contract: string): void;
  
  // 预警系统
  alerts: {
    distance: number;      // 距离强平价距离
    timeToLiquidation: number;  // 预计多久会被强平
    suggestedAction: string;    // 建议操作
  };
}
```

### 3. 仓位限制

```typescript
interface PositionLimiter {
  // 单品种最大仓位
  maxPositionPerContract: number;  // 建议不超过20手
  
  // 总仓位限制
  maxTotalPosition: number;  // 总资金的20%
  
  // 杠杆限制
  maxLeverage: number;  // 建议不超过5倍实际杠杆
  
  // 检查是否可以开仓
  canOpenPosition(contract: string, quantity: number): boolean;
}
```

---

## 🤖 OpenClaw Agent集成

### 新增Agents

#### 1. futures-monitor-agent
```markdown
任务: 监控期货持仓和风险
职责:
  - 每5分钟检查保证金占用率
  - 每小时检查是否需要移仓
  - 异常情况立即告警
输出: 风险报告 → 飞书
```

#### 2. futures-rollover-agent
```markdown
任务: 自动移仓管理
职责:
  - 到期前5天提醒
  - 到期前3天执行移仓
  - 选择最优新合约（成交量+基差）
输出: 移仓记录 → PostgreSQL
```

#### 3. futures-strategy-agent
```markdown
任务: 期货策略执行
职责:
  - 趋势跟踪策略
  - 套利策略（跨期/跨品种）
  - 基差交易
输出: 交易信号 → 订单系统
```

### Commander集成

```typescript
// commander/futures-commander.ts

class FuturesCommander {
  dailyReport() {
    // 每日期货汇报
    return {
      positions: this.getCurrentPositions(),
      pnl: this.getDailyPnL(),
      marginUsage: this.getMarginUsage(),
      risks: this.getRiskAlerts(),
      upcomingRollovers: this.getUpcomingRollovers()
    };
  }
  
  handleAlert(alert: FuturesAlert) {
    // 处理期货告警
    if (alert.level === 'critical') {
      this.emergencyClose();
      this.notifyUser('紧急平仓');
    }
  }
}
```

---

## 📈 策略设计

### 1. 趋势跟踪策略

```typescript
// strategies/futures/trend_following.ts

interface TrendFollowingStrategy {
  // 使用ATR（真实波动幅度）突破
  entry: {
    method: 'ATR_breakout',
    period: 20,
    multiplier: 2.5
  };
  
  // 止损：ATR的2倍
  stopLoss: {
    type: 'ATR',
    multiplier: 2.0
  };
  
  // 止盈：移动止盈
  takeProfit: {
    type: 'trailing',
    atrMultiplier: 3.0
  };
  
  // 仓位管理：波动率调整
  positionSizing: {
    method: 'volatility_adjusted',
    riskPerTrade: 0.02  // 每笔2%风险
  };
}
```

### 2. 套利策略

```typescript
// strategies/futures/arbitrage.ts

interface ArbitrageStrategy {
  // 跨期套利（远近月价差）
  calendarSpread: {
    entry: 'basis_threshold',  // 基差阈值
    threshold: 50,              // 价差50点
    direction: 'long_near_short_far'  // 买近卖远
  };
  
  // 跨品种套利
  interCommoditySpread: {
    pairs: ['CU-AL', 'RB-I'],  // 铜-铝, 螺纹-铁矿
    correlationThreshold: 0.8
  };
}
```

---

## 🔐 合规和风险提示

### 监管要求

1. **实名认证**: 期货账户必须实名
2. **适当性管理**: 需通过期货投资者适当性测评
3. **资金门槛**: 
   - 商品期货: 无门槛（但建议5万以上）
   - 股指期货: 50万资金 + 通过测试
4. **交易权限**: 需单独开通期货交易权限

### 风险警告

⚠️ **期货交易高风险警告**：

1. **杠杆风险**: 10倍杠杆意味着10%逆向波动爆仓
2. **流动性风险**: 非主力合约可能无法及时平仓
3. **强平风险**: 保证金不足会被强制平仓
4. **隔夜风险**: 夜盘波动可能导致巨额亏损
5. **移仓风险**: 换月时可能产生滑点损失

**建议**:
- 初期仅用10%资金试水
- 严格止损，每笔风险不超过2%
- 避免重仓、避免逆势、避免夜盘持仓
- 定期复盘，及时止损

---

## 📅 实施路线图

### Phase 1: 基础设施（2周）

- [ ] 设计并实现BaseFuturesBroker接口
- [ ] 数据库表结构设计和创建
- [ ] CTP接口对接（或选择IB）
- [ ] 基础行情和交易测试

### Phase 2: 风险管理（1周）

- [ ] 保证金监控系统
- [ ] 强平防御机制
- [ ] 仓位限制规则
- [ ] 告警系统集成飞书

### Phase 3: 策略开发（2周）

- [ ] 趋势跟踪策略
- [ ] 套利策略
- [ ] 回测验证
- [ ] 模拟盘测试

### Phase 4: Agent集成（1周）

- [ ] futures-monitor-agent
- [ ] futures-rollover-agent
- [ ] futures-strategy-agent
- [ ] Commander汇报集成

### Phase 5: 实盘测试（持续）

- [ ] 小资金实盘（1万以内）
- [ ] 监控和优化
- [ ] 风险事件应对
- [ ] 逐步扩大规模

**总计**: 6周完成基础系统，3个月达到稳定运行

---

## 🎛️ 技术选型建议

### Broker选择

1. **国内期货**: 
   - 推荐: CTP接口（开源的openctp或simnow模拟）
   - 备选: 期货公司提供的API

2. **国际期货**:
   - 推荐: Interactive Brokers (IB)
   - 特点: 覆盖全球市场，API成熟

3. **加密货币期货**:
   - 推荐: Binance Futures API
   - 特点: 24小时交易，高流动性

### 数据源

- **实时行情**: CTP/IB的行情订阅
- **历史数据**: Tushare Pro / Wind (付费)
- **合约信息**: 交易所官网爬取

### 开发语言

- **Broker接口**: Python (使用CTP的python wrapper)
- **策略逻辑**: TypeScript (与现有系统一致)
- **风控系统**: Python + PostgreSQL
- **Agent**: OpenClaw框架

---

## 💡 关键注意事项

### 1. 先模拟，后实盘

**强烈建议**: 至少模拟3个月盈利后再实盘

- CTP提供Simnow模拟环境
- 与实盘完全一致的接口
- 零成本验证策略

### 2. 分阶段投入

- 第1月: 1万（试水）
- 第2月: 5万（验证）
- 第3月: 10万（稳定后）
- 之后: 根据表现决定

### 3. 严格风控

```typescript
const RISK_RULES = {
  maxLossPerDay: 0.05,        // 单日最大亏损5%
  maxPositionPerContract: 0.1, // 单品种10%仓位
  maxTotalFuturesPosition: 0.2, // 期货总仓位20%
  stopLossPerTrade: 0.02,     // 单笔止损2%
  marginUsageLimit: 0.70      // 保证金占用不超过70%
};
```

### 4. 持续学习

期货交易需要：
- 宏观经济知识
- 产业链研究
- 技术分析能力
- 风险管理经验

建议阅读：
- 《期货市场技术分析》约翰·墨菲
- 《海龟交易法则》柯蒂斯·费思
- 《量化交易》欧内斯特·陈

---

## 📊 预期收益与风险

### 保守估计

- **年化收益**: 15-30%（在严格风控下）
- **最大回撤**: 控制在15%以内
- **夏普比率**: 目标>1.5
- **胜率**: 40-50%（趋势跟踪特点）

### 实际情况

- 初期可能亏损（学习成本）
- 需要3-6个月磨合
- 心态管理很重要
- 不要期望一夜暴富

---

## ✅ 方案总结

### 优势

1. **多资产配置**: 股票+期货分散风险
2. **双向交易**: 牛熊市都能盈利
3. **T+0**: 当日多次交易，灵活性高
4. **套利机会**: 跨期、跨品种套利
5. **Agent自动化**: OpenClaw框架支持全自动

### 劣势

1. **高风险**: 杠杆交易容易爆仓
2. **技术复杂**: CTP接口学习曲线陡
3. **移仓麻烦**: 每月需要换合约
4. **心态要求高**: 波动大考验纪律
5. **资金门槛**: 股指期货需要50万

### 建议

**现阶段**: 
1. 先完善股票交易系统
2. 小资金模拟期货（Simnow）
3. 研究期货品种和策略
4. 积累经验后再实盘

**未来规划**:
1. 从商品期货开始（门槛低）
2. 验证趋势跟踪策略
3. 逐步扩展到股指期货
4. 最终形成股票+期货组合

---

**方案状态**: 待评审  
**下一步**: 用户决策是否启动开发  
**预计工期**: 6周基础开发 + 3月实盘验证
