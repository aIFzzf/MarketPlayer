"""
单元测试 - 新闻优先级分类器
"""

import unittest
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from classifier import NewsClassifier


class TestNewsClassifier(unittest.TestCase):
    """测试新闻分类器"""
    
    def setUp(self):
        self.classifier = NewsClassifier()
    
    def test_critical_level(self):
        """测试 CRITICAL 级别 (总分 >= 70)"""
        news = {
            'title': '市场崩盘！全球金融危机',
            'content': '股市暴跌50%，引发全球恐慌',
            'sentiment': 'negative',
            'symbols': 'AAPL,MSFT,GOOG,AMZN,META',
            'source': 'bloomberg'
        }
        level = self.classifier.calculate_alert_level(news)
        self.assertEqual(level, 1)
    
    def test_high_level(self):
        """测试 HIGH 级别 (总分 50-69)"""
        news = {
            'title': '公司被监管调查',
            'content': '涉嫌违规被调查',
            'sentiment': 'negative',
            'symbols': 'AAPL,MSFT',
            'source': 'eastmoney'
        }
        level = self.classifier.calculate_alert_level(news)
        self.assertEqual(level, 2)
    
    def test_medium_level(self):
        """测试 MEDIUM 级别 (总分 30-49)"""
        news = {
            'title': '一般新闻',
            'content': '中性新闻内容',
            'sentiment': 'neutral',
            'symbols': 'AAPL',
            'source': 'sina'
        }
        level = self.classifier.calculate_alert_level(news)
        self.assertEqual(level, 3)
    
    def test_low_level(self):
        """测试 LOW 级别 (总分 < 30)"""
        news = {
            'title': '日常新闻',
            'content': '一般性新闻报道',
            'sentiment': 'neutral',
            'symbols': '',
            'source': 'other'
        }
        level = self.classifier.calculate_alert_level(news)
        self.assertEqual(level, 4)
    
    def test_sentiment_score_extreme_negative(self):
        """测试极度负面情绪"""
        score = self.classifier._calc_sentiment_score('negative')
        self.assertEqual(score, 25)
        
        score = self.classifier._calc_sentiment_score('extremely_negative')
        self.assertEqual(score, 40)
    
    def test_impact_score(self):
        """测试影响范围评分"""
        # >= 5 股票
        score = self.classifier._calc_impact_score(['AAPL', 'MSFT', 'GOOG', 'AMZN', 'META'])
        self.assertEqual(score, 30)
        
        # 3-4 股票
        score = self.classifier._calc_impact_score(['AAPL', 'MSFT', 'GOOG'])
        self.assertEqual(score, 20)
        
        # 1-2 股票
        score = self.classifier._calc_impact_score(['AAPL'])
        self.assertEqual(score, 10)
        
        # 无股票
        score = self.classifier._calc_impact_score([])
        self.assertEqual(score, 5)
    
    def test_source_score(self):
        """测试来源可信度"""
        # 高可信
        score = self.classifier._calc_source_score('bloomberg')
        self.assertEqual(score, 20)
        
        score = self.classifier._calc_source_score('reuters')
        self.assertEqual(score, 20)
        
        # 中可信
        score = self.classifier._calc_source_score('cnbc')
        self.assertEqual(score, 15)
        
        score = self.classifier._calc_source_score('yahoo_finance')
        self.assertEqual(score, 15)
        
        # 低可信
        score = self.classifier._calc_source_score('eastmoney')
        self.assertEqual(score, 10)
        
        score = self.classifier._calc_source_score('xueqiu')
        self.assertEqual(score, 10)
    
    def test_keyword_score(self):
        """测试关键词加权"""
        # 黑天鹅
        score = self.classifier._calc_keyword_score('市场暴跌崩盘危机')
        self.assertEqual(score, 10)
        
        # 监管
        score = self.classifier._calc_keyword_score('公司被监管调查')
        self.assertEqual(score, 8)
        
        # 财报
        score = self.classifier._calc_keyword_score('财报超预期盈利')
        self.assertEqual(score, 6)
        
        # 并购
        score = self.classifier._calc_keyword_score('公司并购重组')
        self.assertEqual(score, 5)
        
        # 无关键词
        score = self.classifier._calc_keyword_score('日常新闻')
        self.assertEqual(score, 0)
    
    def test_batch_classify(self):
        """测试批量分类"""
        news_list = [
            {'title': '崩盘', 'sentiment': 'negative', 'symbols': 'AAPL', 'source': 'bloomberg'},
            {'title': '日常', 'sentiment': 'neutral', 'symbols': '', 'source': 'other'},
        ]
        results = self.classifier.classify_batch(news_list)
        
        self.assertEqual(len(results), 2)
        self.assertIn('alert_level', results[0])
        self.assertIn('alert_level', results[1])


if __name__ == '__main__':
    unittest.main(verbosity=2)