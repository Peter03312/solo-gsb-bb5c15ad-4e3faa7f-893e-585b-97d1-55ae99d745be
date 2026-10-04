const TOKEN_KEY = 'collation_token';
const USER_KEY = 'collation_user';

export const auth = {
  get token() {
    return localStorage.getItem(TOKEN_KEY);
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  },
  save(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export class ApiError extends Error {
  constructor(payload, status) {
    super(payload?.error?.message || `请求失败（HTTP ${status}）`);
    this.code = payload?.error?.code;
    this.detail = payload?.error;
    this.status = status;
  }
}

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  const res = await fetch(`/api${path}`, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* 空响应 */
  }
  if (!res.ok) throw new ApiError(payload, res.status);
  return payload;
}

export const RELATION_LABELS = {
  added: '新增',
  deleted: '删除',
  unchanged: '内容未变（沿用定位）',
  modified: '内容修改',
  split: '拆分',
  merged: '合并',
};

/** 把版本中的条款快照序列化为可编辑的 Markdown。 */
export function versionToMarkdown(clauses) {
  return clauses.map((c) => `# ${c.num} ${c.title}\n\n${c.body}`.trim()).join('\n\n');
}

/** 客户端粗略解析新 Markdown 的条款标题（仅用于来源映射 UI）。 */
export function parseNums(markdown) {
  const nums = [];
  const re = /^#{1,6}\s+(\S+)/gm;
  let m;
  while ((m = re.exec(markdown))) {
    const token = m[1].replace(/[．。]/g, '.').replace(/、/g, '.');
    nums.push(token);
  }
  return nums;
}
