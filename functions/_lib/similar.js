// 规范相似度判断：编号 + 名称，用于上传时的重复提醒
// 输出 0~1 的分数和一句人话原因，分数越高越像

// 相似度阈值：低于这个分数就不打扰。0.7 = 比较严格；觉得弹得太频繁可调到 0.75
export const SIMILAR_THRESHOLD = 0.7;

/** 编号归一化：去掉空格、斜杠、横线，统一大写 —— SL/T 274-2020 -> SLT2742020 */
export function normalizeCode(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[\s\-—–－\/／　]/g, '');
}

/** 编号主体：去掉年份，只留 字母+序号 —— SL 274-2020 -> SL274 */
export function codeStem(code) {
  const normalized = normalizeCode(code);
  const matched = normalized.match(/^([A-Z]+)(\d+)/);
  if (!matched) return normalized;
  let digits = matched[2];
  // 去掉结尾的年份（4 位，或 2 位简写），剩下的才是标准序号
  if (digits.length > 4) digits = digits.slice(0, -4);
  return matched[1] + digits;
}

/** 名称归一化：去掉标点、《》、括号、空格、年号，转小写 */
export function normalizeTitle(title) {
  return String(title || '')
    .replace(/[《》〈〉【】\[\]（）()「」\s\u3000、，,。.·\-—–_：:；;]/g, '')
    .replace(/(19|20)\d{2}\s*年版?/g, '')
    .toLowerCase();
}

/** 二元组 Dice 相似度，适合中文短标题 */
export function diceSimilarity(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (!x || !y) return 0;
  if (x === y) return 1;

  const grams = (s) => {
    const map = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      map.set(g, (map.get(g) || 0) + 1);
    }
    return map;
  };

  const ga = grams(x);
  const gb = grams(y);
  let hit = 0;
  let total = 0;

  for (const [g, n] of ga) {
    total += n;
    hit += Math.min(n, gb.get(g) || 0);
  }
  for (const n of gb.values()) total += n;

  return total ? (2 * hit) / total : 0;
}

/**
 * 比较两条规范，返回 { score, reason } 或 null
 * 规则优先级：编号相同 > 编号主体相同 > 名称高度相似 > 名称相似
 */
export function compareSpecs(incoming, existing) {
  const codeA = normalizeCode(incoming.code);
  const codeB = normalizeCode(existing.code);

  if (codeA && codeB && codeA === codeB) {
    return { score: 1, reason: '编号完全相同' };
  }

  if (codeA && codeB && codeStem(incoming.code) === codeStem(existing.code)) {
    return { score: 0.85, reason: '编号主体相同，可能只是版本或年份不同' };
  }

  const similarity = diceSimilarity(
    normalizeTitle(incoming.title),
    normalizeTitle(existing.title)
  );

  if (similarity >= 0.75) {
    return { score: 0.8, reason: `名称高度相似（${Math.round(similarity * 100)}%）` };
  }
  if (similarity >= SIMILAR_THRESHOLD) {
    return { score: similarity, reason: `名称相似（${Math.round(similarity * 100)}%）` };
  }

  return null;
}

/** 在一批已有规范里找最像的一条 */
export function findBestMatch(incoming, existingList, excludeId) {
  let best = null;

  for (const item of existingList || []) {
    if (excludeId && item.id === excludeId) continue;
    const result = compareSpecs(incoming, item);
    if (!result) continue;
    if (!best || result.score > best.score) {
      best = {
        score: result.score,
        reason: result.reason,
        id: item.id,
        code: item.code,
        title: item.title,
        status: item.status,
      };
    }
  }

  return best && best.score >= SIMILAR_THRESHOLD ? best : null;
}
