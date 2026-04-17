"""
Alpaca API 客户端
提供账户、订单、持仓查询接口
"""

import os
import time
from typing import Optional, List, Dict, Any
import requests


class AlpacaClient:
    """Alpaca 交易API客户端"""
    
    def __init__(self, api_key: str = None, secret_key: str = None, base_url: str = None):
        """
        初始化Alpaca客户端
        
        Args:
            api_key: Alpaca API Key
            secret_key: Alpaca Secret Key
            base_url: API端点 (Paper Trading 或 实盘)
        """
        self.api_key = api_key or os.getenv('APCA_API_KEY_ID')
        self.secret_key = secret_key or os.getenv('APCA_API_SECRET_KEY')
        self.base_url = base_url or os.getenv('APCA_API_BASE_URL', 'https://paper-api.alpaca.markets')
        
        if not self.api_key or not self.secret_key:
            raise ValueError('需要设置 APCA_API_KEY_ID 和 APCA_API_SECRET_KEY')
        
        self.headers = {
            'APCA-API-KEY-ID': self.api_key,
            'APCA-API-SECRET-KEY': self.secret_key,
            'Content-Type': 'application/json'
        }
    
    def _request(self, method: str, endpoint: str, data: dict = None) -> dict:
        """发送API请求"""
        url = f'{self.base_url}/v2/{endpoint}'
        
        for attempt in range(3):
            try:
                if method == 'GET':
                    resp = requests.get(url, headers=self.headers, timeout=10)
                elif method == 'POST':
                    resp = requests.post(url, headers=self.headers, json=data, timeout=10)
                elif method == 'DELETE':
                    resp = requests.delete(url, headers=self.headers, timeout=10)
                else:
                    raise ValueError(f'不支持的HTTP方法: {method}')
                
                if resp.status_code == 200:
                    return resp.json()
                elif resp.status_code == 429:  # Rate limit
                    time.sleep(1)
                    continue
                else:
                    print(f'Alpaca API错误: {resp.status_code} - {resp.text}')
                    return {'error': resp.text, 'code': resp.status_code}
                    
            except requests.exceptions.Timeout:
                print(f'请求超时，尝试 {attempt + 1}/3')
                time.sleep(1)
            except Exception as e:
                print(f'请求异常: {e}')
                return {'error': str(e)}
        
        return {'error': '请求失败', 'code': -1}
    
    # ==================== 账户相关 ====================
    
    def get_account(self) -> dict:
        """获取账户信息"""
        return self._request('GET', 'account')
    
    def get_account_status(self) -> dict:
        """获取账户状态"""
        account = self.get_account()
        return {
            'cash': float(account.get('cash', 0)),
            'portfolio_value': float(account.get('portfolio_value', 0)),
            'equity': float(account.get('equity', 0)),
            'buying_power': float(account.get('buying_power', 0)),
            'status': account.get('status'),
            'currency': account.get('currency', 'USD')
        }
    
    # ==================== 订单相关 ====================
    
    def submit_order(
        self,
        symbol: str,
        qty: float,
        side: str = 'buy',  # buy/sell
        order_type: str = 'market',  # market/limit/stop/stop_limit
        time_in_force: str = 'day',  # day/gtc/fok/ioc
        limit_price: float = None,
        stop_price: float = None,
        take_profit: dict = None,  # {'limit_price': 160.0}
        stop_loss: dict = None,    # {'stop_price': 145.0}
        order_class: str = None   # simple/bracket/oco/oto
    ) -> dict:
        """
        提交订单
        
        Args:
            symbol: 股票代码 (如 'AAPL')
            qty: 数量
            side: buy/sell
            order_type: market/limit/stop/stop_limit
            time_in_force: day/gtc/fok/ioc
            limit_price: 限价单价格
            stop_price: 止损价格
            take_profit: 止盈设置 {'limit_price': 160.0}
            stop_loss: 止损设置 {'stop_price': 145.0}
            order_class: simple/bracket/oco/oto
        
        Returns:
            订单信息字典
        """
        # 构建订单参数
        order_params = {
            'symbol': symbol,
            'qty': str(qty),
            'side': side,
            'type': order_type,
            'time_in_force': time_in_force
        }
        
        if limit_price:
            order_params['limit_price'] = str(limit_price)
        if stop_price:
            order_params['stop_price'] = str(stop_price)
        if order_class:
            order_params['order_class'] = order_class
        if take_profit:
            order_params['take_profit'] = take_profit
        if stop_loss:
            order_params['stop_loss'] = stop_loss
        
        result = self._request('POST', 'orders', order_params)
        
        if 'error' in result:
            print(f'下单失败: {result}')
        
        return result
    
    def submit_market_order(self, symbol: str, qty: float, side: str = 'buy') -> dict:
        """市价单"""
        return self.submit_order(symbol, qty, side, 'market', 'day')
    
    def submit_limit_order(self, symbol: str, qty: float, price: float, side: str = 'buy') -> dict:
        """限价单"""
        return self.submit_order(symbol, qty, side, 'limit', 'day', limit_price=price)
    
    def submit_bracket_order(
        self,
        symbol: str,
        qty: float,
        side: str = 'buy',
        limit_price: float = None,
        take_profit_price: float = None,
        stop_loss_price: float = None
    ) -> dict:
        """组合单 (止盈止损)"""
        take_profit = {'limit_price': str(take_profit_price)} if take_profit_price else None
        stop_loss = {'stop_price': str(stop_loss_price)} if stop_loss_price else None
        
        return self.submit_order(
            symbol, qty, side, 'limit', 'gtc',
            limit_price=limit_price,
            order_class='bracket',
            take_profit=take_profit,
            stop_loss=stop_loss
        )
    
    def list_orders(self, status: str = 'open', limit: int = 100) -> List[dict]:
        """查询订单列表"""
        result = self._request('GET', f'orders?status={status}&limit={limit}')
        return result if isinstance(result, list) else []
    
    def get_order(self, order_id: str) -> dict:
        """查询单个订单"""
        return self._request('GET', f'orders/{order_id}')
    
    def cancel_order(self, order_id: str) -> dict:
        """取消订单"""
        return self._request('DELETE', f'orders/{order_id}')
    
    def cancel_all_orders(self) -> dict:
        """取消所有订单"""
        return self._request('DELETE', 'orders')
    
    # ==================== 持仓相关 ====================
    
    def list_positions(self) -> List[dict]:
        """查询所有持仓"""
        result = self._request('GET', 'positions')
        return result if isinstance(result, list) else []
    
    def get_position(self, symbol: str) -> dict:
        """查询单个持仓"""
        return self._request('GET', f'positions/{symbol}')
    
    def get_position_summary(self) -> dict:
        """获取持仓汇总"""
        positions = self.list_positions()
        
        total_value = 0
        total_pnl = 0
        
        for pos in positions:
            market_value = float(pos.get('market_value', 0))
            cost_basis = float(pos.get('cost_basis', 0))
            pnl = market_value - cost_basis
            
            total_value += market_value
            total_pnl += pnl
        
        return {
            'total_positions': len(positions),
            'total_value': total_value,
            'total_pnl': total_pnl,
            'positions': positions
        }
    
    # ==================== 资产相关 ====================
    
    def list_assets(self, status: str = 'active') -> List[dict]:
        """查询可交易资产"""
        result = self._request('GET', f'assets?status={status}')
        return result if isinstance(result, list) else []
    
    def get_asset(self, symbol: str) -> dict:
        """查询单个资产信息"""
        return self._request('GET', f'assets/{symbol}')
    
    # ==================== 实时行情 ====================
    
    def get_latest_quote(self, symbol: str) -> dict:
        """获取最新报价"""
        return self._request('GET', f'stocks/{symbol}/quotes/latest')
    
    def get_latest_trade(self, symbol: str) -> dict:
        """获取最新成交"""
        return self._request('GET', f'stocks/{symbol}/trades/latest')
    
    def get_bars(
        self,
        symbol: str,
        timeframe: str = '1D',  # 1Min/5Min/15Min/1H/1D
        start: str = None,
        end: str = None,
        limit: int = 100
    ) -> List[dict]:
        """获取K线数据"""
        params = f'timeframe={timeframe}&limit={limit}'
        if start:
            params += f'&start={start}'
        if end:
            params += f'&end={end}'
        
        return self._request('GET', f'stocks/{symbol}/bars?{params}')
    
    # ==================== 余额 ====================
    
    def is_tradeable(self, symbol: str) -> bool:
        """检查股票是否可交易"""
        try:
            asset = self.get_asset(symbol)
            return asset.get('status') == 'active' and asset.get('tradable', False)
        except:
            return False
    
    def get_buying_power(self) -> float:
        """获取购买力"""
        account = self.get_account()
        return float(account.get('buying_power', 0))


# 测试
if __name__ == '__main__':
    try:
        client = AlpacaClient()
        
        # 测试账户
        print('=== 测试账户 ===')
        print(client.get_account_status())
        
        # 测试持仓
        print('\n=== 测试持仓 ===')
        print(client.get_position_summary())
        
    except Exception as e:
        print(f'测试失败: {e}')
        print('请设置环境变量: APCA_API_KEY_ID, APCA_API_SECRET_KEY')