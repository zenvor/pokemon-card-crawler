import puppeteer from 'puppeteer'
import fs from 'fs/promises'
import path from 'path'

// === 辅助函数：将JSONL文件转换为标准JSON文件 ===
async function convertJsonlToJson(jsonlPath, jsonPath) {
  console.log(`\n正在将 ${jsonlPath} 转换为 ${jsonPath}...`)
  try {
    const fileContent = await fs.readFile(jsonlPath, 'utf8')
    // 1. 按换行符分割成数组
    const lines = fileContent.split('\n')

    // 2. 过滤掉空行并解析每一行为JSON对象
    const jsonObjects = lines.filter((line) => line.trim() !== '').map((line) => JSON.parse(line))

    // 3. 将对象数组格式化为漂亮的JSON字符串
    const jsonString = JSON.stringify(jsonObjects, null, 2)

    // 4. 写入新的 .json 文件
    await fs.writeFile(jsonPath, jsonString, 'utf8')
    console.log(`✅ 成功将数据转换为标准JSON格式，并保存到 ${jsonPath}`)
  } catch (error) {
    console.error(`❌ 转换文件时出错: ${error.message}`)
  }
}

// === 辅助函数：用于将图片文件名映射为文本 ===
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

// === 主抓取函数 ===
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
  // const url = 'https://asia.pokemon-card.com/hk/card-search/list/?pageNo=1&expansionCodes=SVAW'
  const url = 'https://asia.pokemon-card.com/hk/card-search/list/?pageNo=2&expansionCodes=SVAW'

  try {
    // --- 1. 抓取所有卡片详情页的链接 ---
    console.log(`正在导航到列表页面: ${url}`)
    await page.goto(url, { waitUntil: 'networkidle2' })

    const cardLinks = await page.evaluate(() => {
      const cardElements = Array.from(document.querySelectorAll('.rightColumn li.card'))
      const host = window.location.origin
      return cardElements
        .map((card) => {
          const aTag = card.querySelector('a')
          return aTag ? `${host}${aTag.getAttribute('href')}` : null
        })
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
        let cardData = await detailPage.evaluate((energyMap) => {
          const getText = (selector, root = document) => {
            const element = root.querySelector(selector)
            return element ? element.innerText.trim().replace(/\s*\n\s*/g, ' ') : null
          }
          const getAttr = (selector, attr) => {
            const element = document.querySelector(selector)
            return element ? element.getAttribute(attr) : null
          }

          const headerEl = document.querySelector('h1.pageHeader.cardDetail')
          let name_zh = null,
            card_type = null
          if (headerEl) {
            card_type = getText('.evolveMarker', headerEl)
            const nameElClone = headerEl.cloneNode(true)
            const evolveMarker = nameElClone.querySelector('.evolveMarker')
            if (evolveMarker) evolveMarker.remove()
            name_zh = nameElClone.innerText.trim()
          }

          const card_id = getAttr('.cardImage img', 'src')?.split('/').pop()?.split('.')[0] || null
          const image_url = getAttr('.cardImage img', 'src')

          const dexHeader = getText('.extraInformation h3')
          let national_no = dexHeader?.match(/No\.(\d+)/)?.[1] || null
          if (national_no) national_no = national_no.padStart(4, '0')

          // ... (所有其他数据提取逻辑保持不变) ...
          const hp = parseInt(getText('.mainInfomation .number'), 10) || null
          const abilities = Array.from(document.querySelectorAll('.skillInformation .skill')).map((skillEl) => ({
            name: getText('.skillName', skillEl),
            type: energyMap[skillEl.querySelector('.skillCost img')?.src.split('/').pop()] || null,
            damage: parseInt(getText('.skillDamage', skillEl), 10) || null,
            effect: getText('.skillEffect', skillEl) || null,
          }))
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
          const category = dexHeader?.split(' ')?.[1] || null
          const sizeText = getText('.extraInformation .size')
          const height = sizeText?.match(/身高.*?(\d+\.?\d*)/)?.[1] + 'm' || null
          const weight = sizeText?.match(/體重.*?(\d+\.?\d*)/)?.[1] + 'kg' || null
          const illustrator = getText('.illustrator a')
          const collectorNumber = getText('.expansionColumn .collectorNumber')
          const regulationMark = getText('.expansionColumn .alpha')
          const expansionSymbolImg = getAttr('.expansionColumn .expansionSymbol img', 'src')
          const expansionCode = expansionSymbolImg?.split('/').pop()?.split('_')[0].toUpperCase() || ''
          const rarityCode = expansionSymbolImg?.split('_').pop()?.split('.')[0] || ''
          const card_number = `${regulationMark} ${expansionCode} ${rarityCode.toUpperCase()} ${collectorNumber}`
          const flavor_text = getText('.extraInformation .discription')

          return {
            image_url,
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
        }, energyMap)

        let relativeImagePath = null
        if (cardData && cardData.image_url) {
          const imageName = path.basename(cardData.image_url)
          relativeImagePath = path.join(imageDir, imageName)
          const imageResponse = await detailPage.goto(cardData.image_url)
          if (imageResponse.ok()) await fs.writeFile(relativeImagePath, await imageResponse.buffer())
          else relativeImagePath = null
        }

        if (cardData) {
          const finalCardData = cardData.data
          finalCardData.image_path = relativeImagePath
          await fs.appendFile(jsonlFileName, JSON.stringify(finalCardData) + '\n', 'utf8')
          console.log(
            `[${i + 1}/${cardLinks.length}] ✅ 已抓取并保存: ${finalCardData.name.zh} (${finalCardData.card_id})`
          )
        }
      } catch (err) {
        console.log(`[${i + 1}/${cardLinks.length}] ❌ 处理 ${detailUrl} 时发生错误: ${err.message}`)
      } finally {
        await detailPage.close()
      }
    }

    // --- 3. [新增] 抓取完成后，执行转换 ---
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
