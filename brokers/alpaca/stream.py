"""
WebSocket 实时行情流
"""

import os
import json
import asyncio
import threading
from typing import Callable, List, Dict


class AlpacaStream:
    """Alpaca WebSocket 行情流"""
    
    def __init__(self, api_key: str = None, secret_key: str = None, base_url: str = None):
        """
        初始化WebSocket流
        
        Args:
            api_key: Alpaca API Key
            secret_key: Alpaca Secret Key
            base_url: Stream端点 (wss://stream-api.alpaca.markets)
        """
        self.api_key = api_key or os.getenv('APCA_API_KEY_ID')
        self.secret_key = secret_key or os.getenv('APCA_API_SECRET_KEY')
        self.base_url = base_url or os.getenv('APCA_DATA_URL', 'wss://stream.data.alpaca.markets').replace('https://', 'wss://').replace('http://', 'ws://')
        
        self.ws = None
        self.subscriptions = set()
        self.callbacks = {'trade': [], 'quote': [], 'bar': []}
        self.running = False
        self.thread = None
    
    def subscribe_trades(self, callback: Callable, symbols: List[str]):
        """订阅成交数据"""
        self.callbacks['trade'].append({'callback': callback, 'symbols': symbols})
        self.subscriptions.update(symbols)
        
        if self.running:
            self._send_subscription('trade', symbols)
    
    def subscribe_quotes(self, callback: Callable, symbols: List[str]):
        """订阅报价数据"""
        self.callbacks['quote'].append({'callback': callback, 'symbols': symbols})
        self.subscriptions.update(symbols)
        
        if self.running:
            self._send_subscription('quote', symbols)
    
    def subscribe_bars(self, callback: Callable, symbols: List[str]):
        """订阅K线数据"""
        self.callbacks['bar'].append({'callback': callback, 'symbols': symbols})
        self.subscriptions.update(symbols)
        
        if self.running:
            self._send_subscription('bar', symbols)
    
    def _send_subscription(self, data_type: str, symbols: List[str]):
        """发送订阅请求"""
        if not self.ws:
            return
        
        msg = {
            'action': 'subscribe',
            'data': {data_type: symbols}
        }
        self.ws.send(json.dumps(msg))
    
    def _handle_message(self, message: str):
        """处理接收到的消息"""
        try:
            data = json.loads(message)
            
            if 'data' in data:
                msg_type = data.get('data', {}).get('T')
                
                if msg_type == 't':  # Trade
                    trade_data = data['data']
                    for cb in self.callbacks['trade']:
                        if trade_data['S'] in cb['symbols']:
                            cb['callback'](trade_data)
                
                elif msg_type == 'q':  # Quote
                    quote_data = data['data']
                    for cb in self.callbacks['quote']:
                        if quote_data['S'] in cb['symbols']:
                            cb['callback'](quote_data)
                
                elif msg_type == 'b':  # Bar
                    bar_data = data['data']
                    for cb in self.callbacks['bar']:
                        if bar_data['S'] in cb['symbols']:
                            cb['callback'](bar_data)
                            
        except Exception as e:
            print(f'消息解析错误: {e}')
    
    def _connect(self):
        """建立WebSocket连接"""
        try:
            import websocket
            
            self.ws = websocket.WebSocketApp(
                self.base_url,
                on_message=self._on_message,
                on_error=self._on_error,
                on_close=self._on_close,
                on_open=self._on_open,
                header={
                    'APCA-API-KEY-ID': self.api_key,
                    'APCA-API-SECRET-KEY': self.secret_key
                }
            )
            
            self.ws.run_forever()
        except ImportError:
            print('需要安装websocket-client: pip install websocket-client')
    
    def _on_open(self, ws):
        """连接打开"""
        print('Alpaca WebSocket 已连接')
        self.running = True
        
        # 发送订阅
        if self.subscriptions:
            msg = {
                'action': 'subscribe',
                'data': {
                    'trade': list(self.subscriptions),
                    'quote': list(self.subscriptions),
                    'bar': list(self.subscriptions)
                }
            }
            ws.send(json.dumps(msg))
    
    def _on_message(self, ws, message):
        """接收消息"""
        self._handle_message(message)
    
    def _on_error(self, ws, error):
        """错误处理"""
        print(f'Alpaca WebSocket 错误: {error}')
    
    def _on_close(self, ws, close_status_code, close_msg):
        """连接关闭"""
        print('Alpaca WebSocket 已关闭')
        self.running = False
    
    def start(self):
        """启动流"""
        if self.running:
            return
        
        self.thread = threading.Thread(target=self._connect, daemon=True)
        self.thread.start()
    
    def stop(self):
        """停止流"""
        self.running = False
        if self.ws:
            self.ws.close()
        if self.thread:
            self.thread.join(timeout=5)


# 简化的REST行情查询（替代WebSocket）
class MarketDataClient:
    """市场数据客户端（REST API）"""
    
    def __init__(self, client):
        self.client = client
    
    def get_latest_price(self, symbol: str) -> float:
        """获取最新价格"""
        try:
            trade = self.client.get_latest_trade(symbol)
            return float(trade.get('p', 0))
        except:
            return 0
    
    def get_latest_quote(self, symbol: str) -> dict:
        """获取最新报价"""
        return self.client.get_latest_quote(symbol)
    
    def get_historical_bars(
        self,
        symbol: str,
        timeframe: str = '1D',
        limit: int = 100
    ) -> List[dict]:
        """获取历史K线"""
        bars = self.client.get_bars(symbol, timeframe, limit=limit)
        
        result = []
        for bar in bars:
            result.append({
                'timestamp': bar.get('t'),
                'open': float(bar.get('o', 0)),
                'high': float(bar.get('h', 0)),
                'low': float(bar.get('l', 0)),
                'close': float(bar.get('c', 0)),
                'volume': int(bar.get('v', 0))
            })
        
        return result


if __name__ == '__main__':
    # 测试
    try:
        from .client import AlpacaClient
        
        client = AlpacaClient()
        
        # 测试REST行情
        md = MarketDataClient(client)
        bars = md.get_historical_bars('AAPL', '1D', 5)
        print('AAPL K线:')
        for bar in bars:
            print(f"  {bar['timestamp']}: {bar['close']}")
        
    except Exception as e:
        print(f'测试失败: {e}')