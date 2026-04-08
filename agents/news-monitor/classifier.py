"""
新闻优先级分类器
基于情绪、影响范围、来源可信度、关键词计算 alert_level
"""

from typing import Dict, List, Optional
import re


class NewsClassifier:
    """新闻优先级分类器"""
    
    # 关键词加权
    KEYWORD_WEIGHTS = {
        # 黑天鹅事件 (+10)
        'black_swan': ['暴跌', '崩盘', '危机', '大跌', '跳水', '闪崩', 'crash', 'collapse', 'crisis', 'plunge'],
        # 监管政策 (+8)
        'regulatory': ['制裁', '调查', '违规', '处罚', '监管', '审查', 'sanction', 'investigation', 'probe', 'ban'],
        # 财报业绩 (+6)
        'earnings': ['超预期', '暴雷', '亏损', '盈利', '财报', '业绩', 'earnings', 'profit', 'loss', 'revenue'],
        # 并购重组 (+5)
        'mergers': ['并购', '收购', '重组', '合并', '私有化', 'merger', 'acquisition', 'takeover', 'm&a'],
    }
    
    # 来源可信度
    SOURCE_CREDIBILITY = {
        'high': ['bloomberg', 'reuters', 'wsj', 'financial_times', '华尔街日报', '路透', '彭博'],
        'medium': ['cnbc', 'yahoo_finance', 'yahoo', '华尔街见闻'],
        'low': ['eastmoney', 'xueqiu', 'sina', '雪球', '新浪', '东方财富'],
    }
    
    def __init__(self):
        self.max_score = 100
    
    def calculate_alert_level(self, news: Dict) -> int:
        """
        计算新闻优先级 (1-4)
        
        Args:
            news: 新闻字典，需要包含 sentiment, symbols, source, title, content
            
        Returns:
            alert_level: 1=CRITICAL, 2=HIGH, 3=MEDIUM, 4=LOW
        """
        score = 0
        
        # 1. 情绪强度 (40分)
        score += self._calc_sentiment_score(news.get('sentiment', 'neutral'))
        
        # 2. 影响范围 (30分)
        score += self._calc_impact_score(news.get('symbols', []))
        
        # 3. 来源可信度 (20分)
        score += self._calc_source_score(news.get('source', ''))
        
        # 4. 关键词加权 (10分)
        text = f"{news.get('title', '')} {news.get('content', '')}"
        score += self._calc_keyword_score(text)
        
        # 映射到优先级
        return self._map_score_to_level(score)
    
    def _calc_sentiment_score(self, sentiment: str) -> int:
        """情绪强度评分"""
        sentiment_map = {
            'extremely_negative': 40,
            'very_negative': 30,
            'negative': 25,
            'neutral': 10,
            'positive': 20,
            'very_positive': 35,
            'extremely_positive': 35,
        }
        return sentiment_map.get(sentiment, 10)
    
    def _calc_impact_score(self, symbols: List[str]) -> int:
        """影响范围评分"""
        if not symbols or (isinstance(symbols, str) and not symbols.strip()):
            return 5
        
        # 解析股票列表
        if isinstance(symbols, str):
            sym_list = [s.strip() for s in symbols.split(',') if s.strip()]
        else:
            sym_list = symbols
        
        count = len(sym_list)
        
        if count >= 5:
            return 30
        elif count >= 3:
            return 20
        elif count >= 1:
            return 10
        else:
            return 5
    
    def _calc_source_score(self, source: str) -> int:
        """来源可信度评分"""
        if not source:
            return 5
        
        source_lower = source.lower()
        
        # 高可信来源
        for s in self.SOURCE_CREDIBILITY['high']:
            if s in source_lower:
                return 20
        
        # 中可信来源
        for s in self.SOURCE_CREDIBILITY['medium']:
            if s in source_lower:
                return 15
        
        # 低可信来源
        for s in self.SOURCE_CREDIBILITY['low']:
            if s in source_lower:
                return 10
        
        return 5
    
    def _calc_keyword_score(self, text: str) -> int:
        """关键词加权"""
        if not text:
            return 0
        
        text_lower = text.lower()
        score = 0
        
        # 黑天鹅事件
        for kw in self.KEYWORD_WEIGHTS['black_swan']:
            if kw in text_lower:
                score += 10
                break
        
        # 监管政策
        for kw in self.KEYWORD_WEIGHTS['regulatory']:
            if kw in text_lower:
                score += 8
                break
        
        # 财报业绩
        for kw in self.KEYWORD_WEIGHTS['earnings']:
            if kw in text_lower:
                score += 6
                break
        
        # 并购重组
        for kw in self.KEYWORD_WEIGHTS['mergers']:
            if kw in text_lower:
                score += 5
                break
        
        # 上限10分
        return min(score, 10)
    
    def _map_score_to_level(self, score: int) -> int:
        """分数映射到优先级"""
        if score >= 70:
            return 1  # CRITICAL
        elif score >= 50:
            return 2  # HIGH
        elif score >= 30:
            return 3  # MEDIUM
        else:
            return 4  # LOW
    
    def classify_batch(self, news_list: List[Dict]) -> List[Dict]:
        """批量分类"""
        results = []
        for news in news_list:
            alert_level = self.calculate_alert_level(news)
            results.append({
                **news,
                'alert_level': alert_level
            })
        return results


def map_sentiment_to_level(sentiment_score: float) -> str:
    """将情绪分数映射到级别"""
    if sentiment_score <= -0.7:
        return 'extremely_negative'
    elif sentiment_score <= -0.3:
        return 'negative'
    elif sentiment_score < 0.3:
        return 'neutral'
    elif sentiment_score < 0.7:
        return 'positive'
    else:
        return 'positive'


# 测试
if __name__ == '__main__':
    classifier = NewsClassifier()
    
    test_cases = [
        {
            'title': 'A股暴跌！市场崩盘投资者恐慌',
            'content': '今日A股市场大幅下跌，跌幅超过5%',
            'sentiment': 'negative',
            'symbols': 'AAPL,MSFT,GOOG',
            'source': 'bloomberg'
        },
        {
            'title': '苹果发布超预期财报',
            'content': '苹果季度营收超预期10%',
            'sentiment': 'positive',
            'symbols': 'AAPL',
            'source': 'cnbc'
        },
        {
            'title': '公司获得监管批准',
            'content': '公司业务获得监管部门批准',
            'sentiment': 'neutral',
            'symbols': '',
            'source': 'eastmoney'
        },
    ]
    
    print('=== 优先级分类测试 ===')
    for news in test_cases:
        level = classifier.calculate_alert_level(news)
        level_names = {1: 'CRITICAL', 2: 'HIGH', 3: 'MEDIUM', 4: 'LOW'}
        print(f"标题: {news['title'][:30]}...")
        print(f"  优先级: {level} ({level_names[level]})")
        print()