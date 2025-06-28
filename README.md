# 宝可梦集换式卡牌官网爬虫

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22.x-43853d.svg" alt="Node.js">
  <img src="https://img.shields.io/badge/Puppeteer-24.x-40B5A4.svg" alt="Puppeteer">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome">
</p>

这是一个基于 Node.js 和 Puppeteer 构建的工业级网络爬虫，专门用于抓取宝可梦集换式卡牌游戏亚洲官网（`asia.pokemon-card.com`）的卡牌数据。

该项目从一个简单的链接提取脚本开始，经过了多次迭代，现已发展成为一个功能完备、稳定且高效的数据采集工具。它能够系统地抓取网站上的所有卡牌信息，并将其整理成结构化的 JSON 文件，同时下载相关的图片资源。

## ✨ 项目亮点

- **健壮性设计**: 拥有完善的**自动重试**、**断点续传**和**持久化日志**机制，专为大规模、长时间的抓取任务而设计，无惧网络波动或意外中断
- **高性能抓取**: 通过**并发处理**和**请求拦截**（阻止加载不必要的CSS/字体）技术，显著提升了数据采集效率，并降低了系统资源消耗
- **高度可配置**: 从并发数到超时时间，从翻页开关到文件目录，所有核心参数均可在脚本顶部的 `CONFIG` 对象中轻松调整，无需修改核心代码
- **职责分离**: 核心爬虫 `scraper.js` 与数据转换工具 `converter.js` 完全分离，架构清晰，易于维护和扩展

## 📋 功能特性

- **全卡种支持**: 能够自动识别并分别处理**宝可梦卡**、**训练家卡**和**能量卡**，并为不同类型的卡牌使用最合适的 JSON 结构
- **数据完整性**: 抓取包括基本信息、HP、技能、属性、进化链、图鉴信息、卡包信息在内的详尽字段
- **图片下载**: 自动下载每张卡牌的高清大图和其所属的卡包符号图标，并分别存放在 `card-images` 和 `expansion-symbol-images` 目录中
- **智能翻页**: 自动检测网站的总页数，并支持从任意指定页面开始，完成所有分页的遍历抓取。此功能可配置开启或关闭
- **友好抓取**: 支持在每批并发任务之间设置延迟，避免因请求过于频繁而对目标服务器造成压力
- **双格式输出**: 数据首先被安全地写入 `.jsonl` 文件，之后可手动转换为格式化的 `.json` 文件，兼顾了安全与便利
- **持久化日志**: 所有的运行信息、成功、警告和错误日志都会被自动记录到 `scraper.log` 文件中，方便追踪和调试

## 🛠️ 技术栈

- [**Node.js**](https://nodejs.org/): 脚本的运行环境（推荐 v18 或更高版本）
- [**Puppeteer**](https://pptr.dev/): 核心库，用于驱动一个无头（Headless）Chrome 浏览器来进行网页的导航、交互和数据提取

## ⚙️ 安装与配置

### 1. 环境准备

请确保您的电脑上已经安装了 [Node.js](https://nodejs.org/)（推荐 v18 或更高版本）。

### 2. 安装依赖

在您的项目根目录下，打开终端并运行以下命令来安装 Puppeteer：

```bash
npm install
```

### 3. 参数配置

打开 `scraper.js` 文件，您可以在文件顶部的 `CONFIG` 对象中修改各项配置：

```javascript
const CONFIG = {
  // --- 爬虫行为配置 ---
  ENABLE_PAGINATION: true,
  CONCURRENT_PAGES: 5, 
  RETRY_ATTEMPTS: 3,
  DELAY_BETWEEN_BATCHES_MS: 1000,

  // --- Puppeteer 配置 ---
  NAVIGATION_TIMEOUT: 60000,
  PUPPETEER_LAUNCH_OPTIONS: {
    headless: 'new', // 'new' 或 false
    // ...其他启动参数
  },
  // ...其他文件配置
};
```

## 🚀 使用方法

项目的执行分为两步，确保了数据采集和格式转换的解耦：

### 1. 启动爬虫

```bash
node scraper.js
```

运行此命令后，爬虫会启动，开始抓取数据。所有抓取到的卡牌信息会**实时**、**增量**地追加到 `pokemon_cards.jsonl` 文件中。图片也会被同步下载到指定目录。

### 2. 转换数据格式

```bash
node converter.js
```

在爬虫任务全部完成（或您希望在任何时间点）后，运行此命令。它会读取 `pokemon_cards.jsonl` 文件，并生成一个结构清晰、格式化后的 `pokemon_cards.json` 文件，方便在其他应用中使用。

## 📁 项目结构

```
.
├── card-images/                # 存放已下载的卡牌图片
│   ├── hk00012345.png
│   └── ...
├── expansion-symbol-images/    # 存放已下载的卡包符号图片
│   ├── svaw_f.png
│   └── ...
├── node_modules/               # 依赖包目录
├── pokemon_cards.json          # [手动生成] 最终输出的标准JSON文件
├── pokemon_cards.jsonl         # [自动生成] 爬虫实时写入的数据文件
├── scraper.log                 # [自动生成] 爬虫的运行日志文件
├── scraper.js                  # 爬虫主脚本
├── converter.js                # JSONL 到 JSON 的转换脚本
├── package.json                # 项目配置文件
├── package-lock.json           # 依赖锁定文件
└── README.md                   # 项目说明文档
```

## 📝 注意事项

- **使用声明**: 本项目仅供学习和技术研究使用，请勿用于商业目的
- **资源消耗**: 爬虫运行时会消耗较多的网络和计算资源
- **合规使用**: 请尊重目标网站的版权和 robots.txt 协议，合理配置并发数和延迟时间
- **维护提醒**: 如果目标网站的页面结构发生变化，可能会导致此爬虫失效，届时需要更新代码中的选择器

<p align="center">
  Made with ❤️ for Pokémon TCG enthusiasts
</p>