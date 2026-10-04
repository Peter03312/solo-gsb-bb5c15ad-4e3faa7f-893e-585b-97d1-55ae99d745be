import { ApiError, sha256 } from './util.js';

// 条款编号：支持 1 / 1.2 / 1.2.3 / 第3条 / 第3.1条（含全角数字、点、顿号）
const NUM = `[0-9０-９]+(?:[.．、][0-9０-９]+)*`;
const HEADING_RE = new RegExp(`^(#{1,6})\\s*第?\\s*(${NUM})\\s*条?[：:、.．\\u3000]?\\s*(.*)$`);
const NUM_TOKEN_RE = new RegExp(NUM);

// 引用形式：§1.2、[§1.2]、第 1.2 条
const REF_RE = new RegExp(`(?:§\\s*)(${NUM})|第\\s*(${NUM})\\s*条`, 'g');

function normalizeNum(raw) {
  return String(raw)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．、]/g, '.');
}

function hashOf(heading, body) {
  return sha256(`${heading.trim()}\n\n${body.trim()}`);
}

/**
 * 解析带唯一条款编号的 Markdown：
 *   # 文档标题（可选，首个非编号标题）
 *   ## 1 范围
 *   正文……
 * 编号条款之前的非空内容归为第 0 条「前言」。
 * 重复编号直接抛 400 DUP_NUMBER。
 */
export function parseMarkdown(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const clauses = [];
  const seen = new Set();
  let title = '';
  let preamble = [];
  let current = null;
  let inFence = false;

  const pushPreamble = () => {
    const text = preamble.join('\n').trim();
    if (text) {
      clauses.push({ num: '0', heading: '前言', body: text, contentHash: hashOf('前言', text) });
    }
    preamble = [];
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence ? line.match(HEADING_RE) : null;

    if (m) {
      pushPreamble();
      const num = normalizeNum(m[2]);
      if (seen.has(num)) {
        throw new ApiError(400, 'DUP_NUMBER', `条款编号重复：${num}`, { num });
      }
      seen.add(num);
      current = { num, heading: m[3].trim(), bodyLines: [] };
      clauses.push(current);
    } else if (current) {
      current.bodyLines.push(line);
    } else {
      const titleM = !inFence ? line.match(/^#{1,6}\s+(.+?)\s*$/) : null;
      if (titleM && !title && preamble.every((l) => !l.trim())) {
        title = titleM[1].trim();
      } else {
        preamble.push(line);
      }
    }
  }
  pushPreamble();

  if (!clauses.length) {
    throw new ApiError(
      400,
      'NO_CLAUSES',
      '未解析到任何带编号的条款，请使用如「## 1 标题」的 Markdown 标题。'
    );
  }

  const result = clauses.map((c, i) => {
    const body = (c.bodyLines ? c.bodyLines.join('\n') : c.body || '').trim();
    return {
      num: c.num,
      heading: c.heading || '',
      body,
      contentHash: c.contentHash || hashOf(c.heading || '', body),
    };
  });

  // 前言放到最前（解析顺序天然如此），编号重复再次校验
  const nums = new Set();
  for (const c of result) {
    if (nums.has(c.num)) throw new ApiError(400, 'DUP_NUMBER', `条款编号重复：${c.num}`, { num: c.num });
    nums.add(c.num);
    if (!c.body.trim()) {
      throw new ApiError(400, 'EMPTY_CLAUSE', `条款 ${c.num} 正文不能为空。`, { num: c.num });
    }
  }

  return { title: title || '未命名规程', clauses: result };
}

/** 提取正文中对其他条款的引用（§x.y / 第x.y条），忽略代码块与行内代码 */
export function extractReferences(md) {
  const text = String(md || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~?/g, '')
    .replace(/`[^`\n]*`/g, '');
  const refs = new Set();
  let m;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(text))) {
    const raw = m[1] || m[2];
    if (raw) refs.add(normalizeNum(raw));
  }
  return [...refs];
}

export function clauseHref(num) {
  return `clause-${num.replace(/\./g, '-')}`;
}

export function isValidNum(num) {
  return NUM_TOKEN_RE.test(String(num).trim());
}

export { normalizeNum };
