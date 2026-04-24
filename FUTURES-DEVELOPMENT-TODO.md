# 期货交易系统开发 - 任务清单

**基于**: FUTURES-INTEGRATION-PLAN.md  
**开始日期**: 2026-04-21  
**预计完成**: 2026-06-02 (6周)  
**负责**: 待分配

---

## Phase 1: 基础设施 (2周 | 2026-04-21 ~ 2026-05-04)

### Week 1: 接口设计与数据库

#### 任务1.1: Broker抽象接口设计 ✅
**优先级**: P0  
**预计**: 2天  
**完成时间**: 2026-04-21

- [x] 创建 `brokers/futures/base_futures_broker.py`
  ```python
  class BaseFuturesBroker(ABC):
      @abstractmethod
      def get_active_contracts(self, underlying: str) -> List[Dict]
      def get_main_contract(self, underlying: str) -> Dict
      def submit_futures_order(...)
      def get_margin_info() -> Dict
      def check_rollover_needed(...) -> bool
      def execute_rollover(...) -> Dict
  ```

- [x] 定义异常类
  ```python
  class FuturesBrokerErrors:
      class InsufficientMargin(Exception)
      class ContractExpired(Exception)
      class InvalidContract(Exception)
      class ForcedLiquidation(Exception)
  ```

- [x] 编写接口文档和注释

**验收**:
- [x] 所有方法有完整type hints
- [x] 每个方法有docstring
- [x] 异常处理定义清晰

---

#### 任务1.2: 数据库表设计 ✅
**优先级**: P0  
**预计**: 1天  
**完成时间**: 2026-04-21

- [x] 创建 `database/migrations/create-futures-tables.sql`

```sql
-- 期货合约信息表
CREATE TABLE futures_contracts (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    exchange VARCHAR(10),
    underlying VARCHAR(20),
    expiry_date DATE NOT NULL,
    multiplier INTEGER NOT NULL,
    tick_size DECIMAL(10,4),
    margin_rate DECIMAL(5,4),
    trading_hours JSONB,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(symbol, exchange)
);

-- 期货持仓表
CREATE TABLE futures_positions (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES futures_contracts(id),
    direction VARCHAR(10) NOT NULL,  -- long/short
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
    order_type VARCHAR(20),
    direction VARCHAR(10),
    offset_flag VARCHAR(10),  -- open/close
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
    basis DECIMAL(10,4),
    rollover_cost DECIMAL(15,2),
    executed_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_contracts_expiry ON futures_contracts(expiry_date);
CREATE INDEX idx_contracts_status ON futures_contracts(status);
CREATE INDEX idx_positions_contract ON futures_positions(contract_id);
CREATE INDEX idx_orders_status ON futures_orders(status);
```

- [x] 执行迁移到PostgreSQL trading_bot
- [x] 验证表创建成功
- [x] 写入测试数据

**验收**:
- [x] 4个表全部创建成功
- [x] 外键关系正确
- [x] 索引创建成功

---

### Week 2: CTP接口对接

#### 任务1.3: CTP Broker实现 ⏳
**优先级**: P0  
**预计**: 5天

**前置准备**:
- [ ] 申请Simnow模拟账号（http://www.simnow.com.cn/）
- [ ] 安装openctp Python库: `pip install openctp-ctp`
- [ ] 研究CTP API文档

**开发任务**:
- [ ] 创建 `brokers/futures/ctp_broker.py`

```python
from openctp import ctp

class CTPBroker(BaseFuturesBroker):
    def __init__(self, front_addr, broker_id, investor_id, password):
        self.mdApi = ctp.CreateFtdcMdApi()
        self.traderApi = ctp.CreateFtdcTraderApi()
        # 初始化连接...
    
    def connect(self):
        """连接到CTP服务器"""
        pass
    
    def login(self):
        """登录"""
        pass
    
    def get_active_contracts(self, underlying):
        """获取合约列表"""
        # 使用QryInstrument查询
        pass
    
    def get_main_contract(self, underlying):
        """获取主力合约（按成交量排序）"""
        pass
    
    def submit_futures_order(self, contract, direction, offset, quantity, order_type, price):
        """提交订单"""
        # 使用ReqOrderInsert
        pass
    
    def get_positions(self):
        """查询持仓"""
        # 使用QryInvestorPosition
        pass
    
    def get_margin_info(self):
        """查询保证金"""
        # 使用QryTradingAccount
        pass
```

- [ ] 实现行情订阅
- [ ] 实现订单管理
- [ ] 实现持仓查询
- [ ] 错误处理和重连机制

**验收**:
- [ ] 能成功连接Simnow
- [ ] 能获取合约列表
- [ ] 能查询账户信息
- [ ] 能订阅行情
- [ ] 模拟下单成功

---

#### 任务1.4: 测试套件 ⏳
**优先级**: P1  
**预计**: 2天

- [ ] 创建 `tests/brokers/test_futures_broker.py`

```python
def test_connect():
    """测试连接"""
    broker = CTPBroker(...)
    assert broker.connect() == True

def test_get_contracts():
    """测试获取合约"""
    contracts = broker.get_active_contracts('IF')
    assert len(contracts) > 0
    assert 'IF2406' in [c['symbol'] for c in contracts]

def test_get_margin():
    """测试查询保证金"""
    margin = broker.get_margin_info()
    assert 'available' in margin
    assert 'balance' in margin

def test_submit_order():
    """测试下单（模拟）"""
    order = broker.submit_futures_order(
        contract='IF2406',
        direction='buy',
        offset='open',
        quantity=1,
        order_type='limit',
        price=3800.0
    )
    assert order['status'] in ['pending', 'filled']
```

- [ ] 单元测试覆盖率>80%
- [ ] 集成测试通过

**验收**:
- [ ] 所有测试通过
- [ ] 覆盖主要功能

---

## Phase 2: 风险管理 (1周 | 2026-05-05 ~ 2026-05-11)

### 任务2.1: 保证金监控 ⏳
**优先级**: P0  
**预计**: 2天

- [ ] 创建 `risk/futures/margin_monitor.py`

```python
class MarginMonitor:
    ALERT_LEVELS = {
        'warning': 0.70,   # 70%占用警告
        'danger': 0.85,    # 85%限制开仓
        'critical': 0.95   # 95%强制平仓
    }
    
    def check_margin_ratio(self) -> float:
        """检查保证金占用率"""
        pass
    
    def get_alert_level(self, ratio: float) -> str:
        """获取告警级别"""
        pass
    
    def should_reduce_position(self) -> bool:
        """是否需要减仓"""
        pass
    
    def auto_reduce_position(self, target_ratio: float):
        """自动减仓到目标比例"""
        pass
```

- [ ] 实时监控保证金
- [ ] 触发告警通知飞书
- [ ] 自动减仓机制

**验收**:
- [ ] 监控准确
- [ ] 告警及时
- [ ] 减仓逻辑正确

---

### 任务2.2: 强平防御 ⏳
**优先级**: P0  
**预计**: 2天

- [ ] 创建 `risk/futures/liquidation_defense.py`

```python
class LiquidationDefense:
    SAFETY_MARGIN = 0.05  # 5%安全距离
    
    def calculate_liquidation_price(self, position) -> float:
        """计算强平价"""
        pass
    
    def get_distance_to_liquidation(self, position) -> float:
        """距离强平价的距离"""
        pass
    
    def estimate_time_to_liquidation(self, position) -> int:
        """预计多久会被强平（分钟）"""
        pass
    
    def emergency_close(self, position):
        """紧急平仓"""
        pass
    
    def auto_add_margin(self, amount: float):
        """自动补充保证金"""
        pass
```

**验收**:
- [ ] 强平价计算准确
- [ ] 预警及时
- [ ] 紧急平仓有效

---

### 任务2.3: 仓位限制 ⏳
**优先级**: P1  
**预计**: 2天

- [ ] 创建 `risk/futures/position_limiter.py`

```python
class PositionLimiter:
    MAX_POSITION_PER_CONTRACT = 20  # 单品种最大20手
    MAX_TOTAL_POSITION_PCT = 0.20    # 总资金20%
    MAX_LEVERAGE = 5.0               # 最大5倍实际杠杆
    
    def can_open_position(self, contract, quantity) -> bool:
        """检查是否可以开仓"""
        pass
    
    def get_max_quantity(self, contract) -> int:
        """获取最大可开仓数量"""
        pass
    
    def check_leverage(self) -> float:
        """检查当前杠杆"""
        pass
```

**验收**:
- [ ] 限制逻辑正确
- [ ] 防止超限开仓

---

## Phase 3: 策略开发 (2周 | 2026-05-12 ~ 2026-05-25)

### 任务3.1: 趋势跟踪策略 ⏳
**优先级**: P1  
**预计**: 5天

- [ ] 创建 `strategies/futures/trend_following.ts`
- [ ] ATR突破入场
- [ ] ATR止损/止盈
- [ ] 波动率调整仓位
- [ ] 回测验证

---

### 任务3.2: 套利策略 ⏳
**优先级**: P2  
**预计**: 5天

- [ ] 创建 `strategies/futures/arbitrage.ts`
- [ ] 跨期套利
- [ ] 跨品种套利
- [ ] 基差监控

---

## Phase 4: Agent集成 (1周 | 2026-05-26 ~ 2026-06-01)

### 任务4.1: futures-monitor-agent ⏳
**优先级**: P0  
**预计**: 2天

- [ ] 创建 `agents/futures-monitor-agent/`
- [ ] 每5分钟检查保证金
- [ ] 每小时检查移仓
- [ ] 异常告警飞书

---

### 任务4.2: futures-rollover-agent ⏳
**优先级**: P1  
**预计**: 2天

- [ ] 创建 `agents/futures-rollover-agent/`
- [ ] 到期前5天提醒
- [ ] 到期前3天执行移仓
- [ ] 选择最优新合约

---

### 任务4.3: Commander集成 ⏳
**优先级**: P1  
**预计**: 2天

- [ ] 创建 `commander/futures-commander.ts`
- [ ] 每日期货汇报
- [ ] 风险告警处理
- [ ] 飞书通知

---

## Phase 5: 实盘测试 (持续)

### 任务5.1: 模拟盘测试 ⏳
**优先级**: P0  
**预计**: 至少3个月

- [ ] Simnow环境连续运行
- [ ] 监控系统稳定性
- [ ] 策略表现验证
- [ ] 风控系统有效性
- [ ] 积累3个月盈利记录

---

### 任务5.2: 实盘准备 ⏳
**优先级**: P2  
**预计**: 2周

- [ ] 开通真实期货账户
- [ ] 完成适当性测评
- [ ] 资金准备（建议5万以上）
- [ ] 风险预案制定
- [ ] 应急流程演练

---

### 任务5.3: 小规模实盘 ⏳
**优先级**: P2  
**预计**: 1个月

- [ ] 第1周：1万资金
- [ ] 第2周：验证盈利能力
- [ ] 第3周：调整策略
- [ ] 第4周：评估是否扩大

---

## 📋 检查清单

### 开发前
- [ ] 阅读完整的 FUTURES-INTEGRATION-PLAN.md
- [ ] 理解期货交易风险
- [ ] 申请Simnow模拟账号
- [ ] 安装必要的Python库
- [ ] 配置开发环境

### 开发中
- [ ] 代码有完整注释
- [ ] 每个模块有单元测试
- [ ] 风控系统优先于策略
- [ ] 定期提交Git
- [ ] 文档同步更新

### 开发后
- [ ] 所有测试通过
- [ ] 代码审查完成
- [ ] 文档完整
- [ ] 模拟测试3个月
- [ ] 风险评估通过

---

## ⚠️ 风险提示

1. **期货是高风险交易**，可能损失全部本金
2. **必须先模拟3个月**，验证策略和风控
3. **严格执行止损**，每笔不超过2%
4. **避免重仓和逆势**
5. **夜盘风险高**，初期避免持仓过夜
6. **保持冷静心态**，不要情绪化交易

---

## 📞 求助资源

- **CTP文档**: http://www.sfit.com.cn/
- **Simnow**: http://www.simnow.com.cn/
- **openctp**: https://github.com/openctp/openctp
- **期货基础**: 《期货市场技术分析》约翰·墨菲

---

**创建时间**: 2026-04-21 00:00  
**最后更新**: 2026-04-21 00:00  
**状态**: 待启动  
**下次检查**: Phase 1启动时
