"""
因子计算器 - Python 版本
"""

import os
import json
import numpy as np

# 数据目录
KLINES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'cache', 'klines')
FUNDAMENTAL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'fundamental')


def load_klines(symbol):
    """加载K线数据"""
    for prefix in ['us_', 'hk_', 'a_']:
        filepath = os.path.join(KLINES_DIR, f'{prefix}{symbol}.json')
        if os.path.exists(filepath):
            with open(filepath) as f:
                data = json.load(f)
            klines = data.get('klines', data)
            return {
                'close': np.array([float(k.get('close', 0)) for k in klines], dtype=float),
                'open': np.array([float(k.get('open', 0)) for k in klines], dtype=float),
                'high': np.array([float(k.get('high', 0)) for k in klines], dtype=float),
                'low': np.array([float(k.get('low', 0)) for k in klines], dtype=float),
                'volume': np.array([float(k.get('volume', 0)) for k in klines], dtype=float),
            }
    return None


def load_fundamental(symbol):
    """加载财务数据"""
    filepath = os.path.join(FUNDAMENTAL_DIR, f'{symbol}_fundamental.json')
    if os.path.exists(filepath):
        with open(filepath) as f:
            return json.load(f)
    return {}


def momentum(close, period):
    """动量因子"""
    if len(close) < period + 1:
        return 0
    return close[-1] / close[-period-1] - 1


def rsi(close, period=14):
    """RSI因子"""
    if len(close) < period + 1:
        return 0
    
    gains, losses = 0, 0
    for i in range(-period, 0):
        change = close[i] - close[i-1]
        if change > 0:
            gains += change
        else:
            losses -= change
    
    avg_gain = gains / period
    avg_loss = losses / period
    
    if avg_loss == 0:
        return 100
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def macd(close, fast=12, slow=26, signal=9):
    """MACD因子"""
    if len(close) < slow + signal:
        return 0
    
    # EMA
    ema_fast = close[-slow:].mean()  # 简化
    ema_slow = close[-slow*2:].mean()
    macd_line = ema_fast - ema_slow
    
    return macd_line


def pe_ratio(fundamental, price):
    """PE因子"""
    eps = fundamental.get('eps', 0)
    if eps == 0:
        return 0
    return price / eps


def pb_ratio(fundamental, price):
    """PB因子"""
    bvps = fundamental.get('bookValuePerShare', 0)
    if bvps == 0:
        return 0
    return price / bvps


def roe(fundamental):
    """ROE因子"""
    return fundamental.get('roe', 0)


def gross_margin(fundamental):
    """毛利率"""
    return fundamental.get('grossMargin', 0)


def volatility(close, period=20):
    """波动率"""
    if len(close) < period + 1:
        return 0
    
    returns = np.diff(close[-period-1:]) / close[-period-1:-1]
    return np.std(returns)


def atr(high, low, close, period=14):
    """ATR因子"""
    if len(close) < period + 1:
        return 0
    
    tr = []
    for i in range(1, len(close)):
        h_l = high[i] - low[i]
        h_c = abs(high[i] - close[i-1])
        l_c = abs(low[i] - close[i-1])
        tr.append(max(h_l, h_c, l_c))
    
    return np.mean(tr[-period:])


def turnover(volume, period=20):
    """换手率"""
    if len(volume) < period:
        return 0
    
    avg = np.mean(volume[-period:])
    if avg == 0:
        return 0
    return volume[-1] / avg


def volume_ratio(volume):
    """量比"""
    if len(volume) < 6:
        return 0
    
    avg5 = np.mean(volume[-5:])
    if avg5 == 0:
        return 0
    return volume[-1] / avg5


def calculate_all_factors(symbol):
    """计算单只股票所有因子"""
    klines = load_klines(symbol)
    if klines is None or len(klines['close']) < 50:
        return None
    
    fundamental = load_fundamental(symbol)
    price = klines['close'][-1]
    
    factors = {
        'MOM_20': momentum(klines['close'], 20),
        'MOM_60': momentum(klines['close'], 60),
        'MOM_120': momentum(klines['close'], 120),
        'RSI_14': rsi(klines['close'], 14),
        'MACD': macd(klines['close']),
        'PE': pe_ratio(fundamental, price),
        'PB': pb_ratio(fundamental, price),
        'ROE': roe(fundamental),
        'GROSS_MARGIN': gross_margin(fundamental),
        'VOL_20': volatility(klines['close'], 20),
        'VOL_60': volatility(klines['close'], 60),
        'ATR_14': atr(klines['high'], klines['low'], klines['close'], 14),
        'TURNOVER_20': turnover(klines['volume'], 20),
        'VOLUME_RATIO': volume_ratio(klines['volume']),
    }
    
    return {
        'symbol': symbol,
        'date': __import__('datetime').datetime.now().strftime('%Y-%m-%d'),
        'factors': factors
    }


def calculate_batch_factors(symbols):
    """批量计算"""
    results = []
    for symbol in symbols:
        result = calculate_all_factors(symbol)
        if result:
            results.append(result)
    return results


if __name__ == '__main__':
    import sys
    symbols = sys.argv[1:] if len(sys.argv) > 1 else ['AAPL', 'MSFT', 'GOOGL']
    
    print(f'计算 {len(symbols)} 只股票因子...')
    results = calculate_batch_factors(symbols)
    
    for r in results:
        print(f"\n{r['symbol']}:")
        for k, v in r['factors'].items():
            print(f'  {k}: {v:.4f}' if isinstance(v, float) else f'  {k}: {v}')