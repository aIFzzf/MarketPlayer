"""
订单管理模块
"""

from typing import Optional, List, Dict
from .client import AlpacaClient


class OrderManager:
    """订单管理器"""
    
    def __init__(self, client: AlpacaClient = None):
        self.client = client or AlpacaClient()
    
    def place_order(
        self,
        symbol: str,
        qty: float,
        side: str = 'buy',
        order_type: str = 'market',
        limit_price: float = None,
        stop_price: float = None,
        time_in_force: str = 'day'
    ) -> dict:
        """下单"""
        return self.client.submit_order(
            symbol=symbol,
            qty=qty,
            side=side,
            order_type=order_type,
            time_in_force=time_in_force,
            limit_price=limit_price,
            stop_price=stop_price
        )
    
    def place_market_order(self, symbol: str, qty: float, side: str = 'buy') -> dict:
        """市价单"""
        return self.client.submit_market_order(symbol, qty, side)
    
    def place_limit_order(
        self,
        symbol: str,
        qty: float,
        limit_price: float,
        side: str = 'buy'
    ) -> dict:
        """限价单"""
        return self.client.submit_limit_order(symbol, qty, limit_price, side)
    
    def place_bracket_order(
        self,
        symbol: str,
        qty: float,
        limit_price: float,
        take_profit_price: float,
        stop_loss_price: float,
        side: str = 'buy'
    ) -> dict:
        """组合单（止盈止损）"""
        return self.client.submit_bracket_order(
            symbol, qty, side, limit_price, take_profit_price, stop_loss_price
        )
    
    def get_order(self, order_id: str) -> dict:
        """查询订单"""
        return self.client.get_order(order_id)
    
    def get_open_orders(self) -> List[dict]:
        """查询所有未完成订单"""
        return self.client.list_orders(status='open')
    
    def get_closed_orders(self, limit: int = 100) -> List[dict]:
        """查询已完成订单"""
        return self.client.list_orders(status='closed', limit=limit)
    
    def cancel_order(self, order_id: str) -> dict:
        """取消订单"""
        return self.client.cancel_order(order_id)
    
    def cancel_all(self) -> dict:
        """取消所有订单"""
        return self.client.cancel_all_orders()
    
    def wait_for_fill(self, order_id: str, timeout: int = 60) -> dict:
        """等待订单成交"""
        import time
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            order = self.get_order(order_id)
            status = order.get('status')
            
            if status == 'filled':
                return order
            elif status in ['canceled', 'expired', 'rejected']:
                return order
            
            time.sleep(1)
        
        return {'status': 'timeout', 'order_id': order_id}
    
    def parse_order_response(self, order: dict) -> dict:
        """解析订单响应"""
        return {
            'id': order.get('id'),
            'symbol': order.get('symbol'),
            'qty': float(order.get('qty', 0)),
            'filled_qty': float(order.get('filled_qty', 0)),
            'side': order.get('side'),
            'type': order.get('type'),
            'status': order.get('status'),
            'limit_price': float(order.get('limit_price') or 0),
            'stop_price': float(order.get('stop_price') or 0),
            'created_at': order.get('created_at'),
            'filled_at': order.get('filled_at'),
        }
    
    def get_order_status(self, order_id: str) -> str:
        """获取订单状态"""
        order = self.get_order(order_id)
        return order.get('status', 'unknown')
    
    def is_filled(self, order_id: str) -> bool:
        """检查订单是否已成交"""
        return self.get_order_status(order_id) == 'filled'
    
    def is_open(self, order_id: str) -> bool:
        """检查订单是否还在进行中"""
        status = self.get_order_status(order_id)
        return status in ['new', 'partially_filled', 'pending_new']