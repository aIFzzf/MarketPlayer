"""
持仓管理模块
"""

from typing import List, Dict, Optional
from .client import AlpacaClient


class PositionManager:
    """持仓管理器"""
    
    def __init__(self, client: AlpacaClient = None):
        self.client = client or AlpacaClient()
    
    def get_all_positions(self) -> List[dict]:
        """获取所有持仓"""
        return self.client.list_positions()
    
    def get_position(self, symbol: str) -> Optional[dict]:
        """获取指定持仓"""
        try:
            return self.client.get_position(symbol)
        except:
            return None
    
    def has_position(self, symbol: str) -> bool:
        """检查是否有持仓"""
        pos = self.get_position(symbol)
        return pos is not None and float(pos.get('qty', 0)) > 0
    
    def get_position_size(self, symbol: str) -> float:
        """获取持仓数量"""
        pos = self.get_position(symbol)
        return float(pos.get('qty', 0)) if pos else 0
    
    def get_position_value(self, symbol: str) -> float:
        """获取持仓市值"""
        pos = self.get_position(symbol)
        return float(pos.get('market_value', 0)) if pos else 0
    
    def get_position_cost(self, symbol: str) -> float:
        """获取持仓成本"""
        pos = self.get_position(symbol)
        return float(pos.get('cost_basis', 0)) if pos else 0
    
    def get_position_pnl(self, symbol: str) -> float:
        """获取持仓盈亏"""
        pos = self.get_position(symbol)
        if not pos:
            return 0
        
        market_value = float(pos.get('market_value', 0))
        cost_basis = float(pos.get('cost_basis', 0))
        return market_value - cost_basis
    
    def get_position_pnl_pct(self, symbol: str) -> float:
        """获取持仓盈亏比例(%)"""
        pos = self.get_position(symbol)
        if not pos:
            return 0
        
        cost_basis = float(pos.get('cost_basis', 0))
        if cost_basis == 0:
            return 0
        
        pnl = float(pos.get('market_value', 0)) - cost_basis
        return (pnl / cost_basis) * 100
    
    def get_all_pnl(self) -> dict:
        """获取所有持仓汇总"""
        positions = self.get_all_positions()
        
        total_value = 0
        total_cost = 0
        total_pnl = 0
        
        for pos in positions:
            value = float(pos.get('market_value', 0))
            cost = float(pos.get('cost_basis', 0))
            
            total_value += value
            total_cost += cost
            total_pnl += value - cost
        
        return {
            'total_positions': len(positions),
            'total_value': total_value,
            'total_cost': total_cost,
            'total_pnl': total_pnl,
            'pnl_pct': (total_pnl / total_cost * 100) if total_cost > 0 else 0
        }
    
    def close_position(self, symbol: str, qty: float = None) -> dict:
        """平仓"""
        position = self.get_position(symbol)
        
        if not position:
            return {'error': '无持仓'}
        
        current_qty = float(position.get('qty', 0))
        close_qty = qty if qty else current_qty
        
        if close_qty <= 0:
            return {'error': '数量无效'}
        
        # 如果平全部，使用市价单
        if close_qty >= current_qty:
            return self.client.submit_market_order(symbol, close_qty, 'sell')
        else:
            # 部分平仓，使用限价单（按当前价格）
            current_price = float(position.get('current_price', 0))
            return self.client.submit_limit_order(symbol, close_qty, current_price, 'sell')
    
    def close_all_positions(self) -> List[dict]:
        """平所有仓"""
        positions = self.get_all_positions()
        results = []
        
        for pos in positions:
            symbol = pos.get('symbol')
            qty = float(pos.get('qty', 0))
            
            if qty > 0:
                order = self.client.submit_market_order(symbol, qty, 'sell')
                results.append({'symbol': symbol, 'order': order})
        
        return results
    
    def parse_position(self, pos: dict) -> dict:
        """解析持仓信息"""
        return {
            'symbol': pos.get('symbol'),
            'qty': float(pos.get('qty', 0)),
            'market_value': float(pos.get('market_value', 0)),
            'cost_basis': float(pos.get('cost_basis', 0)),
            'current_price': float(pos.get('current_price', 0)),
            'avg_entry_price': float(pos.get('avg_entry_price', 0)),
            'unrealized_pl': float(pos.get('unrealized_pl', 0)),
            'unrealized_plpc': float(pos.get('unrealized_plpc', 0)),
            'side': pos.get('side'),
        }