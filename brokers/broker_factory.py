"""
Broker 工厂模式
根据配置创建对应Broker实例
"""

import os
from typing import Optional
from typing import List, Dict, Optional
from .base_broker import BaseBroker
from .alpaca.client import AlpacaClient
from .alpaca.orders import OrderManager
from .alpaca.positions import PositionManager
from .alpaca.stream import MarketDataClient, AlpacaStream


class BrokerFactory:
    """Broker工厂"""
    
    _instance = None
    _broker = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    @classmethod
    def get_broker(cls, broker_name: str = None) -> BaseBroker:
        """
        获取Broker实例
        
        Args:
            broker_name: 'alpaca' / 'ib' / 'futu'
        """
        broker_name = broker_name or os.getenv('DEFAULT_BROKER', 'alpaca')
        
        if broker_name.lower() == 'alpaca':
            return AlpacaBroker()
        else:
            raise ValueError(f'不支持的Broker: {broker_name}')


class AlpacaBroker(BaseBroker):
    """Alpaca Broker实现"""
    
    def __init__(self):
        self.client = AlpacaClient()
        self.orders = OrderManager(self.client)
        self.positions = PositionManager(self.client)
        self.market_data = MarketDataClient(self.client)
    
    def get_account_status(self) -> dict:
        return self.client.get_account_status()
    
    def submit_order(
        self,
        symbol: str,
        qty: float,
        side: str,
        order_type: str = 'market',
        limit_price: float = None,
        stop_price: float = None
    ) -> dict:
        return self.orders.place_order(
            symbol, qty, side, order_type, limit_price, stop_price
        )
    
    def get_positions(self) -> List[dict]:
        return self.positions.get_all_positions()
    
    def get_orders(self, status: str = 'open') -> List[dict]:
        if status == 'open':
            return self.orders.get_open_orders()
        else:
            return self.orders.get_closed_orders()
    
    def cancel_order(self, order_id: str) -> dict:
        return self.orders.cancel_order(order_id)
    
    def is_tradeable(self, symbol: str) -> bool:
        return self.client.is_tradeable(symbol)
    
    def get_buying_power(self) -> float:
        return self.client.get_buying_power()
    
    # 扩展方法
    def place_market_order(self, symbol: str, qty: float, side: str = 'buy') -> dict:
        return self.orders.place_market_order(symbol, qty, side)
    
    def place_limit_order(
        self,
        symbol: str,
        qty: float,
        limit_price: float,
        side: str = 'buy'
    ) -> dict:
        return self.orders.place_limit_order(symbol, qty, limit_price, side)
    
    def place_bracket_order(
        self,
        symbol: str,
        qty: float,
        limit_price: float,
        take_profit_price: float,
        stop_loss_price: float,
        side: str = 'buy'
    ) -> dict:
        return self.orders.place_bracket_order(
            symbol, qty, limit_price, take_profit_price, stop_loss_price, side
        )
    
    def close_position(self, symbol: str, qty: float = None) -> dict:
        return self.positions.close_position(symbol, qty)
    
    def get_position_pnl(self, symbol: str) -> float:
        return self.positions.get_position_pnl(symbol)
    
    def get_latest_price(self, symbol: str) -> float:
        return self.market_data.get_latest_price(symbol)
    
    def get_historical_bars(
        self,
        symbol: str,
        timeframe: str = '1D',
        limit: int = 100
    ) -> List[dict]:
        return self.market_data.get_historical_bars(symbol, timeframe, limit)


# 便捷函数
def get_alpaca_client() -> AlpacaClient:
    """获取Alpaca客户端"""
    return AlpacaClient()


def get_broker(name: str = None) -> BaseBroker:
    """获取Broker实例"""
    return BrokerFactory.get_broker(name)


# 测试
if __name__ == '__main__':
    try:
        broker = get_broker('alpaca')
        print('=== 账户状态 ===')
        print(broker.get_account_status())
        
        print('\n=== 持仓 ===')
        print(broker.get_positions())
        
        print('\n=== 购买力 ===')
        print(broker.get_buying_power())
        
    except Exception as e:
        print(f'测试失败: {e}')
        print('请设置环境变量: APCA_API_KEY_ID, APCA_API_SECRET_KEY')