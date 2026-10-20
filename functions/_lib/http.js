// HTTP 通用工具：JSON 响应、Cookie、会话读取、权限校验
import { sha256Hex } from './crypto.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const nowSec = () => Math.floor(Date.now() / 1000);

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function redirect(location, status = 302) {
  return new Response(null, { status, headers: { Location: location } });
}

export async function readJson(request) {
  const raw = await request.text();
  if (!raw) return {};
  if (raw.length > 200_000) throw new ApiError(413, '提交的内容太大了');
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, '请求格式不正确');
  }
}

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const out = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

function serializeCookie(name, value, { maxAge, path = '/', httpOnly = true, secure = true, sameSite = 'Lax' } = {}) {
  let cookie = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (httpOnly) cookie += '; HttpOnly';
  if (secure) cookie += '; Secure';
  if (typeof maxAge === 'number') cookie += `; Max-Age=${maxAge}`;
  return cookie;
}

export function sessionCookie(request, token, maxAge) {
  // 本地用 http://localhost 调试时不加 Secure，否则浏览器不会保存
  const secure = new URL(request.url).protocol === 'https:';
  return serializeCookie('sid', token, { maxAge, secure });
}

export function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === 'https:';
  return serializeCookie('sid', '', { maxAge: 0, secure });
}

/** 根据 Cookie 里的 token 找回登录用户；无效/过期/被停用都返回 null */
export async function getSessionUser(env, request) {
  const token = parseCookies(request).sid;
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const user = await env.DB.prepare(
    `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`
  )
    .bind(tokenHash, nowSec())
    .first();

  if (!user || user.banned) return null;
  return user;
}

export async function requireUser(env, request) {
  const user = await getSessionUser(env, request);
  if (!user) throw new ApiError(401, '请先登录');
  return user;
}

export async function requireAdmin(env, request) {
  const user = await requireUser(env, request);
  if (user.role !== 'admin') throw new ApiError(403, '这个操作需要管理员权限');
  return user;
}

/** 返回给前端的安全字段（绝不包含密码哈希、盐、token 等） */
export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    verified: Boolean(user.verified),
    created_at: user.created_at,
  };
}

export function isEmail(value) {
  return (
    typeof value === 'string' &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
  );
}

/** 防 CSRF：跨站发起的写操作一律拒绝 */
export function assertSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return; // 部分同源请求不带 Origin
  const expected = new URL(request.url).origin;
  if (origin !== expected) throw new ApiError(403, '请求来源不合法');
}
