#!/usr/bin/env node
// Documentation check, part of `npm run check`. Fails when a code file has no header comment
// that says what it is for, or when an exported TypeScript item or a `pub` Rust item has no doc
// comment right above it (attributes and decorators may sit in between).
//
// Run alone: node scripts/check-docs.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const problems = []

function files(dir, ext) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...files(path, ext))
    else if (name.endsWith(ext)) out.push(path)
  }
  return out
}

/** True when the lines above `i` (skipping attributes and blank-free decorators) are a doc comment. */
function documented(lines, i, isDoc, isAttribute) {
  let j = i - 1
  while (j >= 0 && isAttribute(lines[j].trim())) j--
  return j >= 0 && isDoc(lines[j].trim())
}

function check(path, { header, item, isDoc, isAttribute, skipFrom }) {
  const lines = readFileSync(path, 'utf8').split('\n')
  const rel = relative(root, path)
  const first = lines.find((l) => l.trim() !== '') ?? ''
  if (!header(first.trim())) problems.push(`${rel}:1  no header comment that says what this file is for`)
  for (let i = 0; i < lines.length; i++) {
    if (skipFrom?.(lines, i)) break
    const m = item.exec(lines[i])
    if (m && !documented(lines, i, isDoc, isAttribute)) problems.push(`${rel}:${i + 1}  no doc comment on ${m[1]}`)
  }
}

for (const path of files(join(root, 'src'), '.ts')) {
  check(path, {
    header: (l) => l.startsWith('//') || l.startsWith('/*'),
    item: /^export (?:async )?(?:default )?(?:function|class|const|let|interface|type|enum) (\w+)/,
    isDoc: (l) => l.startsWith('//') || l.endsWith('*/'),
    isAttribute: (l) => l.startsWith('@'),
  })
}

for (const path of files(join(root, 'src-tauri', 'src'), '.rs')) {
  check(path, {
    header: (l) => l.startsWith('//!'),
    item: /^\s*pub(?:\([\w:]+\))? (?:async |unsafe |const )*(?:fn|struct|enum|trait|type|const|static|mod) (\w+)/,
    isDoc: (l) => l.startsWith('///') || l.startsWith('//'),
    isAttribute: (l) => l.startsWith('#['),
    // Test modules sit at the end of a file; their helpers need no docs. Only `mod tests`
    // counts: lib.rs also has a test-only `mod testutil;` near its top.
    skipFrom: (lines, i) => lines[i].trim() === '#[cfg(test)]' && /^\s*mod tests\b/.test(lines[i + 1] ?? ''),
  })
}

if (problems.length > 0) {
  console.error(`Documentation check: ${problems.length} problem(s)\n` + problems.join('\n'))
  process.exit(1)
}
console.log('Documentation check: every file and public item is described.')
