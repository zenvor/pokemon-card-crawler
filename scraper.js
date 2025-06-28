import puppeteer from 'puppeteer'
import { promises as fs } from 'fs'
import { readFileSync, existsSync, createWriteStream } from 'fs'
import path from 'path'

// =================================================================
// --- 配置区域 ---
// =================================================================
const CONFIG = {
  // 是否启用自动翻页功能
  ENABLE_PAGINATION: false,
  // 并发处理详情页的数量
  CONCURRENT_PAGES: 5,
  // 导航超时时间 (毫秒)，增加超时以防止网络波动
  NAVIGATION_TIMEOUT: 60000,
  // 失败任务的重试次数
  RETRY_ATTEMPTS: 3,
  // 日志文件名
  LOG_FILE_NAME: 'scraper.log',
  // 卡牌图片存储的目录名
  CARD_IMAGE_DIR: 'card-images',
  // 卡包符号图片存储的目录名
  EXPANSION_SYMBOL_IMAGE_DIR: 'expansion-symbol-images',
  // 增量写入的JSONL文件名
  JSONL_FILE_NAME: 'pokemon_cards.jsonl',
  // 爬虫起始的列表页面URL
  START_URL: 'https://asia.pokemon-card.com/hk/card-search/list/',
}
// =================================================================

// 能量图标文件名到中文名称的映射表
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
 * 处理单个卡片详情页的函数，包含自动重试机制
 * @param {import('puppeteer').Browser} browser - Puppeteer浏览器实例
 * @param {string} detailUrl - 要抓取的详情页URL
 * @returns {Promise<object|null>} - 返回抓取到的卡片数据，如果失败则返回null
 */
async function processDetailPage(browser, detailUrl) {
  for (let attempt = 1; attempt <= CONFIG.RETRY_ATTEMPTS; attempt++) {
    let detailPage = null
    try {
      detailPage = await browser.newPage()
      // 确保为每个新创建的详情页设置视口
      await detailPage.setViewport({ width: 1920, height: 1080 })

      await detailPage.goto(detailUrl, { waitUntil: 'networkidle2', timeout: CONFIG.NAVIGATION_TIMEOUT })

      const cardDataPayload = await detailPage.evaluate((energyMap) => {
        const getText = (selector, root = document) =>
          root
            .querySelector(selector)
            ?.innerText.trim()
            .replace(/\s*\n\s*/g, ' ') || null
        const getAttr = (selector, attr) => document.querySelector(selector)?.getAttribute(attr) || null

        const getCommonData = () => {
          return {
            card_id: getAttr('.cardImage img', 'src')?.split('/').pop()?.split('.')[0] || null,
            card_image_url: getAttr('.cardImage img', 'src'), // 临时字段，用于下载
            name: getText('h1.pageHeader'),
            card_info: {
              illustrator: getText('.illustrator a'),
              card_number: null,
              rarity: null,
              set: null,
              expansion_symbol_image_url: getAttr('.expansionColumn .expansionSymbol img', 'src'), // 临时字段，用于下载
              expansion_symbol: null,
              alpha: getText('.expansionColumn .alpha'),
              collector_number: getText('.expansionColumn .collectorNumber'),
            },
            appearance: null,
          }
        }

        const isPokemonCard = document.querySelector('.evolveMarker') !== null
        const commonHeaderText = getText('.cardInformationColumn .commonHeader')
        const knownTrainerTypes = ['物品卡', '支援者卡', '競技場卡', '寶可夢道具']
        const knownEnergyTypes = ['基本能量卡', '特殊能量卡']

        if (isPokemonCard) {
          const commonData = getCommonData()
          const headerEl = document.querySelector('h1.pageHeader.cardDetail')
          let name_zh = null,
            card_type = null
          if (headerEl) {
            card_type = getText('.evolveMarker', headerEl)
            const nameElClone = headerEl.cloneNode(true)
            nameElClone.querySelector('.evolveMarker')?.remove()
            name_zh = nameElClone.innerText.trim()
          }
          const evolutionSteps = Array.from(document.querySelectorAll('.evolution .step a'))
          const evolution_chain = evolutionSteps.map((step, index) => ({ stage: index, name: step.innerText.trim() }))
          const dexHeader = getText('.extraInformation h3')
          let national_no = dexHeader?.match(/No\.(\d+)/)?.[1] || null
          if (national_no) national_no = national_no.padStart(4, '0')
          return {
            card_url: window.location.href,
            data: {
              card_id: commonData.card_id,
              card_category: '宝可梦卡',
              card_type,
              name: { zh: name_zh, en: null },
              card_image_url: commonData.card_image_url,
              stats: { hp: parseInt(getText('.mainInfomation .number'), 10) || null },
              abilities: Array.from(document.querySelectorAll('.skillInformation .skill')).map((el) => ({
                name: getText('.skillName', el),
                type: energyMap[el.querySelector('.skillCost img')?.src.split('/').pop()] || null,
                damage: parseInt(getText('.skillDamage', el), 10) || null,
                effect: getText('.skillEffect', el) || null,
              })),
              attributes: {
                weakness: (() => {
                  let w = '無'
                  const el = document.querySelector('.subInformation .weakpoint')
                  if (el && el.innerText.trim() !== '--') {
                    const img = el.querySelector('img')
                    w = `${energyMap[img?.src.split('/').pop()] || ''}${el.innerText.replace(/\s/g, '')}`
                  }
                  return w
                })(),
                resistance: (() => {
                  let r = '無'
                  const el = document.querySelector('.subInformation .resist')
                  if (el && el.innerText.trim() !== '--') {
                    const img = el.querySelector('img')
                    r = `${energyMap[img?.src.split('/').pop()] || ''}${el.innerText.replace(/\s/g, '')}`
                  }
                  return r
                })(),
                retreat_cost: document.querySelectorAll('.subInformation .escape img').length,
              },
              evolution_chain,
              dex_info: {
                national_no,
                category: dexHeader?.split(' ')?.[1] || null,
                height: getText('.extraInformation .size')?.match(/身高.*?(\d+\.?\d*)/)?.[1] + 'm' || null,
                weight: getText('.extraInformation .size')?.match(/體重.*?(\d+\.?\d*)/)?.[1] + 'kg' || null,
              },
              flavor_text: getText('.extraInformation .discription'),
              card_info: commonData.card_info,
              appearance: commonData.appearance,
            },
          }
        } else if (knownEnergyTypes.includes(commonHeaderText)) {
          const commonData = getCommonData()
          return {
            card_url: window.location.href,
            data: {
              card_id: commonData.card_id,
              card_category: '能量卡',
              sub_type: commonHeaderText,
              name: commonData.name,
              card_image_url: commonData.card_image_url,
              effect: commonHeaderText === '特殊能量卡' ? getText('.skillEffect') : null,
              card_info: commonData.card_info,
              appearance: commonData.appearance,
            },
          }
        } else {
          const commonData = getCommonData()
          return {
            card_url: window.location.href,
            data: {
              card_id: commonData.card_id,
              card_category: '训练家卡',
              sub_type: knownTrainerTypes.includes(commonHeaderText) ? commonHeaderText : null,
              name: commonData.name,
              card_image_url: commonData.card_image_url,
              effect: getText('.skillEffect'),
              card_info: commonData.card_info,
              appearance: commonData.appearance,
            },
          }
        }
      }, energyMap)

      if (!cardDataPayload) {
        console.log(`  ⚠️  跳过未知类型的卡片: ${detailUrl}`)
        return null // 成功处理，但无需保存
      }

      const finalCardData = cardDataPayload.data
      finalCardData.card_url = cardDataPayload.card_url

      let relativeCardImagePath = null
      if (finalCardData.card_image_url) {
        const imageName = path.basename(finalCardData.card_image_url)
        relativeCardImagePath = path.join(CONFIG.CARD_IMAGE_DIR, imageName)
        const imageResponse = await detailPage.goto(finalCardData.card_image_url, {
          timeout: CONFIG.NAVIGATION_TIMEOUT,
        })
        if (imageResponse.ok()) await fs.writeFile(relativeCardImagePath, await imageResponse.buffer())
        else relativeCardImagePath = null
      }

      let relativeExpansionSymbolPath = null
      if (finalCardData.card_info.expansion_symbol_image_url) {
        const imageName = path.basename(finalCardData.card_info.expansion_symbol_image_url)
        relativeExpansionSymbolPath = path.join(CONFIG.EXPANSION_SYMBOL_IMAGE_DIR, imageName)
        const imageResponse = await detailPage.goto(finalCardData.card_info.expansion_symbol_image_url, {
          timeout: CONFIG.NAVIGATION_TIMEOUT,
        })
        if (imageResponse.ok()) await fs.writeFile(relativeExpansionSymbolPath, await imageResponse.buffer())
        else relativeExpansionSymbolPath = null
      }

      delete finalCardData.card_image_url
      finalCardData.card_image_path = relativeCardImagePath

      delete finalCardData.card_info.expansion_symbol_image_url
      finalCardData.card_info.expansion_symbol_image_path = relativeExpansionSymbolPath

      return finalCardData // 成功，返回数据
    } catch (err) {
      console.log(`  🟡 第 ${attempt}/${CONFIG.RETRY_ATTEMPTS} 次尝试失败: ${detailUrl}. 原因: ${err.message}`)
      if (attempt === CONFIG.RETRY_ATTEMPTS) {
        console.error(`  ❌ 所有重试均告失败: ${detailUrl}.`)
        throw err // 将最终错误抛出，由Promise.allSettled捕获
      }
      // 等待一段时间再重试
      const delay = 2 * attempt
      console.log(`     ${delay}秒后重试...`)
      await new Promise((res) => setTimeout(res, delay * 1000))
    } finally {
      if (detailPage && !detailPage.isClosed()) {
        await detailPage.close()
      }
    }
  }
  return null // 所有重试都失败后，最终返回null（虽然理论上会被throw中断）
}

/**
 * 主抓取函数
 */
async function scrapePokemonCards() {
  // --- 日志记录设置 ---
  const logStream = createWriteStream(CONFIG.LOG_FILE_NAME, { flags: 'a' })
  const originalLog = console.log
  const originalError = console.error

  const logToFile = (message, level = 'INFO') => {
    const timestamp = new Date().toISOString()
    logStream.write(`[${timestamp}] [${level}] ${message}\n`)
  }

  console.log = (...args) => {
    const message = args.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ')
    originalLog.apply(console, args)
    logToFile(message, 'INFO')
  }

  console.error = (...args) => {
    const message = args.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ')
    originalError.apply(console, args)
    logToFile(message, 'ERROR')
  }

  // --- 初始化设置 ---
  console.log('进行初始化设置...')
  await fs.mkdir(CONFIG.CARD_IMAGE_DIR, { recursive: true })
  await fs.mkdir(CONFIG.EXPANSION_SYMBOL_IMAGE_DIR, { recursive: true })

  // --- 断点续传逻辑 ---
  const processedUrls = new Set()
  if (existsSync(CONFIG.JSONL_FILE_NAME)) {
    console.log(`发现已存在的进度文件: ${CONFIG.JSONL_FILE_NAME}，正在读取进度...`)
    const fileContent = readFileSync(CONFIG.JSONL_FILE_NAME, 'utf8')
    const lines = fileContent.split('\n').filter((line) => line.trim() !== '')
    lines.forEach((line) => {
      try {
        const parsed = JSON.parse(line)
        if (parsed.card_url) {
          processedUrls.add(parsed.card_url)
        }
      } catch (e) {
        console.warn('解析JSONL文件中的一行失败:', line)
      }
    })
    console.log(`已加载 ${processedUrls.size} 条已处理的URL记录。`)
  } else {
    await fs.writeFile(CONFIG.JSONL_FILE_NAME, '', 'utf8')
  }

  console.log('启动浏览器...')
  const browser = await puppeteer.launch({ headless: 'new' })
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080 })

  try {
    console.log(`正在导航到列表页面: ${CONFIG.START_URL}`)
    await page.goto(CONFIG.START_URL, { waitUntil: 'networkidle2', timeout: CONFIG.NAVIGATION_TIMEOUT })

    const paginationInfo = await page.evaluate(() => {
      const totalPagesText = document.querySelector('.resultTotalPages')?.innerText || '/ 共1 页'
      const currentPageText = document.querySelector('.resultPageNumber')?.innerText || '第 1 頁'
      const totalMatch = totalPagesText.match(/(\d+)/)
      const currentMatch = currentPageText.match(/(\d+)/)
      return {
        totalPages: totalMatch ? parseInt(totalMatch[1], 10) : 1,
        startPage: currentMatch ? parseInt(currentMatch[1], 10) : 1,
      }
    })

    const { totalPages, startPage } = paginationInfo
    const endPage = CONFIG.ENABLE_PAGINATION ? totalPages : startPage

    console.log(`发现总页数: ${totalPages}，将从第 ${startPage} 页开始抓取。`)
    if (CONFIG.ENABLE_PAGINATION) {
      console.log(`自动翻页已启用，将抓取至第 ${endPage} 页。并发数: ${CONFIG.CONCURRENT_PAGES}`)
    } else {
      console.log(`自动翻页已禁用，仅抓取第 ${startPage} 页。`)
    }

    const baseUrl = new URL(page.url())
    baseUrl.searchParams.delete('page')
    baseUrl.searchParams.delete('pageNo')

    let newItemsProcessed = 0

    for (let currentPage = startPage; currentPage <= endPage; currentPage++) {
      if (currentPage !== startPage) {
        const currentPageUrl = new URL(baseUrl.toString())
        currentPageUrl.searchParams.set('pageNo', currentPage)
        console.log(`\n- 正在导航到列表页面 ${currentPage}/${totalPages}...`)
        await page.goto(currentPageUrl.toString(), { waitUntil: 'networkidle2', timeout: CONFIG.NAVIGATION_TIMEOUT })
      } else {
        console.log(`\n- 正在处理列表页面 ${currentPage}/${totalPages} (起始页)...`)
      }

      const linksOnPage = await page.evaluate(() => {
        const cardElements = Array.from(document.querySelectorAll('.rightColumn li.card'))
        const host = window.location.origin
        return cardElements
          .map((card) => (card.querySelector('a') ? `${host}${card.querySelector('a').getAttribute('href')}` : null))
          .filter((link) => link)
      })

      const urlsToProcess = linksOnPage.filter((url) => !processedUrls.has(url))
      const skippedCount = linksOnPage.length - urlsToProcess.length

      if (skippedCount > 0) {
        console.log(`  > 跳过 ${skippedCount} 个已处理的链接。`)
      }

      if (urlsToProcess.length === 0) {
        console.log(`  > 当前页所有链接均已处理，跳至下一页。`)
        continue
      }

      console.log(`  > 找到 ${urlsToProcess.length} 个新链接，开始并发处理...`)

      for (let i = 0; i < urlsToProcess.length; i += CONFIG.CONCURRENT_PAGES) {
        const chunk = urlsToProcess.slice(i, i + CONFIG.CONCURRENT_PAGES)

        const promises = chunk.map((url) => processDetailPage(browser, url))
        const results = await Promise.allSettled(promises)

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            const finalCardData = result.value
            await fs.appendFile(CONFIG.JSONL_FILE_NAME, JSON.stringify(finalCardData) + '\n', 'utf8')
            newItemsProcessed++
            console.log(
              `  [${processedUrls.size + newItemsProcessed}] ✅ 已抓取 [${finalCardData.card_category}] 卡: ${
                typeof finalCardData.name === 'object' ? finalCardData.name.zh : finalCardData.name
              }`
            )
          } else if (result.status === 'rejected') {
            // 失败的任务已经被 processDetailPage 内部记录，这里无需额外打印
          }
        }
      }
    }

    console.log(`\n本轮运行新处理了 ${newItemsProcessed} 张卡片.`)
  } catch (error) {
    console.error('爬虫主程序发生严重错误:', error)
  } finally {
    console.log(`\n🎉 全部操作完成！数据已保存至 ${CONFIG.JSONL_FILE_NAME}。`)
    console.log(`   请运行 'node converter.js' 来生成最终的 .json 文件。`)
    await browser.close()
    logStream.end() // 安全关闭日志流
  }
}

// 运行主函数
scrapePokemonCards()
