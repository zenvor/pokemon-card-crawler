import puppeteer from 'puppeteer'
import fs from 'fs/promises'
import path from 'path'

// =================================================================
// --- 配置区域 ---
// =================================================================
const CONFIG = {
  // 并发处理详情页的数量
  CONCURRENT_PAGES: 5,
  // 卡牌图片存储的目录名
  CARD_IMAGE_DIR: 'card-images',
  // 卡包符号图片存储的目录名
  EXPANSION_SYMBOL_IMAGE_DIR: 'expansion-symbol-images',
  // 增量写入的JSONL文件名
  JSONL_FILE_NAME: 'pokemon_cards.jsonl',
  // 最终输出的标准JSON文件名
  JSON_FILE_NAME: 'pokemon_cards.json',
  // 爬虫起始的列表页面URL
  START_URL: 'https://asia.pokemon-card.com/hk/card-search/list/',
}
// =================================================================

/**
 * 将JSONL文件（每行一个JSON对象）转换为标准的、格式化的JSON数组文件。
 * @param {string} jsonlPath - 输入的 .jsonl 文件路径。
 * @param {string} jsonPath - 输出的 .json 文件路径。
 */
async function convertJsonlToJson(jsonlPath, jsonPath) {
  console.log(`\n正在将 ${jsonlPath} 转换为 ${jsonPath}...`)
  try {
    const fileContent = await fs.readFile(jsonlPath, 'utf8')
    const lines = fileContent.split('\n')
    const jsonObjects = lines.filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
    const jsonString = JSON.stringify(jsonObjects, null, 2)
    await fs.writeFile(jsonPath, jsonString, 'utf8')
    console.log(`✅ 成功将数据转换为标准JSON格式，并保存到 ${jsonPath}`)
  } catch (error) {
    console.error(`❌ 转换文件时出错: ${error.message}`)
  }
}

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
 * 处理单个卡片详情页的函数
 * @param {import('puppeteer').Browser} browser - Puppeteer浏览器实例
 * @param {string} detailUrl - 要抓取的详情页URL
 * @returns {Promise<object|null>} - 返回抓取到的卡片数据，如果失败则返回null
 */
async function processDetailPage(browser, detailUrl) {
  const detailPage = await browser.newPage()
  // 确保为每个新创建的详情页设置视口
  await detailPage.setViewport({ width: 1920, height: 1080 })
  try {
    await detailPage.goto(detailUrl, { waitUntil: 'networkidle2' })

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
      } else if (['物品卡', '支援者卡', '競技場卡', '寶可夢道具'].includes(commonHeaderText)) {
        const commonData = getCommonData()
        return {
          card_url: window.location.href,
          data: {
            card_id: commonData.card_id,
            card_category: '训练家卡',
            sub_type: commonHeaderText,
            name: commonData.name,
            card_image_url: commonData.card_image_url,
            effect: getText('.skillEffect'),
            card_info: commonData.card_info,
            appearance: commonData.appearance,
          },
        }
      } else if (['基本能量卡', '特殊能量卡'].includes(commonHeaderText)) {
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
      }
      return null
    }, energyMap)

    if (!cardDataPayload) {
      console.log(`  ⚠️  跳过未知类型的卡片: ${detailUrl}`)
      return null
    }

    const finalCardData = cardDataPayload.data
    finalCardData.card_url = cardDataPayload.card_url

    // 下载主卡图
    let relativeCardImagePath = null
    if (finalCardData.card_image_url) {
      const imageName = path.basename(finalCardData.card_image_url)
      relativeCardImagePath = path.join(CONFIG.CARD_IMAGE_DIR, imageName)
      try {
        const imageResponse = await detailPage.goto(finalCardData.card_image_url)
        if (imageResponse.ok()) await fs.writeFile(relativeCardImagePath, await imageResponse.buffer())
        else relativeCardImagePath = null
      } catch (e) {
        console.log(`  下载卡图失败: ${e.message}`)
        relativeCardImagePath = null
      }
    }

    // 下载卡包符号图
    let relativeExpansionSymbolPath = null
    if (finalCardData.card_info.expansion_symbol_image_url) {
      const imageName = path.basename(finalCardData.card_info.expansion_symbol_image_url)
      relativeExpansionSymbolPath = path.join(CONFIG.EXPANSION_SYMBOL_IMAGE_DIR, imageName)
      try {
        const imageResponse = await detailPage.goto(finalCardData.card_info.expansion_symbol_image_url)
        if (imageResponse.ok()) await fs.writeFile(relativeExpansionSymbolPath, await imageResponse.buffer())
        else relativeExpansionSymbolPath = null
      } catch (e) {
        console.log(`  下载卡包符号失败: ${e.message}`)
        relativeExpansionSymbolPath = null
      }
    }

    // 设置最终路径并删除临时URL字段
    delete finalCardData.card_image_url
    finalCardData.card_image_path = relativeCardImagePath

    delete finalCardData.card_info.expansion_symbol_image_url
    finalCardData.card_info.expansion_symbol_image_path = relativeExpansionSymbolPath

    return finalCardData
  } catch (err) {
    console.log(`  ❌ 处理 ${detailUrl} 时发生错误: ${err.message}`)
    return null
  } finally {
    await detailPage.close()
  }
}

/**
 * 主抓取函数
 */
async function scrapePokemonCards() {
  console.log('进行初始化设置...')
  // 同时创建两个图片目录
  await fs.mkdir(CONFIG.CARD_IMAGE_DIR, { recursive: true })
  await fs.mkdir(CONFIG.EXPANSION_SYMBOL_IMAGE_DIR, { recursive: true })
  await fs.writeFile(CONFIG.JSONL_FILE_NAME, '', 'utf8')

  console.log('启动浏览器...')
  const browser = await puppeteer.launch({ headless: 'new' })
  const page = await browser.newPage()
  // 为主列表页面设置视口
  await page.setViewport({ width: 1920, height: 1080 })

  try {
    // --- 1. 边翻页边处理 ---
    console.log(`正在导航到列表页面: ${CONFIG.START_URL}`)
    await page.goto(CONFIG.START_URL, { waitUntil: 'networkidle2' })

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
    console.log(`发现总页数: ${totalPages}，将从第 ${startPage} 页开始抓取。并发数: ${CONFIG.CONCURRENT_PAGES}`)

    const baseUrl = new URL(page.url())
    baseUrl.searchParams.delete('page')
    baseUrl.searchParams.delete('pageNo')

    let totalProcessedCount = 0

    // 外层循环：遍历所有列表页
    for (let currentPage = startPage; currentPage <= totalPages; currentPage++) {
      if (currentPage !== startPage) {
        const currentPageUrl = new URL(baseUrl.toString())
        currentPageUrl.searchParams.set('pageNo', currentPage)
        console.log(`\n- 正在导航到列表页面 ${currentPage}/${totalPages}...`)
        await page.goto(currentPageUrl.toString(), { waitUntil: 'networkidle2' })
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

      console.log(`  > 找到 ${linksOnPage.length} 个链接，开始并发处理...`)

      // 内层循环：并发处理当前页的链接
      for (let i = 0; i < linksOnPage.length; i += CONFIG.CONCURRENT_PAGES) {
        const chunk = linksOnPage.slice(i, i + CONFIG.CONCURRENT_PAGES)

        const promises = chunk.map((url) => processDetailPage(browser, url))
        const results = await Promise.allSettled(promises)

        for (const result of results) {
          totalProcessedCount++
          if (result.status === 'fulfilled' && result.value) {
            const finalCardData = result.value
            await fs.appendFile(CONFIG.JSONL_FILE_NAME, JSON.stringify(finalCardData) + '\n', 'utf8')
            console.log(
              `  [${totalProcessedCount}] ✅ 已抓取 [${finalCardData.card_category}] 卡: ${
                typeof finalCardData.name === 'object' ? finalCardData.name.zh : finalCardData.name
              }`
            )
          } else if (result.status === 'rejected') {
            console.error(`  [${totalProcessedCount}] ❌ 任务失败: ${result.reason}`)
          }
        }
      }
    }

    // --- 3. 抓取完成后，执行转换 ---
    console.log(`\n成功处理了 ${totalProcessedCount} 张卡片.`)
    await convertJsonlToJson(CONFIG.JSONL_FILE_NAME, CONFIG.JSON_FILE_NAME)
  } catch (error) {
    console.error('爬虫主程序发生严重错误:', error)
  } finally {
    console.log(`\n🎉 全部操作完成！`)
    await browser.close()
  }
}

// 运行主函数
scrapePokemonCards()
