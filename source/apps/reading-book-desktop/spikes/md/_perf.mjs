import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
const shapes = {
  paragraphs: 'Plain paragraph text with some words in it, nothing else.\n\n',
  headings: '## Title\n\n',
  list: '- item\n- item\n\n',
  inline: 'Text with **bold**, *italic* and `code` here.\n\n',
  link: 'A [link](https://example.com) here.\n\n',
}
for (const [name, block] of Object.entries(shapes)) {
  for (const kb of [100, 400]) {
    for (const gfm of [false, true]) {
      const text = block.repeat(Math.ceil(kb*1024/block.length))
      const t = Date.now()
      const p = unified().use(remarkParse); if (gfm) p.use(remarkGfm)
      p.parse(text)
      console.log(name, kb, gfm?'gfm':'plain', Date.now()-t, 'ms')
    }
  }
}
