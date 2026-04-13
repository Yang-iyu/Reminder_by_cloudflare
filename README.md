# 🐱 喵提醒自动化任务系统（Cloudflare Workers + D1）

本项目及文档完全由copilot AI自动程序完成。

一个基于 **Cloudflare Workers + D1 + Cron Triggers** 的轻量级自动化任务系统。  
支持 **多 Cron、时区转换、日志记录、统计图、后台管理界面**，并兼容旧版本的单 Cron 任务结构。

适用于：

- 定时访问 URL  
- 定时触发 Webhook  
- 定时执行健康检查  
- 定时推送通知  
- 定时同步数据  

无需服务器、无需容器、无需运维，部署后即可长期稳定运行。

---

# ✨ 功能特性

- **多 Cron 支持**：一个任务可绑定多个 Cron 表达式  
- **时区支持**：前端填写本地时间，自动转换为 UTC 存储  
- **旧任务兼容**：保留单 Cron 任务结构  
- **后台管理界面**：新增、编辑、删除、启用、禁用任务  
- **执行日志**：记录执行时间、状态码、耗时、错误信息  
- **统计图**：可视化展示任务执行耗时趋势  
- **安全登录**：基于 Cookie 的后台登录  
- **无服务器部署**：基于 Cloudflare Workers + D1  
- **零依赖**：前端使用 Tailwind + 原生 JS  

---

# 🚀 快速开始（Quick Start）

## 1. 克隆项目

```bash
git clone https://github.com/xxx/reminder-worker.git
cd reminder-worker
```

## 2. 配置环境变量

在 Cloudflare Workers → Settings → Variables 中添加：

| 变量名 | 说明 |
|-------|------|
| `ADMIN_PASSWORD` | 后台登录密码 |

## 3. 初始化数据库

在 Cloudflare D1 控制台执行：

```sql
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  cron TEXT,
  remark TEXT,
  enabled INTEGER DEFAULT 1,
  last_run TEXT
);

CREATE TABLE task_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  cron TEXT NOT NULL,
  timezone_offset INTEGER NOT NULL
);

CREATE TABLE task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  run_time TEXT NOT NULL,
  status INTEGER NOT NULL,
  http_code INTEGER,
  duration_ms INTEGER,
  error TEXT
);
```

## 4. 部署

```bash
wrangler deploy
```

## 5. 登录后台

访问：

```
https://your-worker.your-domain.workers.dev/login
```

输入你设置的 `ADMIN_PASSWORD`。

---

# 🏗 系统架构

```
Cloudflare Workers
 ├── Web UI（/admin）
 ├── REST API（/api/...）
 ├── Cron Trigger（scheduled）
 └── D1 数据库
```

- Workers 负责前端页面、API、任务执行器  
- D1 存储任务、Cron、日志  
- Cron Trigger 每分钟执行一次，判断哪些任务需要运行  

---

# 🗄 数据库结构

## 1. tasks（父任务）

| 字段 | 说明 |
|------|------|
| id | 主键 |
| url | 任务 URL |
| cron | 旧任务的单 Cron |
| remark | 备注 |
| enabled | 是否启用 |
| last_run | 最近执行时间（旧任务） |

## 2. task_items（多 Cron 子任务）

| 字段 | 说明 |
|------|------|
| id | 主键 |
| task_id | 父任务 ID |
| cron | UTC Cron |
| timezone_offset | 时区偏移（例如 +8） |

## 3. task_logs（执行日志）

| 字段 | 说明 |
|------|------|
| id | 主键 |
| task_id | 任务 ID（负数 = 子 Cron） |
| run_time | 执行时间 |
| status | 成功/失败 |
| http_code | HTTP 状态码 |
| duration_ms | 耗时 |
| error | 错误信息 |

---

# 🖥 后台管理界面（Admin UI）

## 1. 登录页
输入密码进入后台。

## 2. 任务列表页
- 显示任务状态  
- 显示最近执行结果  
- 显示 Cron 数量  
- 操作按钮：编辑 / 删除 / 启用 / 禁用 / 日志 / 统计  

## 3. 新增任务
- URL  
- 多 Cron（本地时间）  
- 时区选择  
- 自动转换为 UTC 存储  

## 4. 编辑任务
- 自动识别旧任务/新任务  
- 新任务：多 Cron + 时区  
- 旧任务：单 Cron  

## 5. 日志页
- 本地时间显示  
- 分页  
- 显示来源（旧任务/子 Cron）  

## 6. 统计图
- Canvas 绘图  
- 展示执行耗时趋势  

---

# 🔌 API 文档

## 登录
```
POST /api/login
```

## 创建任务（多 Cron）
```
POST /api/tasks/create-multi-cron
```

## 更新任务（多 Cron）
```
POST /api/tasks/update-multi-cron
```

## 删除任务
```
GET /api/tasks/delete?id=123
```

## 启用/禁用任务
```
GET /api/tasks/toggle?id=123
```

---

# ⏱ 定时执行器（Scheduler）

Cloudflare Cron Trigger 每分钟执行一次：

1. 加载所有启用的任务  
2. 判断 Cron 是否匹配当前时间  
3. 执行任务  
4. 写入日志  
5. 更新 last_run（旧任务）  

---

# 🧠 Cron 解析器

支持：

- `*`
- `*/5`
- `1-5`
- `1,2,3`
- 任意组合

---

# 🛠 部署与运维

## 查看日志
Workers → Logs

## 数据备份
D1 → Export

## 常见错误

### Error 1101（跳转失败）
- 使用 HTML + JS 强制跳转解决  
- 已在 worker.js 中修复  

### 删除任务无效
- 按钮链接必须是 `/api/tasks/delete`  
- 已修复  

### 模板字符串截断
- Cloudflare 编辑器可能插入反斜杠  
- 已修复  

---

# ❓ FAQ

### 为什么 task_id 为负数？
用于区分“旧任务日志”和“子 Cron 日志”。

### 为什么 Cron 要用 UTC？
Cloudflare Workers 的 Cron Trigger 使用 UTC。

### 为什么编辑页能自动识别新旧任务？
根据 task_items 是否存在判断。

---

# 🧩 开发者指南

- 如何扩展任务类型  
- 如何添加通知渠道（邮件、Telegram 等）  
- 如何扩展统计图  
- 如何添加更多字段  
- 如何进行二次开发  

---

# 📜 版本历史（Changelog）

- 新增多 Cron 支持  
- 新增时区支持  
- 新增统计图  
- 新增本地时间日志显示  
- 修复删除/禁用跳转问题  
- 修复 task_items 结构问题  
- 完整重构 worker.js  

---

# 🎉 结束语

这是一个完全基于 Cloudflare 的轻量级自动化任务系统，  
无需服务器、无需运维、零成本运行，非常适合个人或小团队使用。
