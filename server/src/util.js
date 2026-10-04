import { createHash } from 'node:crypto';

/**
 * 条款 Markdown 约定：
 *   # 3.2.1 标题        —— ATX 标题行，行首第一个“编号词”为唯一条款编号
 *   正文直至下一个标题
 * 围栏代码块内的 # 不视为标题。
 */

const NUM_TOKEN = /[0-9０-９A-Za-z][0-9０-９A-Za-z.．、-]*[0-9０-９A-Za-z）)]?/;
const HEADING_RE = /^(#{1,6})\s+(\S.*?)\s*$/;

export function normalizeNum(raw) {
  return String(raw)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/、/g, '.')
    .trim();
}

/**
 * 解析带条款编号的 Markdown。
 * 成功返回 { clauses: [{num,title,body}], references:[{num,clauseNum,raw}...] }
 * 失败返回 { errors: string[] }，调用方必须拒绝提交。
 */
export function parseClauses(markdown) {
  const text = String(markdown ?? '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const errors = [];
  const clauses = [];
  let fence = null;
  let current = null;
  let bodyBuf = [];
  let preamble = [];

  const flush = () => {
    if (!current) return;
    current.body = bodyBuf.join('\n').replace(/^\n+|\s+$/g, '');
    clauses.push(current);
    bodyBuf = [];
  };

  for (const line of lines) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (line.trimStart().startsWith(fence)) fence = null;
      if (current) bodyBuf.push(line);
      continue;
    }
    const hm = !fence && HEADING_RE.exec(line);
    if (hm) {
      flush();
      const titleText = hm[2];
      const numMatch = NUM_TOKEN.exec(titleText);
      if (!numMatch) {
        errors.push(`标题缺少条款编号：${line.trim()}`);
        current = { num: '', title: titleText, body: '' };
        bodyBuf = [];
        continue;
      }
      const num = normalizeNum(numMatch[0]);
      const title = titleText.slice(numMatch.index + numMatch[0].length).trim();
      current = { num, title, body: '' };
      bodyBuf = [];
    } else if (current) {
      bodyBuf.push(line);
    } else if (line.trim()) {
      preamble.push(line.trim());
    }
  }
  flush();

  if (preamble.length) {
    errors.push(`首个条款标题之前存在非空白内容：“${preamble[0].slice(0, 40)}…”，规程必须以条款标题开头`);
  }
  if (clauses.length === 0) errors.push('未解析到任何条款（缺少形如 “# 3.1 标题” 的条款标题）');

  const seen = new Map();
  for (const c of clauses) {
    if (!c.num) continue;
    if (seen.has(c.num)) errors.push(`条款编号重复：${c.num}`);
    seen.set(c.num, (seen.get(c.num) || 0) + 1);
  }

  if (errors.length) return { errors, clauses };

  const references = [];
  for (const c of clauses) {
    for (const ref of extractReferences(`${c.title}\n${c.body}`)) {
      references.push({ clauseNum: c.num, ...ref });
    }
  }
  return { clauses, references, errors: [] };
}

/**
 * 条款引用语法：#编号 或 〔编号〕，例如 #3.2.1、〔A.1〕。
 * # 号必须紧跟编号字符，避免误伤 Markdown 标题。
 */
export function extractReferences(text) {
  const out = [];
  const stripped = stripCode(text);
  const re1 = /#([0-9０-９A-Za-z][0-9０-９A-Za-z.．、-]{0,40})/g;
  let m;
  while ((m = re1.exec(stripped))) out.push({ num: normalizeNum(m[1]), raw: m[0] });
  const re2 = /〔([^〕\n]{1,40})〕/g;
  while ((m = re2.exec(stripped))) out.push({ num: normalizeNum(m[1]), raw: m[0] });
  return out;
}

export function stripCode(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/(^|[^`])`[^`\n]+`/g, '$1 ');
}

/* ---------------- 内容指纹与片段定位 ---------------- */

// 内容指纹只覆盖标题与正文，不含编号：
// 换编号/换序但文字未变 => 内容未变（unchanged），编号变化通过沿革边 fromNum->toNum 记录。
export function contentHash(title, body) {
  return createHash('sha256').update(`${title} ${body}`).digest('hex');
}

export function mdToPlain(markdown) {
  return stripCode(String(markdown ?? ''))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-+*]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/(\*\*|__|~~|\|\s?)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normWhitespace(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** 原文片段在条款纯文本中出现次数（大小写、空白不敏感，非重叠计数）。1 表示可唯一锚定。 */
export function quoteOccurrences(clauseTitle, clauseBody, quote) {
  const haystack = normWhitespace(mdToPlain(`${clauseTitle}\n${clauseBody}`)).toLowerCase();
  const needle = normWhitespace(mdToPlain(quote)).toLowerCase();
  if (!needle) return 0;
  let count = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    count++;
    i += needle.length;
  }
  return count;
}
