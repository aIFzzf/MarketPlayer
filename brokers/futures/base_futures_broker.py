"""
期货Broker抽象基类

定义期货交易的标准接口，支持：
- 合约查询
- 订单管理
- 持仓查询
- 保证金管理
- 移仓操作
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Optional
from datetime import date, datetime
from enum import Enum


class OrderDirection(Enum):
    """订单方向"""
    BUY = "buy"    # 买入（做多）
    SELL = "sell"  # 卖出（做空）


class OffsetFlag(Enum):
    """开平标志"""
    OPEN = "open"      # 开仓
    CLOSE = "close"    # 平仓
    CLOSE_TODAY = "close_today"      # 平今
    CLOSE_YESTERDAY = "close_yesterday"  # 平昨


class OrderType(Enum):
    """订单类型"""
    MARKET = "market"  # 市价单
    LIMIT = "limit"    # 限价单
    STOP = "stop"      # 止损单
    STOP_LIMIT = "stop_limit"  # 止损限价单


class OrderStatus(Enum):
    """订单状态"""
    PENDING = "pending"      # 待提交
    SUBMITTED = "submitted"  # 已提交
    PARTIAL = "partial"      # 部分成交
    FILLED = "filled"        # 完全成交
    CANCELLED = "cancelled"  # 已撤销
    REJECTED = "rejected"    # 已拒绝


class PositionDirection(Enum):
    """持仓方向"""
    LONG = "long"    # 多头
    SHORT = "short"  # 空头


class BaseFuturesBroker(ABC):
    """
    期货Broker抽象基类

    所有期货Broker实现必须继承此类并实现所有抽象方法
    """

    def __init__(self, config: Dict):
        """
        初始化Broker

        Args:
            config: 配置字典，包含连接信息等
        """
        self.config = config
        self.is_connected = False

    # ==================== 连接管理 ====================

    @abstractmethod
    def connect(self) -> bool:
        """
        连接到Broker服务器

        Returns:
            bool: 连接是否成功

        Raises:
            ConnectionError: 连接失败
        """
        pass

    @abstractmethod
    def disconnect(self) -> bool:
        """
        断开连接

        Returns:
            bool: 断开是否成功
        """
        pass

    @abstractmethod
    def is_connected(self) -> bool:
        """
        检查连接状态

        Returns:
            bool: 是否已连接
        """
        pass

    # ==================== 合约查询 ====================

    @abstractmethod
    def get_active_contracts(self, underlying: str = None) -> List[Dict]:
        """
        获取活跃合约列表

        Args:
            underlying: 标的代码（如IF/CU/RB），None则返回全部

        Returns:
            List[Dict]: 合约列表
            [{
                'symbol': 'IF2406',
                'exchange': 'CFFEX',
                'underlying': 'IF',
                'expiry_date': '2024-06-21',
                'multiplier': 300,
                'tick_size': 0.2,
                'margin_rate': 0.12,
                'long_margin_ratio': 0.12,
                'short_margin_ratio': 0.12,
                'is_trading': True
            }, ...]
        """
        pass

    @abstractmethod
    def get_main_contract(self, underlying: str) -> Optional[Dict]:
        """
        获取主力合约（成交量最大的合约）

        Args:
            underlying: 标的代码

        Returns:
            Dict: 主力合约信息，格式同get_active_contracts
            None: 没有找到主力合约
        """
        pass

    @abstractmethod
    def get_contract_info(self, symbol: str) -> Optional[Dict]:
        """
        获取指定合约详细信息

        Args:
            symbol: 合约代码

        Returns:
            Dict: 合约信息
            None: 合约不存在
        """
        pass

    # ==================== 行情数据 ====================

    @abstractmethod
    def subscribe_market_data(self, symbols: List[str]) -> bool:
        """
        订阅行情数据

        Args:
            symbols: 合约代码列表

        Returns:
            bool: 订阅是否成功
        """
        pass

    @abstractmethod
    def unsubscribe_market_data(self, symbols: List[str]) -> bool:
        """
        取消订阅行情数据

        Args:
            symbols: 合约代码列表

        Returns:
            bool: 取消是否成功
        """
        pass

    @abstractmethod
    def get_last_price(self, symbol: str) -> Optional[float]:
        """
        获取最新价格

        Args:
            symbol: 合约代码

        Returns:
            float: 最新价格
            None: 没有行情数据
        """
        pass

    # ==================== 订单管理 ====================

    @abstractmethod
    def submit_order(
        self,
        symbol: str,
        direction: OrderDirection,
        offset: OffsetFlag,
        quantity: int,
        order_type: OrderType = OrderType.MARKET,
        price: Optional[float] = None,
        stop_price: Optional[float] = None
    ) -> Dict:
        """
        提交订单

        Args:
            symbol: 合约代码
            direction: 买卖方向
            offset: 开平标志
            quantity: 数量（手数）
            order_type: 订单类型
            price: 限价单价格
            stop_price: 止损单触发价格

        Returns:
            Dict: 订单信息
            {
                'order_id': 'xxx',
                'broker_order_id': 'xxx',
                'symbol': 'IF2406',
                'direction': 'buy',
                'offset': 'open',
                'quantity': 1,
                'price': 3800.0,
                'order_type': 'limit',
                'status': 'submitted',
                'filled_quantity': 0,
                'avg_price': 0.0,
                'commission': 0.0,
                'created_at': '2024-04-21T00:00:00'
            }

        Raises:
            InsufficientMargin: 保证金不足
            InvalidContract: 合约无效
            OrderRejected: 订单被拒绝
        """
        pass

    @abstractmethod
    def cancel_order(self, order_id: str) -> bool:
        """
        撤销订单

        Args:
            order_id: 订单ID

        Returns:
            bool: 撤销是否成功
        """
        pass

    @abstractmethod
    def get_order(self, order_id: str) -> Optional[Dict]:
        """
        查询订单状态

        Args:
            order_id: 订单ID

        Returns:
            Dict: 订单信息
            None: 订单不存在
        """
        pass

    @abstractmethod
    def get_orders(
        self,
        symbol: Optional[str] = None,
        status: Optional[OrderStatus] = None
    ) -> List[Dict]:
        """
        查询订单列表

        Args:
            symbol: 合约代码（None返回全部）
            status: 订单状态（None返回全部）

        Returns:
            List[Dict]: 订单列表
        """
        pass

    # ==================== 持仓管理 ====================

    @abstractmethod
    def get_positions(
        self,
        symbol: Optional[str] = None
    ) -> List[Dict]:
        """
        查询持仓

        Args:
            symbol: 合约代码（None返回全部）

        Returns:
            List[Dict]: 持仓列表
            [{
                'symbol': 'IF2406',
                'direction': 'long',
                'quantity': 5,
                'available_quantity': 4,  # 可平数量
                'avg_price': 3800.0,
                'current_price': 3850.0,
                'unrealized_pnl': 7500.0,
                'margin_used': 228000.0,
                'open_date': '2024-04-20'
            }, ...]
        """
        pass

    @abstractmethod
    def get_position(
        self,
        symbol: str,
        direction: PositionDirection
    ) -> Optional[Dict]:
        """
        查询指定合约和方向的持仓

        Args:
            symbol: 合约代码
            direction: 持仓方向

        Returns:
            Dict: 持仓信息
            None: 没有持仓
        """
        pass

    # ==================== 账户管理 ====================

    @abstractmethod
    def get_account_info(self) -> Dict:
        """
        获取账户信息

        Returns:
            Dict: 账户信息
            {
                'balance': 1000000.0,           # 账户余额
                'available': 772000.0,          # 可用资金
                'margin_used': 228000.0,        # 占用保证金
                'frozen_margin': 0.0,           # 冻结保证金
                'commission': 50.0,             # 手续费
                'close_profit': 5000.0,         # 平仓盈亏
                'position_profit': 7500.0,      # 持仓盈亏
                'total_profit': 12500.0,        # 总盈亏
                'margin_ratio': 0.228,          # 保证金占用率
                'risk_level': 'safe'            # 风险等级
            }
        """
        pass

    @abstractmethod
    def get_margin_info(self) -> Dict:
        """
        获取保证金信息

        Returns:
            Dict: 保证金信息
            {
                'total_margin': 1000000.0,      # 总保证金
                'available_margin': 772000.0,   # 可用保证金
                'used_margin': 228000.0,        # 已用保证金
                'frozen_margin': 0.0,           # 冻结保证金
                'margin_ratio': 0.228,          # 保证金占用率
                'maintenance_margin': 180000.0  # 维持保证金
            }
        """
        pass

    # ==================== 移仓管理 ====================

    @abstractmethod
    def check_rollover_needed(
        self,
        symbol: str,
        days_before: int = 5
    ) -> bool:
        """
        检查是否需要移仓

        Args:
            symbol: 合约代码
            days_before: 到期前多少天

        Returns:
            bool: 是否需要移仓
        """
        pass

    @abstractmethod
    def get_next_contract(self, current_symbol: str) -> Optional[str]:
        """
        获取下一个主力合约（用于移仓）

        Args:
            current_symbol: 当前合约代码

        Returns:
            str: 下一个主力合约代码
            None: 没有找到
        """
        pass

    @abstractmethod
    def execute_rollover(
        self,
        old_symbol: str,
        new_symbol: str,
        quantity: int,
        direction: PositionDirection
    ) -> Dict:
        """
        执行移仓

        Args:
            old_symbol: 旧合约代码
            new_symbol: 新合约代码
            quantity: 数量
            direction: 持仓方向

        Returns:
            Dict: 移仓结果
            {
                'success': True,
                'old_contract': 'IF2404',
                'new_contract': 'IF2406',
                'quantity': 5,
                'basis': -10.5,  # 基差（新-旧）
                'cost': 150.0,   # 移仓成本
                'executed_at': '2024-04-20T10:30:00'
            }

        Raises:
            RolloverFailed: 移仓失败
        """
        pass

    # ==================== 风险管理 ====================

    def calculate_margin_required(
        self,
        symbol: str,
        quantity: int,
        price: float
    ) -> float:
        """
        计算开仓所需保证金

        Args:
            symbol: 合约代码
            quantity: 数量
            price: 价格

        Returns:
            float: 所需保证金
        """
        contract = self.get_contract_info(symbol)
        if not contract:
            raise FuturesBrokerErrors.InvalidContract(f"合约不存在: {symbol}")

        multiplier = contract['multiplier']
        margin_rate = contract['margin_rate']

        return quantity * price * multiplier * margin_rate

    def get_position_risk(self, symbol: str) -> Dict:
        """
        获取持仓风险信息

        Args:
            symbol: 合约代码

        Returns:
            Dict: 风险信息
            {
                'liquidation_price': 3600.0,    # 强平价
                'distance_to_liquidation': 0.065,  # 距离强平价比例
                'margin_call_price': 3650.0,    # 追加保证金价格
                'risk_level': 'medium'          # 风险等级
            }
        """
        # 子类可以重写此方法实现更精确的风险计算
        return {
            'liquidation_price': 0.0,
            'distance_to_liquidation': 1.0,
            'margin_call_price': 0.0,
            'risk_level': 'unknown'
        }


class FuturesBrokerErrors:
    """期货Broker异常定义"""

    class ConnectionError(Exception):
        """连接失败"""
        pass

    class InsufficientMargin(Exception):
        """保证金不足"""
        pass

    class InvalidContract(Exception):
        """无效合约"""
        pass

    class ContractExpired(Exception):
        """合约已到期"""
        pass

    class OrderRejected(Exception):
        """订单被拒绝"""
        pass

    class OrderNotFound(Exception):
        """订单不存在"""
        pass

    class PositionNotFound(Exception):
        """持仓不存在"""
        pass

    class RolloverFailed(Exception):
        """移仓失败"""
        pass

    class MarginCallRequired(Exception):
        """需要追加保证金"""
        pass

    class ForcedLiquidation(Exception):
        """强制平仓"""
        pass
