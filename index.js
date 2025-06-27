import puppeteer from 'puppeteer'
import { writeFile, mkdir, appendFile } from 'fs/promises'
import { URL } from 'url'
import path from 'path'

/**
 * 能量类型映射表：将图片文件名映射为中文文本
 */
const energyMap = {
  'Water.png': '水',
  'Lightning.png': '雷',
  'Colorless.png': '無',
  'Fighting.png': '鬥',
  'Psychic.png': '超',
  'Fire.png': '火',
  'Grass.png': '草',
  'Darkness.png': '惡',
  'Metal.png': '鋼',
  'Dragon.png': '龍',
  'Fairy.png': '妖',
}

/**
 * 宝可梦卡片爬虫类
 */
class PokemonCardCrawler {
  constructor() {
    this.browser = null
    this.page = null
    this.baseUrl = 'https://asia.pokemon-card.com'
    this.targetUrl = 'https://asia.pokemon-card.com/hk/card-search/list/?expansionCodes=SVAW'
    this.allCardsData = []
    this.imageDir = 'cardImages'
    this.outputFileName = 'pokemon_cards_SVAW.jsonl' // 使用 .jsonl 扩展名
  }

  /**
   * 初始化设置
   */
  async initSetup() {
    console.log('进行初始化设置...')
    // 创建图片存储目录 (如果不存在)
    await mkdir(this.imageDir, { recursive: true })
    // 清空/创建输出文件，为渐进式写入做准备
    await writeFile(this.outputFileName, '', 'utf8')
  }

  /**
   * 初始化浏览器和页面
   */
  async init() {
    console.log('正在启动 Puppeteer...')
    this.browser = await puppeteer.launch({
      // 'new' 新的无头模式, false 有头模式
      headless: false,
      defaultViewport: {
        width: 1280,
        height: 720,
      },
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })

    this.page = await this.browser.newPage()

    // 设置用户代理
    await this.page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )

    console.log('Puppeteer 启动完成')
  }

  /**
   * 获取卡片列表页面的所有卡片链接
   */
  async getCardLinks() {
    console.log(`正在打开页面: ${this.targetUrl}`)

    try {
      // 导航到目标页面
      await this.page.goto(this.targetUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      })

      console.log('页面加载完成，等待内容渲染...')

      // 等待 rightColumn 元素出现
      await this.page.waitForSelector('div.rightColumn', { timeout: 10000 })

      console.log('找到 rightColumn 元素，开始提取卡片链接...')

      // 提取所有卡片链接
      const cardLinks = await this.page.evaluate(() => {
        const cardElements = Array.from(document.querySelectorAll('.rightColumn li.card'))
        const host = window.location.origin
        return cardElements
          .map((card) => {
            const aTag = card.querySelector('a')
            return aTag ? `${host}${aTag.getAttribute('href')}` : null
          })
          .filter((link) => link) // 过滤掉无效链接
      })

      console.log(`成功提取到 ${cardLinks.length} 个卡片链接:`)
      cardLinks.forEach((link, index) => {
        console.log(`${index + 1}. ${link}`)
      })

      return cardLinks
    } catch (error) {
      console.error('获取卡片链接时发生错误:', error.message)
      throw error
    }
  }

  /**
   * 访问单个卡片详情页面并提取详细数据
   */
  async visitCardDetail(cardUrl) {
    console.log(`正在访问卡片详情页: ${cardUrl}`)

    try {
      // 创建新页面来访问详情页
      const detailPage = await this.browser.newPage()
      await detailPage.goto(cardUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      })

      console.log('卡片详情页加载完成，正在提取数据...')

      // 在详情页的浏览器上下文中执行抓取逻辑
      const cardData = await detailPage.evaluate(
        (url, energyMap) => {
          // --- 辅助函数：安全地获取元素文本 ---
          const getText = (selector, root = document) => {
            const element = root.querySelector(selector)
            // 清理文本，替换换行符和多余空格
            return element ? element.innerText.trim().replace(/\s*\n\s*/g, ' ') : null
          }

          // --- 辅助函数：安全地获取元素属性 ---
          const getAttr = (selector, attr) => {
            const element = document.querySelector(selector)
            return element ? element.getAttribute(attr) : null
          }

          // --- 修正后的名称和类型提取逻辑 ---
          const headerEl = document.querySelector('h1.pageHeader.cardDetail')
          let name_zh = null
          let card_type = null

          if (headerEl) {
            card_type = getText('.evolveMarker', headerEl)
            // 克隆h1元素，移除span子元素，再获取文本，从而只得到宝可梦名字
            const nameElClone = headerEl.cloneNode(true)
            const evolveMarker = nameElClone.querySelector('.evolveMarker')
            if (evolveMarker) {
              evolveMarker.remove()
            }
            name_zh = nameElClone.innerText.trim()
          }

          // --- 其他数据提取逻辑 (保持不变) ---
          const card_id = getAttr('.cardImage img', 'src')?.split('/').pop()?.split('.')[0] || null
          const image_url = getAttr('.cardImage img', 'src') // 提取图片完整URL

          const hp = parseInt(getText('.mainInfomation .number'), 10) || null

          // 解析招式
          const abilities = Array.from(document.querySelectorAll('.skillInformation .skill')).map((skillEl) => {
            const skillName = getText('.skillName', skillEl)
            const skillDamage = parseInt(getText('.skillDamage', skillEl), 10) || null
            const skillEffect = getText('.skillEffect', skillEl)

            const costImgs = Array.from(skillEl.querySelectorAll('.skillCost img'))
            const skillType = costImgs.length > 0 ? energyMap[costImgs[0].src.split('/').pop()] || null : null

            return {
              name: skillName,
              type: skillType,
              damage: skillDamage,
              effect: skillEffect === '' ? null : skillEffect,
            }
          })

          // 解析弱点、抵抗力、撤退
          const weaknessEl = document.querySelector('.subInformation .weakpoint')
          let weakness = '無'
          if (weaknessEl && weaknessEl.innerText.trim() !== '--') {
            const weakImg = weaknessEl.querySelector('img')
            const weakType = weakImg ? energyMap[weakImg.src.split('/').pop()] : ''
            const weakMultiplier = weaknessEl.innerText.replace(/\s/g, '')
            weakness = `${weakType}${weakMultiplier}`
          }

          const resistanceEl = document.querySelector('.subInformation .resist')
          let resistance = '無'
          if (resistanceEl && resistanceEl.innerText.trim() !== '--') {
            const resistImg = resistanceEl.querySelector('img')
            const resistType = resistImg ? energyMap[resistImg.src.split('/').pop()] : ''
            const resistValue = resistanceEl.innerText.replace(/\s/g, '')
            resistance = `${resistType}${resistValue}`
          }

          const retreat_cost = document.querySelectorAll('.subInformation .escape img').length

          // 解析图鉴信息
          const dexHeader = getText('.extraInformation h3')
          // 提取并补零
          let national_no = dexHeader?.match(/No\.(\d+)/)?.[1] || null
          if (national_no) {
            national_no = national_no.padStart(4, '0')
          }
          const category = dexHeader?.split(' ')?.[1] || null

          const sizeText = getText('.extraInformation .size')
          const height = sizeText?.match(/身高.*?(\d+\.?\d*)/)?.[1] + 'm' || null
          const weight = sizeText?.match(/體重.*?(\d+\.?\d*)/)?.[1] + 'kg' || null

          // 解析卡牌信息
          const illustrator = getText('.illustrator a')
          const collectorNumber = getText('.expansionColumn .collectorNumber')
          const regulationMark = getText('.expansionColumn .alpha')
          const expansionSymbolImg = getAttr('.expansionColumn .expansionSymbol img', 'src')
          const expansionCode = expansionSymbolImg?.split('/').pop()?.split('_')[0].toUpperCase() || ''
          const rarityCode = expansionSymbolImg?.split('_').pop()?.split('.')[0] || ''
          const card_number = `${regulationMark} ${expansionCode} ${rarityCode.toUpperCase()} ${collectorNumber}`

          const flavor_text = getText('.extraInformation .discription')

          // 返回包含图片URL的临时数据
          return {
            image_url, // 临时传递图片URL
            data: {
              card_id,
              card_type,
              name: { zh: name_zh, en: null },
              dex_info: { national_no, category, height, weight },
              stats: { hp },
              attributes: { weakness, resistance, retreat_cost },
              abilities,
              card_info: { illustrator, card_number, rarity: `${rarityCode.toUpperCase()}稀有`, set: '朱&紫' },
              flavor_text,
              appearance: null,
            },
          }
        },
        cardUrl,
        energyMap
      ) // 传入当前页面的URL和能量映射表

      // B. 下载图片
      let relativeImagePath = null
      if (cardData && cardData.image_url) {
        const imageName = path.basename(cardData.image_url)
        relativeImagePath = path.join(this.imageDir, imageName)

        // 使用 page.goto 直接获取图片响应
        const imageResponse = await detailPage.goto(cardData.image_url)
        if (imageResponse.ok()) {
          await writeFile(relativeImagePath, await imageResponse.buffer())
        } else {
          console.log(`  - 警告: 无法下载图片 ${cardData.image_url}`)
          relativeImagePath = null
        }
      }

      // C. 组合最终数据
      if (cardData) {
        const finalCardData = cardData.data
        finalCardData.image_path = relativeImagePath // 添加本地图片路径字段
        cardData = finalCardData
      }

      // 关闭详情页
      await detailPage.close()

      return cardData
    } catch (error) {
      console.error(`访问卡片详情页 ${cardUrl} 时发生错误:`, error.message)
      throw error
    }
  }

  /**
   * 批量访问所有卡片详情页面
   */
  async visitAllCardDetails(cardLinks) {
    console.log(`\n--- 开始逐个处理卡片，结果将实时写入 ${this.outputFileName} ---`)

    for (let i = 0; i < cardLinks.length; i++) {
      const cardUrl = cardLinks[i]

      try {
        const cardData = await this.visitCardDetail(cardUrl)
        
        if (cardData) {
          // 渐进式写入文件，每个JSON对象占一行
          await appendFile(this.outputFileName, JSON.stringify(cardData) + '\n', 'utf8')
          console.log(`[${i + 1}/${cardLinks.length}] ✅ 已抓取并保存: ${cardData.name.zh} (${cardData.card_id})`)
          
          // 也保存到内存数组中（可选）
          this.allCardsData.push(cardData)
        }

        // 添加延迟避免被反爬虫
        await this.delay(1000 + Math.random() * 2000)
      } catch (error) {
        console.log(`[${i + 1}/${cardLinks.length}] ❌ 处理 ${cardUrl} 时发生错误: ${error.message}`)
        // 继续处理下一个卡片，不中断整个流程
      }
    }

    return this.allCardsData
  }

  /**
   * 显示最终总结
   */
  async showSummary() {
    console.log(`\n🎉 全部操作完成！数据已保存在 ${this.outputFileName}，图片已保存在 ${this.imageDir} 目录。`)
  }

  /**
   * 延迟函数
   */
  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * 清理资源
   */
  async cleanup() {
    if (this.browser) {
      console.log('\n正在关闭浏览器...')
      await this.browser.close()
      console.log('浏览器已关闭')
    }
  }

  /**
   * 运行完整的爬虫流程
   */
  async run() {
    try {
      // 第0步：初始化设置
      await this.initSetup()
      
      // 第1步：启动浏览器
      await this.init()

      // 第2步：获取所有卡片链接
      const cardLinks = await this.getCardLinks()

      if (cardLinks.length === 0) {
        console.log('未找到任何卡片链接')
        return
      }

      // 第3步：批量访问详情页面并提取数据（实时写入文件）
      await this.visitAllCardDetails(cardLinks)

      // 第4步：显示总结
      await this.showSummary()
      
    } catch (error) {
      console.error('爬虫主程序发生严重错误:', error)
    } finally {
      await this.cleanup()
    }
  }
}

// 运行爬虫
async function main() {
  console.log('=== 宝可梦卡片数据爬虫启动 ===\n')

  const crawler = new PokemonCardCrawler()
  await crawler.run()

  console.log('\n=== 爬虫运行完成 ===')
}

// 处理未捕获的异常
process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的 Promise 拒绝:', reason)
  process.exit(1)
})

process.on('SIGINT', () => {
  console.log('\n收到中断信号，正在退出...')
  process.exit(0)
})

// 启动程序
main().catch(console.error)
