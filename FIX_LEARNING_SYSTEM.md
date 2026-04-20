# 学习系统修复指南

**问题**: learning-agent离线7天，定时任务未配置，数据库为空

**修复时间**: 10-15分钟

---

## 步骤1: 找到正确的Node路径 ✅

```bash
# 查找node路径
which node

# 输出类似: /opt/anaconda3/bin/node 或 /usr/local/bin/node
```

**记下这个路径，下一步会用到。**

---

## 步骤2: 修复launchd配置 ✅

编辑 `com.marketplayer.learning.plist`：

```xml
<key>ProgramArguments</key>
<array>
    <string>/opt/anaconda3/bin/node</string>  <!-- 改成实际node路径 -->
    <string>/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/agents/harness/trigger-engine/learning-trigger.js</string>
</array>
```

---

## 步骤3: 加载launchd任务 ✅

```bash
cd ~/.openclaw/workspace/MarketPlayer

# 1. 复制plist到LaunchAgents
cp com.marketplayer.learning.plist ~/Library/LaunchAgents/

# 2. 加载任务
launchctl load ~/Library/LaunchAgents/com.marketplayer.learning.plist

# 3. 验证加载成功
launchctl list | grep marketplayer
# 应该看到: com.marketplayer.learning

# 4. 查看任务状态
launchctl print user/$(id -u)/com.marketplayer.learning
```

---

## 步骤4: 初始化PostgreSQL数据库 ✅

### 4.1 检查PostgreSQL是否运行

```bash
# 检查PostgreSQL进程
ps aux | grep postgres

# 如果没有运行，启动PostgreSQL
brew services start postgresql@14
# 或
pg_ctl -D /usr/local/var/postgres start
```

### 4.2 创建数据库（如果不存在）

```bash
# 检查数据库是否存在
psql -l | grep trading_bot

# 如果不存在，创建数据库
createdb trading_bot

# 或通过psql创建
psql -c "CREATE DATABASE trading_bot;"
```

### 4.3 执行建表脚本

```bash
cd ~/.openclaw/workspace/MarketPlayer

# 创建quant学习表
psql -d trading_bot -f database/migrations/create-quant-learning-tables.sql

# 创建value学习表
psql -d trading_bot -f database/migrations/create-value-learning-tables.sql

# 验证表是否创建成功
psql -d trading_bot -c "\dt"
```

**应该看到以下表**:
- quant_signals
- quant_parameter_evolution
- quant_daily_metrics
- quant_failure_patterns
- value_*相关表

---

## 步骤5: 手动触发一次学习任务（测试）✅

```bash
cd ~/.openclaw/workspace/MarketPlayer

# 找到正确的node路径后执行
/opt/anaconda3/bin/node agents/harness/trigger-engine/learning-trigger.js

# 或者使用which node找到的路径
$(which node) agents/harness/trigger-engine/learning-trigger.js

# 查看日志
tail -f logs/learning.log
```

**期望输出**: 
- 连接数据库成功
- 生成学习任务
- learning-agent开始工作

---

## 步骤6: 检查数据库是否有记录 ✅

```bash
# 连接数据库
psql -d trading_bot

# 查询learning_actions（如果这个表存在）
SELECT * FROM learning_actions LIMIT 10;

# 查询quant_signals
SELECT COUNT(*) FROM quant_signals;

# 查询parameter evolution
SELECT * FROM quant_parameter_evolution ORDER BY created_at DESC LIMIT 5;

# 退出
\q
```

---

## 步骤7: 验证定时任务正常工作 ✅

### 方法1: 等待明天02:00自动执行

```bash
# 次日检查日志
cat logs/learning.log

# 应该看到新的时间戳记录
```

### 方法2: 手动更改时间测试（可选）

```bash
# 临时修改plist时间为5分钟后
# 编辑 ~/Library/LaunchAgents/com.marketplayer.learning.plist
# 将Hour和Minute改为5分钟后的时间

# 重新加载
launchctl unload ~/Library/LaunchAgents/com.marketplayer.learning.plist
launchctl load ~/Library/LaunchAgents/com.marketplayer.learning.plist

# 5分钟后检查日志
tail -f logs/learning.log
```

---

## 步骤8: 检查learning-agent活跃状态 ✅

```bash
# 查看agent最后活跃时间
cd ~/.openclaw/workspace/MarketPlayer

# 检查agent日志
find logs -name "*learning*" -o -name "*agent*" | xargs ls -lt | head -20

# 查看memory文件
ls -lt memory/*learning* 2>/dev/null

# 检查数据库agent状态
psql -d trading_bot -c "SELECT * FROM agent_status WHERE agent_name LIKE '%learning%';"
```

---

## 常见问题排查

### Q1: launchctl load失败

```bash
# 查看详细错误
launchctl bootstrap user/$(id -u) ~/Library/LaunchAgents/com.marketplayer.learning.plist

# 检查plist语法
plutil -lint ~/Library/LaunchAgents/com.marketplayer.learning.plist

# 权限问题
chmod 644 ~/Library/LaunchAgents/com.marketplayer.learning.plist
```

### Q2: PostgreSQL连接失败

```bash
# 检查.env配置
cat .env | grep DATABASE

# 测试连接
psql -d trading_bot -c "SELECT NOW();"

# 查看PostgreSQL日志
tail -f /usr/local/var/log/postgresql@14.log
```

### Q3: Node版本问题

```bash
# 检查node版本
node -v

# 如果版本过旧，升级
brew upgrade node
```

---

## 验证清单

完成所有步骤后，验证以下项：

- [ ] `launchctl list | grep marketplayer` 有输出
- [ ] `psql -d trading_bot -c "\dt"` 显示所有学习表
- [ ] `ls -lt logs/learning.log` 显示最近的时间戳
- [ ] `psql -d trading_bot -c "SELECT COUNT(*) FROM quant_signals;"` 返回数字（可能是0）
- [ ] 明天02:00后检查learning.log有新记录

---

## 快速修复脚本

```bash
#!/bin/bash
# fix-learning-system.sh

cd ~/.openclaw/workspace/MarketPlayer

echo "🔧 修复学习系统..."

# 1. 找到node路径
NODE_PATH=$(which node)
echo "✅ Node路径: $NODE_PATH"

# 2. 更新plist
sed -i.bak "s|/usr/local/bin/node|$NODE_PATH|g" com.marketplayer.learning.plist
echo "✅ 更新plist node路径"

# 3. 复制并加载
cp com.marketplayer.learning.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.marketplayer.learning.plist
echo "✅ 加载launchd任务"

# 4. 初始化数据库
psql -d trading_bot -f database/migrations/create-quant-learning-tables.sql
psql -d trading_bot -f database/migrations/create-value-learning-tables.sql
echo "✅ 初始化数据库"

# 5. 测试运行
echo "🧪 测试运行learning-trigger..."
$NODE_PATH agents/harness/trigger-engine/learning-trigger.js

echo "✨ 修复完成！"
echo "📊 查看launchctl状态: launchctl list | grep marketplayer"
echo "📊 查看数据库: psql -d trading_bot -c '\dt'"
```

---

**修复后，系统将恢复**:
- ✅ 每日02:00自动学习闭环
- ✅ learning_actions数据持续积累
- ✅ learning-agent自动活跃
- ✅ 长线短线策略持续优化
