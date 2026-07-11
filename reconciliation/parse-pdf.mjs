/**
 * Parse sorting PDF using pdf-parse v2 API
 * Source: upload/สต๊อกทั้งหมด_คัดแยก_เสียหาย_Google_ชีต.pdf
 */
import { PDFParse } from 'pdf-parse'
import fs from 'fs'

const FILE = '/home/z/my-project/upload/สต๊อกทั้งหมด_คัดแยก_เสียหาย_Google_ชีต.pdf'
console.log('Reading:', FILE)
const buf = fs.readFileSync(FILE)

const parser = new PDFParse({ data: new Uint8Array(buf) })
const result = await parser.getText()
console.log('Total pages:', result.total)
console.log('Text length:', result.text.length)

fs.writeFileSync('/home/z/my-project/reconciliation/sorting-pdf-raw.txt', result.text)
console.log('Saved to sorting-pdf-raw.txt')

console.log('\n=== First 5000 chars ===')
console.log(result.text.substring(0, 5000))
