export interface OwnerProductBoundary {
  ownerLabel: string
  productId: string
  productName: string
  originalStartDate: string
  effectiveStartDate: string
  startingWeight?: number
  currentTarget?: number
}

export interface OwnerAcceptedVariance {
  /** Owner-approved opening stock (kg) — preserved exactly, never force-adjusted. */
  approvedOpening: number
  /** Owner-reported comparison value at the reporting date (kg). */
  comparisonValue: number
  /** Accepted signed variance (kg) = calculatedClosing − comparisonValue. */
  acceptedVariance: number
  /** Reporting date the comparison value applies to (Thailand business date). */
  comparisonDate: string
  /** Human-readable Owner decision note. */
  note: string
}

/** Owner-approved, deterministic Production mapping. No fuzzy matching at runtime. */
const OWNER_BOUNDARY_ROWS: ReadonlyArray<readonly [string, string, string, string, string, number?, number?]> = [
  ['ทองแดงปอก','prod_mqgp9aevp2yb18adpkyr3qtr','ทองแดงปอกเงา','2026-07-04','2026-07-04'],['ทองแดงช็อต','prod_mqgp9alick357v31bqqrlv43','ทองแดงช็อต','2026-07-04','2026-07-04'],['ทองแดงใหญ่','prod_mqgp9arb37xlm6b54b0xa44v','ทองแดงใหญ่','2026-07-04','2026-07-04'],['ทองแดงเล็ก','prod_mqgp9axign3hnk45ex03l4aw','ทองแดงเล็ก','2026-07-04','2026-07-04'],['ทองแดงชุบ','prod_mqgp9bgavns7vxc8rzrlsn65','ทองแดงชุบ','2026-07-04','2026-07-04'],['หม้อน้ำทองแดง','prod_mqgp9b9ouoxmoeq34ccaydfj','หม้อน้ำทองแดง','2026-07-04','2026-07-04'],
  ['ทองเหลือง','prod_mqgp9bspglewfbgukggj7wdy','ทองเหลืองหนา','2026-07-04','2026-07-04'],['ทองเหลืองเนื้อแดง','prod_mqgp9bmg24ygg55yytz9jphl','ทองเหลืองเนื้อแดง','2026-07-04','2026-07-04'],['ว่าน้ำทองเหลือง','prod_mqgp9c4i0fakfeg9387qaqwv','หม้อน้ำทองเหลือง','2026-07-04','2026-07-04'],['ขี้กลึงทองเหลือง','prod_mqgp9bylqjal88hmac4ykwo0','ขี้กลึงทองเหลือง','2026-04-21','2026-04-21'],
  ['ขี้กลึงทองเหลืองเนื้อแดง','prod_new_1782125294097_e0b882e0b8b5e0b989e0b881','ขี้กลึงทองเหลืองเนื้อแดง','2025-05-13','2026-01-01',undefined,0],['สแตนเลส 304','prod_mqgp9caefhv0hs74sfuubrmr','สแตนเลส 304','2026-02-05','2026-02-05'],['สแตนเลส 202','prod_mqgp9cmnidvf2vafwiepqg0d','สแตนเลส 202','2026-02-05','2026-02-05'],['สแตนเลสดูดติด','prod_new_1782125294328_e0b981e0b8aae0b895e0b899','สแตนเลสดูดติด','2026-02-05','2026-02-05'],['สแตนเลส 304 ยาว','prod_mqgp9cgafv9ts0i3ze22h1vb','สแตนเลส 304 ยาว','2026-02-05','2026-02-05'],['สแตนเลสติดเหล็ก','cmr09vcvi001ml1055umg3jpg','สแตนเลสติดเหล็ก','2026-02-05','2026-02-05'],['นิกเกิล','cmr09vcvk002gl105fbuztaig','นิกเกิล','2026-02-05','2026-02-05',0],['ขี้กลึงสแตนเลส 304','cmr09vcvi001ql105usal36bv','ขี้กลึงสแตนเลส304','2026-01-22','2026-01-22'],
  ['ตะกั่วนิ่ม','prod_mqgp9hcgjuw6kt6ob5n75e4s','ตะกั่วนิ่ม','2026-05-27','2026-05-27'],['ตะกั่วแข็ง','prod_mqgp9h6flpekakyzewnjsp1y','ตะกั่วแข็ง','2026-05-27','2026-05-27'],['ขี้กลึงตะกั่ว','prod_new_1782125294561_e0b882e0b8b5e0b989e0b881','ขี้กลึงตะกั่ว','2026-01-22','2026-01-22'],
  ['แท็บเล็ต','cmr09vcvj0020l105s5hmor3v','แท็บเล็ต','2025-10-29','2026-01-01',undefined,0],['แผงวงจรติดสายไฟ','cmr09vcvj0022l105nwoir2px','พวงแผงวงจรติดสายไฟ','2025-10-29','2026-01-01',undefined,0],['มอเตอร์','prod_mqgp9hpqehz5267b46pxo5ic','มอเตอร์','2024-07-03','2026-01-01',658],['ของแกะ','prod_mqgp9hja0s6zbk3yvapoxjjs','ของแกะ','2026-07-01','2026-07-01',1000],['คอมดำ','prod_mqgp9hwdo411xly6wmmeyg86','คอมดำ','2024-07-29','2026-01-01',629.3],['สายไฟไม่ปอก','cmr09vcvj0024l1052pb03lfk','สายไฟไม่ปอก','2025-10-28','2026-01-01',undefined,987.8],['เปลือกสายไฟ','cmr09vcvj0026l105hlbo4dvs','เปลือกสายไฟ','2019-11-18','2026-01-01',undefined,1000],
  ['อลูมิเนียมกระป๋อง','prod_mqgp9duo294uh2l320pbg1ru','อลูมิเนียมกระป๋อง','2026-06-25','2026-06-25'],['อลูมิเนียมล้อแม็ก','prod_mqgp9dhn9ryniksnud8q714g','อลูมิเนียมล้อแม๊กซ์','2026-06-23','2026-06-23'],['อลูมิเนียมสายไฟ','prod_mqgp9csvq0takfp04k5d2dv6','อลูมิเนียมสายไฟ','2026-06-23','2026-06-23'],['อลูมิเนียมบาง','prod_mqgp9d5g7uiu7tttxza864tp','อลูมิเนียมบาง','2026-06-27','2026-06-27'],['อลูมิเนียมแข็ง','prod_mqgp9do7ui6p53xv2tbjq7tb','อลูมิเนียมแข็ง (หล่อ/หนา)','2026-06-27','2026-06-27'],['อลูมิเนียมผ้าเบรค','cmr7a7o4m0001mzietaojyqbr','อลูมิเนียมผ้าเบรค','2026-07-06','2026-07-06'],['อลูมิเนียมตูดกระทะไฟฟ้า','cmr7a7qjs000bmzies46dqkj9','อลูมิเนียมตูดกะทะไฟฟ้า','2026-07-05','2026-07-05'],['อลูมิเนียมกระทะ','prod_mqgp9e6yxtg3mo8mf998qnf6','อลูมิเนียมกะทะ','2026-06-23','2026-06-23'],['อลูมิเนียมตูดกระทะ','prod_mqgp9edcxnxkocxfu0odbayj','อลูมิเนียมตูดกะทะ','2026-06-23','2026-06-23'],['อลูมิเนียมมุ้งลวด','prod_mqgp9fsl7s0haidcn5c9t4ee','อลูมิเนียมมุ้งลวด','2026-03-31','2026-03-31'],['อลูมิเนียมมู่ลี่','prod_mqgp9fz6pqfgrkxoh5nbgchi','อลูมิเนียมมู่ลี่','2026-06-23','2026-06-23'],['ฝาอลูมิเนียม','prod_mqgp9e0y2ehae94h2mw403ns','อลูมิเนียมฝา','2026-06-23','2026-06-23'],['ฝาอลูมิเนียมไม่แกะ','cmr7uoxv40003mzw7nv8rwlf9','อลูมิเนียมฝาไม่แกะ','2026-07-06','2026-07-06'],['อลูมิเนียมฉาก','prod_mqgp9cyrr65cu9xaams1daoh','อลูมิเนียมฉาก','2026-06-24','2026-06-24'],['หม้อน้ำอลูมิเนียม','prod_mqgp9ejcaz0g567zocy5ub8j','หม้อน้ำอลูมิเนียม','2026-06-23','2026-06-23'],['อลูมิเนียมเครื่อง','prod_mqgp9fgoheos0xee1ntl0r27','อลูมิเนียมเครื่อง','2026-06-23','2026-06-23'],['อลูมิเนียมคิดว่าน้ำ','prod_mqgp9fmounwsgwm9xyso0phf','อลูมิเนียมครีบหม้อน้ำ','2026-04-01','2026-04-01'],['อลูมิเนียมอัลลอย','prod_mqgp9dbqtfx0j3mnsbl9mwix','อลูมิเนียมอัลลอยด์','2026-06-23','2026-06-23'],['อลูมิเนียมแผ่นเพลท','cmr7a7plm0007mzie5kkgqpdh','อลูมิเนียมแผ่นเพลท','2026-06-23','2026-06-23'],['สายไฟอลูมิเนียมไม่ปอก','cmr7uoxjq0001mzw7705kqqe7','สายไฟอลูมิเนียม','2026-07-05','2026-07-05'],['ขี้กลึงอลูมิเนียม','cmr7uoz4m000bmzw7ir3p89ns','ขี้กลึงอลูมิเนียม','2026-01-22','2026-01-22'],['อลูมิเนียมฉากสี','prod_mqgp9fa7fylab8ztuya98a9p','อลูมิเนียมฉากสี','2026-07-05','2026-07-05'],['กระป๋องสเปรย์อลูมิเนียม','cmr7a7q2o0009mziel3n3tz4c','อลูมิเนียมกระป๋องสเปรย์','2026-07-05','2026-07-05'],['ปั๊มกระป๋อง','prod_mqgp9gn9lfu942el9hx2undl','ปั้มกระป๋อง','2026-07-05','2026-07-05'],['ฟรอยอลูมิเนียม','cmr7uozfz000dmzw73kzv9r23','ฟรอยไม่ติดพลาสติก','2026-07-05','2026-07-05'],['ฝาอลูมิเนียมเผา','prod_mqgp9epjox7up6c2k8jrf289','อลูมิเนียมฝาเผา','2026-07-05','2026-07-05'],['อลูมิเนียมตูดหม้อหุงข้าว','prod_mqgp9ew9ar8ckyjn69mr8aq2','ตูดหม้อหุงข้าว','2026-07-05','2026-07-05'],['อลูมิเนียมแข็งติดสี','cmr7a7rhy000fmziexzseffgk','อลูมิเนียมแข็งติดสี','2026-06-23','2026-06-23'],['อลูมิเนียมแข็งลูกสูบ','cmr7a7ryz000hmziewpih12np','อลูมิเนียมแข็งลูกสูบ','2026-07-06','2026-07-06'],['อลูมิเนียมแข็งก้านเบรค','cmr7a7sg1000jmziewgol2rch','อลูมิเนียมแข็งก้านเบรค','2026-07-06','2026-07-06'],
]

const DERIVED_OWNER_OPENINGS: Readonly<Record<string, number>> = {
  'ขี้กลึงทองเหลืองเนื้อแดง': 0,
  'แท็บเล็ต': 0,
  'แผงวงจรติดสายไฟ': 0,
  'สายไฟไม่ปอก': 925.5,
  'เปลือกสายไฟ': 987.8,
}

/**
 * Owner-approved accepted variances between the calculated closing stock and the
 * Owner-reported comparison value. The opening stock is preserved exactly; the
 * variance is NOT eliminated by force-adjusting the opening.
 *
 * Key: ownerLabel. Value: the accepted variance evidence.
 */
export const OWNER_ACCEPTED_VARIANCES: Readonly<Record<string, OwnerAcceptedVariance>> = {
  'สายไฟไม่ปอก': {
    approvedOpening: 925.5,
    comparisonValue: 987.8,
    acceptedVariance: 7.6,
    comparisonDate: '2026-07-18',
    note: 'Owner-approved opening 925.50 kg. Dry-run calculated closing 995.40 kg. ' +
      'Owner-reported comparison value 987.80 kg at 2026-07-18. ' +
      'Accepted variance +7.60 kg (calc − comparison). ' +
      'Opening is NOT changed to 917.90 to force equality. ' +
      'The variance remains visible in baseline evidence and audit notes.',
  },
}

export const ST47_OWNER_PRODUCT_BOUNDARIES: readonly OwnerProductBoundary[] = OWNER_BOUNDARY_ROWS.map(
  ([ownerLabel, productId, productName, originalStartDate, effectiveStartDate, startingWeight, currentTarget]) =>
    ({ ownerLabel, productId, productName, originalStartDate, effectiveStartDate,
      startingWeight: startingWeight ?? DERIVED_OWNER_OPENINGS[ownerLabel] ?? 0, currentTarget }),
)

export function assertUniqueOwnerProductBoundaries(rows = ST47_OWNER_PRODUCT_BOUNDARIES): void {
  const labels = new Set<string>(), ids = new Set<string>()
  for (const row of rows) {
    if (labels.has(row.ownerLabel)) throw new Error(`Duplicate Owner label: ${row.ownerLabel}`)
    if (ids.has(row.productId)) throw new Error(`Duplicate Product ID: ${row.productId}`)
    labels.add(row.ownerLabel); ids.add(row.productId)
  }
}
