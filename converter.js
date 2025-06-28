import { promises as fs } from 'fs'
import path from 'path'

// =================================================================
// --- 配置区域 ---
// =================================================================
const CONFIG = {
  // 输入的增量写入的JSONL文件名
  JSONL_FILE_NAME: 'pokemon_cards.jsonl',
  // 最终输出的标准JSON文件名
  JSON_FILE_NAME: 'pokemon_cards.json',
}
// =================================================================

/**
 * 将JSONL文件（每行一个JSON对象）转换为标准的、格式化的JSON数组文件。
 */
async function convertJsonlToJson() {
  const jsonlPath = path.join(process.cwd(), CONFIG.JSONL_FILE_NAME)
  const jsonPath = path.join(process.cwd(), CONFIG.JSON_FILE_NAME)

  console.log(`\n正在读取 ${jsonlPath}...`)

  try {
    const fileContent = await fs.readFile(jsonlPath, 'utf8')
    const lines = fileContent.split('\n').filter((line) => line.trim() !== '') // 过滤空行

    console.log(`发现 ${lines.length} 条记录，开始转换...`)

    const jsonObjects = lines
      .map((line, index) => {
        try {
          return JSON.parse(line)
        } catch (error) {
          console.error(`❌ 解析第 ${index + 1} 行时出错: ${error.message}`)
          return null
        }
      })
      .filter((obj) => obj !== null) // 过滤掉解析失败的行

    const jsonString = JSON.stringify(jsonObjects, null, 2) // 格式化输出

    await fs.writeFile(jsonPath, jsonString, 'utf8')

    console.log(`✅ 成功将 ${jsonObjects.length} 条记录转换为标准JSON格式，并保存到 ${jsonPath}`)
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`❌ 错误: 输入文件未找到! 请确保 ${CONFIG.JSONL_FILE_NAME} 文件存在于当前目录。`)
    } else {
      console.error(`❌ 转换文件时发生未知错误: ${error.message}`)
    }
  }
}

// 运行主函数
convertJsonlToJson()
