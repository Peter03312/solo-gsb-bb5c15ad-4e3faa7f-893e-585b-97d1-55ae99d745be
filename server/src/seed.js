import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { db } from './db.js';
import { parseMarkdown, extractReferences } from './markdown.js';

const SAMPLE = `# 示例技术规程

## 1 范围
本规程规定了设备检修的基本要求与作业流程，适用于 §2 所述系统的例行检修。

## 2 系统概述
系统由动力单元、控制单元与安全联锁组成；检修前应确认满足 §3 的全部条件。

## 3 检修前准备
检修前应办理工作票、断电挂牌，并按 §4 的步骤执行。雷雨天气不得进行露天作业。

## 4 检修作业
作业人员应两人以上，先拆除外部连接，再更换易损件；装复后按 §5 验收。

## 5 验收与交付
验收合格后由负责人签核交付；发现不合格项时，按 §3 重新准备并返工。
`;

export function seedIfEmpty() {
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (userCount > 0) return;

  const mkUser = (username, displayName) => {
    const id = nanoid(12);
    db.prepare('INSERT INTO users (id,username,display_name,password_hash) VALUES (?,?,?,?)').run(
      id, username, displayName, bcrypt.hashSync('demo1234', 10)
    );
    return id;
  };
  const zhang = mkUser('zhangsan', '张三');
  const li = mkUser('lisi', '李四');

  const docCount = db.prepare('SELECT COUNT(*) AS n FROM documents').get().n;
  if (docCount > 0) return;

  const parsed = parseMarkdown(SAMPLE);
  const nums = new Set(parsed.clauses.map((c) => c.num));
  for (const c of parsed.clauses) {
    for (const ref of extractReferences(`${c.heading}\n${c.body}`)) {
      if (!nums.has(ref)) throw new Error(`示例数据引用错误：§${ref}`);
    }
  }

  const docId = nanoid(12);
  const verId = nanoid(14);
  db.prepare('INSERT INTO documents (id,title,current_no,created_by) VALUES (?,?,0,?)').run(
    docId, parsed.title, zhang
  );
  db.prepare('INSERT INTO versions (id,document_id,version_no,note,created_by) VALUES (?,?,0,?,?)').run(
    verId, docId, '初始导入', zhang
  );
  const clauseIds = [];
  const ins = db.prepare(
    'INSERT INTO clauses (id,document_id,version_id,ord,num,heading,body,content_hash) VALUES (?,?,?,?,?,?,?,?)'
  );
  parsed.clauses.forEach((c, i) => {
    const id = nanoid(14);
    clauseIds.push(id);
    ins.run(id, docId, verId, i, c.num, c.heading, c.body, c.contentHash);
  });

  // 一条示例批注（锚定第 3 条片段）
  const c3 = db.prepare('SELECT * FROM clauses WHERE version_id=? AND num=?').get(verId, '3');
  const annId = nanoid(14);
  db.prepare(
    'INSERT INTO annotations (id,document_id,author_id,anchor_num,anchor_quote,body) VALUES (?,?,?,?,?,?)'
  ).run(annId, docId, li, '3', '雷雨天气不得进行露天作业。', '建议补充高温天气的作业限制。');
  db.prepare(
    'INSERT INTO annotation_placed (id,annotation_id,version_id,clause_id,clause_num,status) VALUES (?,?,?,?,?,?)'
  ).run(nanoid(14), annId, verId, c3.id, '3', 'anchored');

  // 张三对第 1、2 条签核
  const insSign = db.prepare(
    'INSERT INTO signoffs (id,document_id,version_id,clause_id,clause_num,user_id) VALUES (?,?,?,?,?,?)'
  );
  for (const num of ['1', '2']) {
    const c = db.prepare('SELECT id FROM clauses WHERE version_id=? AND num=?').get(verId, num);
    insSign.run(nanoid(14), docId, verId, c.id, num, zhang);
  }

  console.log('已初始化演示数据：账号 zhangsan / lisi，密码 demo1234');
}
