import puppeteer from 'puppeteer'
import fs from 'fs/promises'
import path from 'path'

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
 * 主抓取函数
 */
async function scrapePokemonCards() {
  // --- 0. 初始化设置 ---
  const imageDir = 'images'
  const jsonlFileName = 'pokemon_cards.jsonl'
  const jsonFileName = 'pokemon_cards.json'

  console.log('进行初始化设置...')
  await fs.mkdir(imageDir, { recursive: true })
  await fs.writeFile(jsonlFileName, '', 'utf8')

  console.log('启动浏览器...')
  const browser = await puppeteer.launch({ headless: 'new' })
  const page = await browser.newPage()
  // 用户可以修改此URL从任意页面开始
  const listUrl = 'https://asia.pokemon-card.com/hk/card-search/list/?pageNo=1'

  try {
    // --- 1. 边翻页边处理 ---
    console.log(`正在导航到列表页面: ${listUrl}`)
    await page.goto(listUrl, { waitUntil: 'networkidle2' })

    // 获取总页数和当前页作为起始页
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
    console.log(`发现总页数: ${totalPages}，将从第 ${startPage} 页开始抓取。`)

    // 创建一个不包含页面参数的干净基URL
    const baseUrl = new URL(page.url())
    baseUrl.searchParams.delete('page')
    baseUrl.searchParams.delete('pageNo')

    let totalProcessedCount = 0

    // 外层循环：遍历所有列表页
    for (let currentPage = startPage; currentPage <= totalPages; currentPage++) {
      // 如果不是起始页，则导航到新页面
      if (currentPage !== startPage) {
        const currentPageUrl = new URL(baseUrl.toString())
        currentPageUrl.searchParams.set('page', currentPage)
        console.log(`\n- 正在导航到列表页面 ${currentPage}/${totalPages}...`)
        await page.goto(currentPageUrl.toString(), { waitUntil: 'networkidle2' })
      } else {
        console.log(`\n- 正在处理列表页面 ${currentPage}/${totalPages} (起始页)...`)
      }

      // 获取当前页的所有详情页链接
      const linksOnPage = await page.evaluate(() => {
        const cardElements = Array.from(document.querySelectorAll('.rightColumn li.card'))
        const host = window.location.origin
        return cardElements
          .map((card) => (card.querySelector('a') ? `${host}${card.querySelector('a').getAttribute('href')}` : null))
          .filter((link) => link)
      })

      console.log(`  > 找到 ${linksOnPage.length} 个链接，开始逐个处理...`)

      // 内层循环：立即处理当前页的链接
      for (const detailUrl of linksOnPage) {
        const detailPage = await browser.newPage()
        totalProcessedCount++

        try {
          await detailPage.goto(detailUrl, { waitUntil: 'networkidle2' })

          let cardDataPayload = await detailPage.evaluate((energyMap) => {
            const getText = (selector, root = document) =>
              root
                .querySelector(selector)
                ?.innerText.trim()
                .replace(/\s*\n\s*/g, ' ') || null
            const getAttr = (selector, attr) => document.querySelector(selector)?.getAttribute(attr) || null

            const getCommonData = () => {
              return {
                card_id: getAttr('.cardImage img', 'src')?.split('/').pop()?.split('.')[0] || null,
                image_url: getAttr('.cardImage img', 'src'),
                name: getText('h1.pageHeader'),
                card_info: {
                  illustrator: getText('.illustrator a'),
                  card_number: null,
                  rarity: null,
                  set: null,
                  expansion_symbol_img: getAttr('.expansionColumn .expansionSymbol img', 'src'),
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
              const evolution_chain = evolutionSteps.map((step, index) => ({
                stage: index,
                name: step.innerText.trim(),
              }))
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
                  image_url: commonData.image_url,
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
                  image_url: commonData.image_url,
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
                  image_url: commonData.image_url,
                  effect: commonHeaderText === '特殊能量卡' ? getText('.skillEffect') : null,
                  card_info: commonData.card_info,
                  appearance: commonData.appearance,
                },
              }
            }
            return null
          }, energyMap)

          if (!cardDataPayload) {
            console.log(`  [${totalProcessedCount}] ⚠️  跳过未知类型的卡片: ${detailUrl}`)
            continue
          }

          const finalCardData = cardDataPayload.data
          finalCardData.card_url = cardDataPayload.card_url

          let relativeImagePath = null
          if (finalCardData.image_url) {
            const imageName = path.basename(finalCardData.image_url)
            relativeImagePath = path.join(imageDir, imageName)
            try {
              const imageResponse = await detailPage.goto(finalCardData.image_url)
              if (imageResponse.ok()) await fs.writeFile(relativeImagePath, await imageResponse.buffer())
              else relativeImagePath = null
            } catch (e) {
              console.log(`  下载图片失败: ${e.message}`)
              relativeImagePath = null
            }
          }

          delete finalCardData.image_url
          finalCardData.image_path = relativeImagePath

          await fs.appendFile(jsonlFileName, JSON.stringify(finalCardData) + '\n', 'utf8')
          console.log(
            `  [${totalProcessedCount}] ✅ 已抓取 [${finalCardData.card_category}] 卡: ${
              typeof finalCardData.name === 'object' ? finalCardData.name.zh : finalCardData.name
            }`
          )
        } catch (err) {
          console.log(`  [${totalProcessedCount}] ❌ 处理 ${detailUrl} 时发生错误: ${err.message}`)
        } finally {
          await detailPage.close()
        }
      }
    }

    // --- 3. 抓取完成后，执行转换 ---
    console.log(`\n成功处理了 ${totalProcessedCount} 张卡片.`)
    await convertJsonlToJson(jsonlFileName, jsonFileName)
  } catch (error) {
    console.error('爬虫主程序发生严重错误:', error)
  } finally {
    console.log(`\n🎉 全部操作完成！`)
    await browser.close()
  }
}

// 运行主函数
scrapePokemonCards()
