"""
Broker 抽象接口
支持未来扩展 IB/富途等券商
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Optional


class BaseBroker(ABC):
    """Broker抽象基类"""
    
    @abstractmethod
    def get_account_status(self) -> dict:
        """获取账户状态"""
        pass
    
    @abstractmethod
    def submit_order(
        self,
        symbol: str,
        qty: float,
        side: str,
        order_type: str = 'market',
        limit_price: float = None,
        stop_price: float = None
    ) -> dict:
        """提交订单"""
        pass
    
    @abstractmethod
    def get_positions(self) -> List[dict]:
        """获取持仓"""
        pass
    
    @abstractmethod
    def get_orders(self, status: str = 'open') -> List[dict]:
        """获取订单"""
        pass
    
    @abstractmethod
    def cancel_order(self, order_id: str) -> dict:
        """取消订单"""
        pass
    
    @abstractmethod
    def is_tradeable(self, symbol: str) -> bool:
        """检查是否可交易"""
        pass
    
    @abstractmethod
    def get_buying_power(self) -> float:
        """获取购买力"""
        pass


class BrokerErrors:
    """Broker异常定义"""
    
    class InsufficientFunds(Exception):
        """资金不足"""
        pass
    
    class InvalidSymbol(Exception):
        """无效股票代码"""
        pass
    
    class OrderFailed(Exception):
        """订单失败"""
        pass
    
    class ConnectionError(Exception):
        """连接失败"""
        pass