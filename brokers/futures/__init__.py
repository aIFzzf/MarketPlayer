"""
期货交易Broker模块

支持的券商:
- CTP: 国内期货（Simnow模拟/生产环境）
- Interactive Brokers: 国际期货
- Binance: 加密货币期货

目录结构:
- base_futures_broker.py: 抽象基类
- ctp_broker.py: CTP接口实现
- ib_futures_broker.py: IB接口实现（未来）
- binance_futures_broker.py: Binance接口实现（未来）
"""

from .base_futures_broker import BaseFuturesBroker, FuturesBrokerErrors

__all__ = ['BaseFuturesBroker', 'FuturesBrokerErrors']
