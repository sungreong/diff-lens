const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

const encoder = new TextEncoder()

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

const crc32 = (bytes) => {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const dosDateTime = (date = new Date()) => {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2)
  const dosDate =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate()
  return { time, date: dosDate }
}

const writeUint16 = (view, offset, value) => view.setUint16(offset, value, true)
const writeUint32 = (view, offset, value) => view.setUint32(offset, value, true)

const concatBytes = (parts) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const createZip = (entries) => {
  const localParts = []
  const centralParts = []
  const { time, date } = dosDateTime()
  let offset = 0

  entries.forEach(({ name, content }) => {
    const nameBytes = encoder.encode(name)
    const contentBytes = typeof content === 'string' ? encoder.encode(content) : content
    const crc = crc32(contentBytes)

    const localHeader = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(localHeader.buffer)
    writeUint32(localView, 0, 0x04034b50)
    writeUint16(localView, 4, 20)
    writeUint16(localView, 6, 0)
    writeUint16(localView, 8, 0)
    writeUint16(localView, 10, time)
    writeUint16(localView, 12, date)
    writeUint32(localView, 14, crc)
    writeUint32(localView, 18, contentBytes.length)
    writeUint32(localView, 22, contentBytes.length)
    writeUint16(localView, 26, nameBytes.length)
    writeUint16(localView, 28, 0)
    localHeader.set(nameBytes, 30)

    localParts.push(localHeader, contentBytes)

    const centralHeader = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(centralHeader.buffer)
    writeUint32(centralView, 0, 0x02014b50)
    writeUint16(centralView, 4, 20)
    writeUint16(centralView, 6, 20)
    writeUint16(centralView, 8, 0)
    writeUint16(centralView, 10, 0)
    writeUint16(centralView, 12, time)
    writeUint16(centralView, 14, date)
    writeUint32(centralView, 16, crc)
    writeUint32(centralView, 20, contentBytes.length)
    writeUint32(centralView, 24, contentBytes.length)
    writeUint16(centralView, 28, nameBytes.length)
    writeUint16(centralView, 30, 0)
    writeUint16(centralView, 32, 0)
    writeUint16(centralView, 34, 0)
    writeUint16(centralView, 36, 0)
    writeUint32(centralView, 38, 0)
    writeUint32(centralView, 42, offset)
    centralHeader.set(nameBytes, 46)
    centralParts.push(centralHeader)

    offset += localHeader.length + contentBytes.length
  })

  const centralDirectory = concatBytes(centralParts)
  const endRecord = new Uint8Array(22)
  const endView = new DataView(endRecord.buffer)
  writeUint32(endView, 0, 0x06054b50)
  writeUint16(endView, 4, 0)
  writeUint16(endView, 6, 0)
  writeUint16(endView, 8, entries.length)
  writeUint16(endView, 10, entries.length)
  writeUint32(endView, 12, centralDirectory.length)
  writeUint32(endView, 16, offset)
  writeUint16(endView, 20, 0)

  return concatBytes([...localParts, centralDirectory, endRecord])
}

const cleanText = (value) => String(value ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

const escapeXml = (value) => cleanText(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

const columnName = (index) => {
  let name = ''
  let value = index + 1
  while (value > 0) {
    const mod = (value - 1) % 26
    name = String.fromCharCode(65 + mod) + name
    value = Math.floor((value - mod) / 26)
  }
  return name
}

const safeSheetName = (name) => {
  const cleaned = cleanText(name || 'Sheet1').replace(/[\\/?*[\]:]/g, ' ').trim()
  return (cleaned || 'Sheet1').slice(0, 31)
}

const cellXml = (value, ref, style = 0) => {
  const styleAttr = style ? ` s="${style}"` : ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${styleAttr}><v>${value}</v></c>`
  }
  return `<c r="${ref}" t="inlineStr"${styleAttr}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
}

const worksheetXml = ({ columns, rows, freezeRows = 1, freezeColumns = 0 }) => {
  const safeRows = rows || []
  const lastColumn = columnName(Math.max(columns.length - 1, 0))
  const lastRow = safeRows.length + 1
  const pane = (() => {
    if (!freezeRows && !freezeColumns) return ''
    const attrs = []
    if (freezeColumns) attrs.push(`xSplit="${freezeColumns}"`)
    if (freezeRows) attrs.push(`ySplit="${freezeRows}"`)
    attrs.push(`topLeftCell="${columnName(freezeColumns)}${freezeRows + 1}"`)
    attrs.push(`activePane="${freezeColumns && freezeRows ? 'bottomRight' : freezeColumns ? 'topRight' : 'bottomLeft'}"`)
    attrs.push('state="frozen"')
    return `<pane ${attrs.join(' ')}/>`
  })()
  const cols = columns.map((column, index) => {
    const width = Number.isFinite(column.width) ? column.width : 18
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
  }).join('')

  const headerRow = `<row r="1">${columns.map((column, index) => (
    cellXml(column.header, `${columnName(index)}1`, column.headerStyle ?? 1)
  )).join('')}</row>`

  const bodyRows = safeRows.map((row, rowIndex) => {
    const excelRow = rowIndex + 2
    const cells = columns.map((column, columnIndex) => {
      const value = row[column.key]
      const columnStyle = typeof column.style === 'function'
        ? column.style({ value, row, rowIndex, columnIndex, column })
        : column.style
      const style = row.__styles?.[column.key] ?? columnStyle ?? 0
      return cellXml(value, `${columnName(columnIndex)}${excelRow}`, style)
    }).join('')
    return `<row r="${excelRow}">${cells}</row>`
  }).join('')

  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><cols>${cols}</cols><sheetData>${headerRow}${bodyRows}</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`
}

const workbookXml = (sheets) => (
  `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => (
    `<sheet name="${escapeXml(sheet.safeName)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  )).join('')}</sheets></workbook>`
)

const workbookRelsXml = (sheets) => `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((sheet, index) => (
  `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
)).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`

const rootRelsXml = `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

const contentTypesXml = (sheets) => `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((sheet, index) => (
  `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
)).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`

const solidFill = (color) => `<fill><patternFill patternType="solid"><fgColor rgb="${color}"/><bgColor indexed="64"/></patternFill></fill>`

const stylesXml = (() => {
  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    solidFill('FF3B2F23'), // 2 header
    solidFill('FFEDE7D8'), // 3 note/metadata
    solidFill('FFDAF2E3'), // 4 additions low
    solidFill('FFA8DFC0'), // 5 additions medium
    solidFill('FF65BE88'), // 6 additions high
    solidFill('FF2F8B57'), // 7 additions extreme
    solidFill('FFFFE0D6'), // 8 deletions low
    solidFill('FFFFB89F'), // 9 deletions medium
    solidFill('FFFF7F5F'), // 10 deletions high
    solidFill('FFD84B33'), // 11 deletions extreme
    solidFill('FFE5D19E'), // 12 total
  ]
  const cellXfs = [
    '<xf fontId="0" fillId="0" borderId="0" xfId="0"/>',
    '<xf fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>',
    '<xf fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>',
    '<xf fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>',
    '<xf fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>',
    '<xf fontId="1" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>',
    '<xf fontId="1" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>',
    '<xf fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>',
    '<xf fontId="0" fillId="9" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>',
    '<xf fontId="1" fillId="10" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>',
    '<xf fontId="1" fillId="11" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>',
    '<xf fontId="0" fillId="12" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>',
  ]

  return `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD6C899"/></left><right style="thin"><color rgb="FFD6C899"/></right><top style="thin"><color rgb="FFD6C899"/></top><bottom style="thin"><color rgb="FFD6C899"/></bottom></border></borders><cellStyleXfs count="1"><xf fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${cellXfs.length}">${cellXfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="TableStyleLight16"/></styleSheet>`
})()

export const createXlsxBlob = ({ sheetName = 'Sheet1', columns, rows, sheets }) => {
  const workbookSheets = (sheets && sheets.length ? sheets : [{ sheetName, columns, rows }])
    .map((sheet, index) => ({
      ...sheet,
      safeName: safeSheetName(sheet.sheetName || `Sheet${index + 1}`),
    }))
  const zipBytes = createZip([
    { name: '[Content_Types].xml', content: contentTypesXml(workbookSheets) },
    { name: '_rels/.rels', content: rootRelsXml },
    { name: 'xl/workbook.xml', content: workbookXml(workbookSheets) },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml(workbookSheets) },
    { name: 'xl/styles.xml', content: stylesXml },
    ...workbookSheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: worksheetXml(sheet),
    })),
  ])

  return new Blob([zipBytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export const downloadXlsx = ({ filename, sheetName, columns, rows, sheets }) => {
  const blob = createXlsxBlob({ sheetName, columns, rows, sheets })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
