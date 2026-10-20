// 密码学工具：全部使用浏览器/Workers 内置的 Web Crypto，无需任何第三方库
const enc = new TextEncoder();

export const DEFAULT_ITERATIONS = 100000;

export function bytesToHex(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 生成加密安全的随机十六进制串 */
export function randomHex(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToHex(bytes);
}

/** SHA-256，返回十六进制字符串 */
export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

/** PBKDF2-SHA256 派生密钥 */
export async function pbkdf2Hex(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations, hash: 'SHA-256' },
    key,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

/** 恒定时间比较，避免通过响应时间猜测密码 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 注册时用：生成盐 + 哈希 */
export async function hashPassword(password, iterations = DEFAULT_ITERATIONS) {
  const salt = randomHex(16);
  const hash = await pbkdf2Hex(password, salt, iterations);
  return { hash, salt, iterations };
}

/** 登录时用：用用户自己的盐和迭代次数重新算一遍再比对 */
export async function verifyPassword(password, user) {
  if (!user || !user.password_hash || !user.salt) return false;
  const iterations = Number(user.iterations) || DEFAULT_ITERATIONS;
  const hash = await pbkdf2Hex(password, user.salt, iterations);
  return timingSafeEqual(hash, user.password_hash);
}
