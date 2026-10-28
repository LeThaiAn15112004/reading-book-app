# Per-format fields (illustrative; same annotation object, only these fields differ)

PDF highlight (origin app):
  "locator": { "kind": "page-rect", "page": 12 },
  "pdfAnnotation": { "pageIndex": 11, "rects": [{ "x": 0.12, "y": 0.31, "width": 0.55, "height": 0.02 }] }

PDF annotation made in another reader (origin file):
  same as above plus  "origin": "file", "nm": "<the PDF's /NM>"

TXT:
  "locator": { "kind": "text-offset", "offset": 1042, "blockId": "txt" },
  "txtAnnotation": { "startOffset": 1042, "endOffset": 1098 }   (header: "txt": { "contentSha256": "…" })

Markdown:
  "locator": { "kind": "text-offset", "offset": 0, "blockId": "md" },
  "mdAnnotation": { start/end as stored: segment + offset }
