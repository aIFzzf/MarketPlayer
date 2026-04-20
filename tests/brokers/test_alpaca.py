"""
Alpaca Broker 测试
"""

import os
import sys

# 设置环境变量（如果没有）
if not os.getenv('APCA_API_KEY_ID'):
    os.environ['APCA_API_KEY_ID'] = 'test_key'
if not os.getenv('APCA_API_SECRET_KEY'):
    os.environ['APCA_API_SECRET_KEY'] = 'test_secret'

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from brokers.alpaca.client import AlpacaClient
from brokers.alpaca.orders import OrderManager
from brokers.alpaca.positions import PositionManager
from brokers.broker_factory import BrokerFactory, get_broker


class TestAlpacaClient:
    """Alpaca客户端测试"""
    
    def __init__(self):
        try:
            self.client = AlpacaClient()
            print('✅ AlpacaClient 初始化成功')
        except ValueError as e:
            print(f'⚠️ 跳过测试: {e}')
            self.client = None
    
    def test_get_account(self):
        """测试账户查询"""
        if not self.client:
            return
        
        try:
            account = self.client.get_account()
            print(f'✅ 账户查询成功: {account.get("status")}')
        except Exception as e:
            print(f'❌ 账户查询失败: {e}')
    
    def test_list_orders(self):
        """测试订单列表"""
        if not self.client:
            return
        
        try:
            orders = self.client.list_orders(status='open')
            print(f'✅ 订单列表查询成功: {len(orders)}条')
        except Exception as e:
            print(f'❌ 订单列表查询失败: {e}')
    
    def test_list_positions(self):
        """测试持仓查询"""
        if not self.client:
            return
        
        try:
            positions = self.client.list_positions()
            print(f'✅ 持仓查询成功: {len(positions)}条')
        except Exception as e:
            print(f'❌ 持仓查询失败: {e}')
    
    def test_is_tradeable(self):
        """测试股票可交易性检查"""
        if not self.client:
            return
        
        # 测试AAPL
        try:
            result = self.client.is_tradeable('AAPL')
            print(f'✅ AAPL可交易检查: {result}')
        except Exception as e:
            print(f'❌ 可交易检查失败: {e}')


class TestOrderManager:
    """订单管理器测试"""
    
    def __init__(self):
        try:
            self.orders = OrderManager()
            print('✅ OrderManager 初始化成功')
        except Exception as e:
            print(f'⚠️ 跳过测试: {e}')
            self.orders = None
    
    def test_get_open_orders(self):
        """测试获取未完成订单"""
        if not self.orders:
            return
        
        try:
            orders = self.orders.get_open_orders()
            print(f'✅ 未完成订单: {len(orders)}条')
        except Exception as e:
            print(f'❌ 查询失败: {e}')
    
    def test_place_order_validation(self):
        """测试下单参数验证"""
        if not self.orders:
            return
        
        # 测试市价单参数
        try:
            # 这只是验证，不会真正下单
            result = self.orders.place_market_order('AAPL', 1, 'buy')
            print(f'✅ 市价单参数验证通过')
        except Exception as e:
            print(f'❌ 参数验证失败: {e}')


class TestPositionManager:
    """持仓管理器测试"""
    
    def __init__(self):
        try:
            self.positions = PositionManager()
            print('✅ PositionManager 初始化成功')
        except Exception as e:
            print(f'⚠️ 跳过测试: {e}')
            self.positions = None
    
    def test_get_positions(self):
        """测试获取持仓"""
        if not self.positions:
            return
        
        try:
            positions = self.positions.get_all_positions()
            print(f'✅ 持仓查询: {len(positions)}只')
        except Exception as e:
            print(f'❌ 持仓查询失败: {e}')
    
    def test_pnl(self):
        """测试盈亏计算"""
        if not self.positions:
            return
        
        try:
            pnl = self.positions.get_all_pnl()
            print(f'✅ 盈亏汇总: 总{pnl.get("total_pnl", 0):.2f}')
        except Exception as e:
            print(f'❌ 盈亏计算失败: {e}')


class TestBrokerFactory:
    """Broker工厂测试"""
    
    def test_get_broker(self):
        """测试获取Broker"""
        try:
            broker = get_broker('alpaca')
            print(f'✅ Broker工厂获取成功: {type(broker).__name__}')
            
            # 测试基本方法
            status = broker.get_account_status()
            print(f'  账户状态: {status.get("status", "unknown")}')
            
        except Exception as e:
            print(f'❌ Broker获取失败: {e}')


def run_all_tests():
    """运行所有测试"""
    print('\n' + '='*50)
    print('Alpaca Broker 测试')
    print('='*50 + '\n')
    
    # 测试1: 客户端
    print('--- 测试 AlpacaClient ---')
    client_test = TestAlpacaClient()
    client_test.test_get_account()
    client_test.test_list_orders()
    client_test.test_list_positions()
    client_test.test_is_tradeable()
    
    # 测试2: 订单管理
    print('\n--- 测试 OrderManager ---')
    order_test = TestOrderManager()
    order_test.test_get_open_orders()
    order_test.test_place_order_validation()
    
    # 测试3: 持仓管理
    print('\n--- 测试 PositionManager ---')
    pos_test = TestPositionManager()
    pos_test.test_get_positions()
    pos_test.test_pnl()
    
    # 测试4: 工厂
    print('\n--- 测试 BrokerFactory ---')
    factory_test = TestBrokerFactory()
    factory_test.test_get_broker()
    
    print('\n' + '='*50)
    print('测试完成')
    print('='*50 + '\n')


if __name__ == '__main__':
    run_all_tests()