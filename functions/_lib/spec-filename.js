/** 标准编号：GB/T 50265-2010、SL274-2020、DL/T 5129—2013、T/CHES 12-2019 等 */
const SPEC_CODE_RE = /([A-Za-z]{1,4}\s*\/?\s*[A-Za-z]{0,4}\s*\d+(?:\.\d+)?\s*[-—–－]\s*\d{2,4})/;

/** 文件名里表示「还没正式发布」的词 */
const SPEC_DRAFT_MARKERS = ['报批稿', '送审稿', '征求意见稿', '征求意见', '草案', '初稿', '草稿', '预审稿'];

/** 编号前缀的常见简写纠正：SLT -> SL/T、GBT -> GB/T */
const SPEC_PREFIX_FIX = {
  SLT: 'SL/T',
  GBT: 'GB/T',
  DLT: 'DL/T',
  CJT: 'CJ/T',
  JGT: 'JG/T',
  JTT: 'JT/T',
  TCHES: 'T/CHES',
};

/** 把编号统一成「GB/T 50265-2010」这种形式 */
export function cleanSpecCode(raw) {
  let s = String(raw).replace(/[—–－]/g, '-');
  s = s.replace(/\s*\/\s*/g, '/');      // GB / T -> GB/T
  s = s.replace(/\s*-\s*/g, '-');       // 50265 - 2010 -> 50265-2010
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/([A-Za-z\/])(\d)/g, '$1 $2'); // SL274 -> SL 274
  s = s.toUpperCase().trim();

  // SLT 618-2021 -> SL/T 618-2021
  const head = s.match(/^([A-Z]{2,6})\s+(\d)/);
  if (head && SPEC_PREFIX_FIX[head[1]]) {
    s = SPEC_PREFIX_FIX[head[1]] + ' ' + s.slice(head[1].length).trim();
  }
  return s;
}

/** 去掉书名号、括号、扩展名等干扰字符，并把全角符号转成半角 */
function cleanSpecName(raw) {
  return String(raw)
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[《》〈〉【】\[\]（）()「」]/g, ' ')
    .replace(/([A-Za-z])_([A-Za-z])/g, '$1/$2') // GB_T -> GB/T
    .replace(/／/g, '/')
    .replace(/：/g, ':')
    .replace(/[\s\u3000]+/g, ' ')
    .trim();
}

/** 文件名里带「报批稿/送审稿」的，状态先记成「征求意见」 */
function detectSpecStatus(text) {
  return SPEC_DRAFT_MARKERS.some((word) => text.includes(word)) ? 'draft' : 'active';
}

/** 去掉「21版」「2021年版」「报批稿」这类不影响名称的噪声 */
function stripSpecNoise(text) {
  let s = text;
  for (const word of SPEC_DRAFT_MARKERS) s = s.split(word).join(' ');
  s = s.replace(/(19|20)\d{2}\s*年版?/g, ' ');   // 2021年版
  s = s.replace(/[（(]?\s*\d{2,4}\s*版\s*[)）]?/g, ' '); // 21版 / （第三版）
  s = s.replace(/\b(PDF|WORD|DOCX?|扫描版|文字版|高清版|完整版)\b/gi, ' ');
  // 注意：这里只压空白和中文分隔符，不能动 - 和 _，否则会把编号拆坏
  return s.replace(/[\s:：、]+/g, ' ').trim();
}

/**
 * 从文件名里猜出编号、名称和状态，尽量兼容常见的几种命名方式：
 *   「SL 274-2020 碾压式土石坝设计规范.pdf」
 *   「GB50201-2014防洪标准.pdf」
 *   「堤防工程地质勘察规程（SL 188-2005）.pdf」
 *   「《水利水电工程可行性研究报告编制规程》（SLT 618—2021)21版报批稿.pdf」
 */
export function parseSpecFilename(filename) {
  const original = cleanSpecName(filename);
  if (!original) return { code: '', title: '', status: 'active' };

  const status = detectSpecStatus(original);
  const base = stripSpecNoise(original);
  if (!base) return { code: '', title: original, status };

  const CODE = String.raw`[A-Za-z]{1,4}\s*\/?\s*[A-Za-z]{0,4}\s*\d+(?:\.\d+)?\s*[-—–－]\s*\d{2,4}`;

  // 1. 编号在最前面（可能带名称，也可能只有编号）
  let matched = base.match(new RegExp(`^(${CODE})(?:[\\s_\\-—–、:：]+(.*))?$`));
  if (matched) {
    const code = cleanSpecCode(matched[1]);
    const title = (matched[2] || '').trim();
    return { code, title: title || code, status };
  }

  // 2. 编号在最后面
  matched = base.match(new RegExp(`^(.+?)[\\s_\\-—–]*(${CODE})$`));
  if (matched && matched[1].trim()) {
    return { code: cleanSpecCode(matched[2]), title: matched[1].trim(), status };
  }

  // 3. 编号夹在中间：把编号摘掉，剩下的当名称
  const anywhere = base.match(SPEC_CODE_RE);
  if (anywhere) {
    const code = cleanSpecCode(anywhere[1]);
    const title = base.replace(SPEC_CODE_RE, ' ').replace(/[\s_\-—–、:：]+/g, ' ').trim();
    return { code, title: title || code, status };
  }

  return { code: '', title: base, status };
}
