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
  const jsonlFileName = 'pokemon_cards_SVAW.jsonl'
  const jsonFileName = 'pokemon_cards_SVAW.json'

  console.log('进行初始化设置...')
  await fs.mkdir(imageDir, { recursive: true })
  await fs.writeFile(jsonlFileName, '', 'utf8')

  console.log('启动浏览器...')
  const browser = await puppeteer.launch({ headless: 'new' })
  const page = await browser.newPage()
  const listUrl = 'http://127.0.0.1:5500/index.html'

  try {
    // --- 1. 抓取所有卡片详情页的链接 ---
    console.log(`正在导航到列表页面: ${listUrl}`)
    await page.goto(listUrl, { waitUntil: 'networkidle2' })

    const cardLinks = await page.evaluate(() => {
      const cardElements = Array.from(document.querySelectorAll('.rightColumn li.card'))
      const host = 'https://asia.pokemon-card.com' // window.location.origin
      return cardElements
        .map((card) => (card.querySelector('a') ? `${host}${card.querySelector('a').getAttribute('href')}` : null))
        .filter((link) => link)
    })
    console.log(`成功提取了 ${cardLinks.length} 个卡片详情页链接.`)

    // --- 2. 遍历链接，抓取、下载并保存每个卡片的数据 ---
    console.log(`\n--- 开始逐个处理卡片，结果将实时写入 ${jsonlFileName} ---`)
    for (let i = 0; i < cardLinks.length; i++) {
      const detailUrl = cardLinks[i]
      const detailPage = await browser.newPage()

      try {
        await detailPage.goto(detailUrl, { waitUntil: 'networkidle2' })

        // 在页面上下文中执行抓取逻辑
        let cardDataPayload = await detailPage.evaluate((energyMap) => {
          // ---- 通用辅助函数 ----
          const getText = (selector, root = document) =>
            root
              .querySelector(selector)
              ?.innerText.trim()
              .replace(/\s*\n\s*/g, ' ') || null
          const getAttr = (selector, attr) => document.querySelector(selector)?.getAttribute(attr) || null

          // ---- 通用信息提取函数 ----
          const getCommonData = () => {
            const card_id = getAttr('.cardImage img', 'src')?.split('/').pop()?.split('.')[0] || null
            const image_url = getAttr('.cardImage img', 'src')
            const collectorNumber = getText('.expansionColumn .collectorNumber')
            const regulationMark = getText('.expansionColumn .alpha')
            const expansionSymbolImg = getAttr('.expansionColumn .expansionSymbol img', 'src')
            const expansionCode = expansionSymbolImg?.split('/').pop()?.split('_')[0].toUpperCase() || ''
            const rarityCode = expansionSymbolImg?.split('_').pop()?.split('.')[0] || ''
            const card_number = `${regulationMark || ''} ${expansionCode} ${rarityCode.toUpperCase()} ${
              collectorNumber || ''
            }`.trim()

            return {
              card_id,
              image_url, // 临时传递，用于下载
              name: getText('h1.pageHeader'),
              card_info: {
                illustrator: getText('.illustrator a'),
                card_number: card_number,
                rarity: rarityCode ? `${rarityCode.toUpperCase()}稀有` : null,
                set: '朱&紫', // 需根据 expansionCode 进一步完善
              },
              appearance: null, // 页面无此信息
            }
          }

          // ---- 卡片种类判断 (分类器) ----
          const isPokemonCard = document.querySelector('.evolveMarker') !== null
          const commonHeaderText = getText('.commonHeader')

          // ---- 数据提取路由 ----
          if (isPokemonCard) {
            // --- 是宝可梦卡 ---
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

            const data = {
              card_id: commonData.card_id,
              card_category: '宝可梦卡',
              card_type: card_type,
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
            }
            return { data }
          } else if (['物品卡', '支援者卡', '競技場卡', '寶可夢道具'].includes(commonHeaderText)) {
            // --- 是训练家卡 ---
            const commonData = getCommonData()
            const data = {
              card_id: commonData.card_id,
              card_category: '训练家卡',
              sub_type: commonHeaderText,
              name: commonData.name,
              image_url: commonData.image_url,
              effect: getText('.skillEffect'),
              card_info: commonData.card_info,
              appearance: commonData.appearance,
            }
            return { data }
          } else if (['基本能量卡', '特殊能量卡'].includes(commonHeaderText)) {
            // --- 是能量卡 ---
            const commonData = getCommonData()
            const data = {
              card_id: commonData.card_id,
              card_category: '能量卡',
              sub_type: commonHeaderText,
              name: commonData.name,
              image_url: commonData.image_url,
              effect: commonHeaderText === '特殊能量卡' ? getText('.skillEffect') : null,
              card_info: commonData.card_info,
              appearance: commonData.appearance,
            }
            return { data }
          }

          return null // 未知类型
        }, energyMap)

        if (!cardDataPayload) {
          console.log(`[${i + 1}/${cardLinks.length}] ⚠️  跳过未知类型的卡片: ${detailUrl}`)
          continue
        }

        // ---- 后续处理 (下载图片、写入文件) ----
        let relativeImagePath = null
        if (cardDataPayload.data && cardDataPayload.data.image_url) {
          const imageName = path.basename(cardDataPayload.data.image_url)
          relativeImagePath = path.join(imageDir, imageName)
          const imageResponse = await detailPage.goto(cardDataPayload.data.image_url)
          if (imageResponse.ok()) await fs.writeFile(relativeImagePath, await imageResponse.buffer())
          else relativeImagePath = null
        }

        if (cardDataPayload.data) {
          const finalCardData = cardDataPayload.data
          delete finalCardData.image_url // 删除临时的image_url字段
          finalCardData.image_path = relativeImagePath
          await fs.appendFile(jsonlFileName, JSON.stringify(finalCardData) + '\n', 'utf8')
          console.log(
            `[${i + 1}/${cardLinks.length}] ✅ 已抓取 [${finalCardData.card_category}] 卡: ${
              typeof finalCardData.name === 'object' ? finalCardData.name.zh : finalCardData.name
            }`
          )
        }
      } catch (err) {
        console.log(`[${i + 1}/${cardLinks.length}] ❌ 处理 ${detailUrl} 时发生错误: ${err.message}`)
      } finally {
        await detailPage.close()
      }
    }

    // --- 3. 抓取完成后，执行转换 ---
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
