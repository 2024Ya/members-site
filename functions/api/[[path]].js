// 全部后端接口都在这个文件里（Pages Functions）
// 访问路径：/api/xxx
import {
  hashPassword,
  verifyPassword,
  randomHex,
  sha256Hex,
  DEFAULT_ITERATIONS,
} from '../_lib/crypto.js';
import {
  ApiError,
  json,
  redirect,
  readJson,
  nowSec,
  parseCookies,
  sessionCookie,
  clearSessionCookie,
  getSessionUser,
  requireUser,
  requireAdmin,
  publicUser,
  isEmail,
  assertSameOrigin,
} from '../_lib/http.js';

const SESSION_DAYS = 30;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/\/+$/, '') || '/api';

  try {
    if (!env.DB) {
      throw new ApiError(
        500,
        '数据库还没绑定好：请到 Cloudflare 项目设置的 Bindings 里添加一个名为 DB 的 D1 数据库，然后重新部署。'
      );
    }
    if (method !== 'GET' && method !== 'HEAD') assertSameOrigin(request);
    return await route({ request, env, url, method, path });
  } catch (err) {
    if (err instanceof ApiError) return json({ error: err.message }, err.status);
    console.error('[api] 未处理的错误：', (err && err.stack) || err);
    return json({ error: '服务器开小差了，请稍后再试' }, 500);
  }
}

// ---------------------------------------------------------------- 路由表
async function route(ctx) {
  const { method, path } = ctx;

  if (method === 'GET' && path === '/api/health') {
    return json({ ok: true, time: nowSec() });
  }

  // 认证相关
  if (method === 'POST' && path === '/api/auth/register') return register(ctx);
  if (method === 'POST' && path === '/api/auth/login') return login(ctx);
  if (method === 'POST' && path === '/api/auth/logout') return logout(ctx);
  if (method === 'GET' && path === '/api/auth/me') return me(ctx);
  if (method === 'POST' && path === '/api/auth/forgot') return forgotPassword(ctx);
  if (method === 'POST' && path === '/api/auth/reset') return resetPassword(ctx);
  if (method === 'GET' && path === '/api/auth/verify') return verifyEmail(ctx);

  // 会员内容
  if (method === 'GET' && path === '/api/articles') return listArticles(ctx);

  // 管理后台
  if (method === 'GET' && path === '/api/admin/articles') return adminListArticles(ctx);
  if (method === 'POST' && path === '/api/admin/articles') return adminCreateArticle(ctx);
  if (method === 'GET' && path === '/api/admin/users') return adminListUsers(ctx);
  if (method === 'GET' && path === '/api/admin/overview') return adminOverview(ctx);

  const articleId = matchId(path, '/api/articles/');
  if (articleId && method === 'GET') return getArticle(ctx, articleId);

  const adminArticleId = matchId(path, '/api/admin/articles/');
  if (adminArticleId && method === 'PATCH') return adminUpdateArticle(ctx, adminArticleId);
  if (adminArticleId && method === 'DELETE') return adminDeleteArticle(ctx, adminArticleId);

  const adminUserId = matchId(path, '/api/admin/users/');
  if (adminUserId && method === 'PATCH') return adminUpdateUser(ctx, adminUserId);

  throw new ApiError(404, '接口不存在');
}

function matchId(path, prefix) {
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  if (!rest || rest.includes('/')) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(rest)) return null;
  return rest;
}

// ---------------------------------------------------------------- 注册 / 登录
async function register({ request, env, url }) {
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const rawName = String(body.name || '').trim();
  const name = rawName.slice(0, 40) || email.split('@')[0];

  if (!isEmail(email)) throw new ApiError(400, '请输入正确的邮箱地址');
  if (password.length < 8) throw new ApiError(400, '密码至少需要 8 位');
  if (password.length > 128) throw new ApiError(400, '密码太长了，请控制在 128 位以内');

  // 同一个 IP 每小时最多注册 10 个账号，防止被人刷爆免费额度
  await assertNotTooFast(env, request, 'register', 10, 3600);

  const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (exists) throw new ApiError(409, '这个邮箱已经注册过了，可以直接登录');

  const iterations = Number(env.PBKDF2_ITERATIONS) || DEFAULT_ITERATIONS;
  const { hash, salt, iterations: used } = await hashPassword(password, iterations);

  const adminEmail = String(env.ADMIN_EMAIL || '').trim().toLowerCase();
  const role = adminEmail && email === adminEmail ? 'admin' : 'user';

  // 只有「要求验证」并且「真的配好了发信服务」时才需要验证邮箱，
  // 否则新人注册完立刻就能用，避免卡在收不到邮件上。
  const mustVerify = env.REQUIRE_VERIFY === '1' && Boolean(env.RESEND_API_KEY);
  const verifyToken = randomHex(24);
  const now = nowSec();
  const id = crypto.randomUUID();

  try {
    await env.DB.prepare(
      `INSERT INTO users
         (id, email, name, password_hash, salt, iterations, role, verified,
          verify_token, verify_expires, failed_attempts, banned, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`
    )
      .bind(
        id,
        email,
        name,
        hash,
        salt,
        used,
        role,
        mustVerify ? 0 : 1,
        verifyToken,
        now + 86400,
        now
      )
      .run();
  } catch (err) {
    if (String(err && err.message).includes('UNIQUE')) {
      throw new ApiError(409, '这个邮箱已经注册过了，可以直接登录');
    }
    throw err;
  }

  if (mustVerify) {
    const link = `${url.origin}/api/auth/verify?token=${verifyToken}`;
    await sendMail(env, {
      to: email,
      subject: '请验证你的邮箱',
      html: `<p>你好 ${escapeHtml(name)}：</p><p>点击下面的链接完成验证，24 小时内有效：</p><p><a href="${link}">${link}</a></p>`,
    });
  }

  const token = await createSession(env, id);
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();

  return json(
    {
      user: publicUser(user),
      message: mustVerify ? '注册成功，请到邮箱里点验证链接' : '注册成功',
    },
    201,
    { 'Set-Cookie': sessionCookie(request, token, SESSION_DAYS * 86400) }
  );
}

async function login({ request, env }) {
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!isEmail(email) || !password) throw new ApiError(400, '请输入邮箱和密码');

  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user) throw new ApiError(401, '邮箱或密码不正确');

  const now = nowSec();
  if (user.locked_until && user.locked_until > now) {
    const minutes = Math.ceil((user.locked_until - now) / 60);
    throw new ApiError(429, `密码错误次数太多，请 ${minutes} 分钟后再试`);
  }
  if (user.banned) throw new ApiError(403, '这个账号已被停用，请联系管理员');

  const ok = await verifyPassword(password, user);
  if (!ok) {
    const attempts = Number(user.failed_attempts || 0) + 1;
    if (attempts >= MAX_FAILED) {
      await env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?')
        .bind(now + LOCK_MINUTES * 60, user.id)
        .run();
      throw new ApiError(429, `密码错误次数太多，请 ${LOCK_MINUTES} 分钟后再试`);
    }
    await env.DB.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?')
      .bind(attempts, user.id)
      .run();
    throw new ApiError(401, `邮箱或密码不正确（还可以再试 ${MAX_FAILED - attempts} 次）`);
  }

  if (env.REQUIRE_VERIFY === '1' && !user.verified) {
    throw new ApiError(403, '请先到邮箱里点击验证链接，再回来登录');
  }

  if (user.locked_until) {
    await env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?')
      .bind(user.id)
      .run();
  }

  // 如果这个邮箱后来被设成管理员邮箱，登录时自动升级，避免被卡在后台门外
  const adminEmail = String(env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (adminEmail && email === adminEmail && user.role !== 'admin') {
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(user.id).run();
    user.role = 'admin';
  }

  const token = await createSession(env, user.id);
  return json({ user: publicUser(user) }, 200, {
    'Set-Cookie': sessionCookie(request, token, SESSION_DAYS * 86400),
  });
}

async function logout({ request, env }) {
  const token = parseCookies(request).sid;
  if (token) {
    const tokenHash = await sha256Hex(token);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(request) });
}

async function me({ request, env }) {
  const user = await getSessionUser(env, request);
  return json({ user: user ? publicUser(user) : null });
}

async function verifyEmail({ request, env, url }) {
  const token = url.searchParams.get('token') || '';
  if (!token) throw new ApiError(400, '验证链接不完整');

  const user = await env.DB.prepare('SELECT * FROM users WHERE verify_token = ?').bind(token).first();
  if (!user) throw new ApiError(400, '验证链接无效，可能已经用过了');
  if (user.verify_expires && user.verify_expires < nowSec()) {
    throw new ApiError(400, '验证链接已过期，请重新登录后在个人中心重新发送');
  }

  await env.DB.prepare('UPDATE users SET verified = 1, verify_token = NULL, verify_expires = NULL WHERE id = ?')
    .bind(user.id)
    .run();

  return redirect('/login?verified=1');
}

async function forgotPassword({ request, env, url }) {
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  if (!isEmail(email)) throw new ApiError(400, '请输入正确的邮箱地址');

  await assertNotTooFast(env, request, 'forgot', 5, 3600);

  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();

  // 无论邮箱是否存在都返回同一句话，避免被人用来探测谁注册过
  const answer = { ok: true, message: '如果这个邮箱注册过，我们已发送重置链接，请查收邮件' };
  if (!user) return json(answer);
  if (!env.RESEND_API_KEY) {
    return json({
      ok: false,
      error: '站点还没有开通邮件功能，请联系管理员帮你重置密码',
    }, 503);
  }

  const token = randomHex(24);
  await env.DB.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?')
    .bind(token, nowSec() + 3600, user.id)
    .run();

  const link = `${url.origin}/reset?token=${token}`;
  await sendMail(env, {
    to: email,
    subject: '重置你的密码',
    html: `<p>你好 ${escapeHtml(user.name || '')}：</p><p>点击下面的链接设置新密码，1 小时内有效：</p><p><a href="${link}">${link}</a></p><p>如果不是你本人操作，忽略这封邮件即可。</p>`,
  });

  return json(answer);
}

async function resetPassword({ request, env }) {
  const body = await readJson(request);
  const token = String(body.token || '');
  const password = String(body.password || '');
  if (!token) throw new ApiError(400, '重置链接不完整');
  if (password.length < 8) throw new ApiError(400, '密码至少需要 8 位');
  if (password.length > 128) throw new ApiError(400, '密码太长了');

  const user = await env.DB.prepare('SELECT * FROM users WHERE reset_token = ?').bind(token).first();
  if (!user) throw new ApiError(400, '重置链接无效，可能已经用过了');
  if (user.reset_expires && user.reset_expires < nowSec()) {
    throw new ApiError(400, '重置链接已过期，请重新申请');
  }

  const iterations = Number(env.PBKDF2_ITERATIONS) || DEFAULT_ITERATIONS;
  const { hash, salt, iterations: used } = await hashPassword(password, iterations);

  await env.DB.prepare(
    `UPDATE users
        SET password_hash = ?, salt = ?, iterations = ?,
            reset_token = NULL, reset_expires = NULL,
            failed_attempts = 0, locked_until = NULL
      WHERE id = ?`
  )
    .bind(hash, salt, used, user.id)
    .run();

  // 密码改了，之前所有设备上的登录状态全部作废
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();

  return json({ ok: true, message: '密码已更新，请用新密码登录' });
}

// ---------------------------------------------------------------- 会员内容
async function listArticles({ request, env }) {
  await requireUser(env, request);
  const { results } = await env.DB.prepare(
    `SELECT id, title, summary, created_at, updated_at
       FROM articles
      WHERE published = 1
      ORDER BY created_at DESC
      LIMIT 200`
  ).all();
  return json({ articles: results || [] });
}

async function getArticle({ request, env }, id) {
  const user = await requireUser(env, request);
  const article = await env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(id).first();
  if (!article) throw new ApiError(404, '文章不存在或已被删除');
  if (!article.published && user.role !== 'admin') {
    throw new ApiError(404, '文章不存在或已被删除');
  }
  return json({ article });
}

// ---------------------------------------------------------------- 管理后台
async function adminOverview({ request, env }) {
  await requireAdmin(env, request);
  const users = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  const articles = await env.DB.prepare('SELECT COUNT(*) AS n FROM articles').first();
  const published = await env.DB.prepare('SELECT COUNT(*) AS n FROM articles WHERE published = 1').first();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at > ?')
    .bind(nowSec() - 7 * 86400)
    .first();
  return json({
    users: users ? users.n : 0,
    articles: articles ? articles.n : 0,
    published: published ? published.n : 0,
    newUsers7d: recent ? recent.n : 0,
  });
}

async function adminListArticles({ request, env }) {
  await requireAdmin(env, request);
  const { results } = await env.DB.prepare(
    `SELECT id, title, summary, published, created_at, updated_at
       FROM articles
      ORDER BY created_at DESC
      LIMIT 500`
  ).all();
  return json({ articles: results || [] });
}

async function adminCreateArticle({ request, env }) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request);
  const data = validateArticle(body, true);

  const id = crypto.randomUUID();
  const now = nowSec();
  await env.DB.prepare(
    `INSERT INTO articles (id, title, summary, content, published, author_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, data.title, data.summary, data.content, data.published, admin.id, now, now)
    .run();

  return json({ ok: true, id }, 201);
}

async function adminUpdateArticle({ request, env }, id) {
  await requireAdmin(env, request);
  const body = await readJson(request);

  const existing = await env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(id).first();
  if (!existing) throw new ApiError(404, '文章不存在');

  const data = validateArticle(body, false, existing);

  await env.DB.prepare(
    `UPDATE articles
        SET title = ?, summary = ?, content = ?, published = ?, updated_at = ?
      WHERE id = ?`
  )
    .bind(data.title, data.summary, data.content, data.published, nowSec(), id)
    .run();

  return json({ ok: true });
}

async function adminDeleteArticle({ request, env }, id) {
  await requireAdmin(env, request);
  await env.DB.prepare('DELETE FROM articles WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

function validateArticle(body, requireTitle, existing) {
  const pick = (key) => (body[key] === undefined ? undefined : body[key]);

  let title = pick('title');
  let summary = pick('summary');
  let content = pick('content');
  let published = pick('published');

  if (title === undefined && existing) title = existing.title;
  if (summary === undefined && existing) summary = existing.summary;
  if (content === undefined && existing) content = existing.content;
  if (published === undefined && existing) published = existing.published;

  title = String(title || '').trim();
  summary = String(summary || '').trim();
  content = String(content || '');

  if (requireTitle && !title) throw new ApiError(400, '标题不能为空');
  if (title.length > 120) throw new ApiError(400, '标题最多 120 个字');
  if (summary.length > 300) throw new ApiError(400, '摘要最多 300 个字');
  if (content.length > 200_000) throw new ApiError(400, '正文太长了（上限约 20 万字符）');

  return { title, summary, content, published: published ? 1 : 0 };
}

async function adminListUsers({ request, env }) {
  await requireAdmin(env, request);
  const { results } = await env.DB.prepare(
    `SELECT id, email, name, role, verified, banned, created_at
       FROM users
      ORDER BY created_at DESC
      LIMIT 500`
  ).all();
  return json({ users: results || [] });
}

async function adminUpdateUser({ request, env }, id) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request);

  const target = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!target) throw new ApiError(404, '用户不存在');

  const isSelf = target.id === admin.id;

  if (body.banned !== undefined) {
    if (isSelf) throw new ApiError(400, '不能停用自己的账号');
    await env.DB.prepare('UPDATE users SET banned = ? WHERE id = ?')
      .bind(body.banned ? 1 : 0, id)
      .run();
    if (body.banned) {
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
    }
  }

  if (body.role !== undefined) {
    if (isSelf) throw new ApiError(400, '不能修改自己的角色');
    const role = body.role === 'admin' ? 'admin' : 'user';
    await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, id).run();
  }

  if (body.verified !== undefined) {
    await env.DB.prepare('UPDATE users SET verified = ? WHERE id = ?')
      .bind(body.verified ? 1 : 0, id)
      .run();
  }

  if (body.newPassword !== undefined) {
    const password = String(body.newPassword || '');
    if (password.length < 8) throw new ApiError(400, '新密码至少 8 位');
    const iterations = Number(env.PBKDF2_ITERATIONS) || DEFAULT_ITERATIONS;
    const { hash, salt, iterations: used } = await hashPassword(password, iterations);
    await env.DB.prepare(
      `UPDATE users
          SET password_hash = ?, salt = ?, iterations = ?,
              failed_attempts = 0, locked_until = NULL
        WHERE id = ?`
    )
      .bind(hash, salt, used, id)
      .run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  }

  const updated = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  return json({ user: publicUser(updated) });
}

// ---------------------------------------------------------------- 工具
function clientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For') ||
    'unknown'
  );
}

/** 同一 IP 在时间窗口内最多操作 N 次，超出抛 429 */
async function assertNotTooFast(env, request, scope, limit, windowSec) {
  const key = `${scope}:${clientIp(request)}`;
  const now = nowSec();

  // 顺手清理过期计数，表不会越积越大
  await env.DB.prepare('DELETE FROM throttle WHERE reset_at < ?').bind(now).run();

  const row = await env.DB.prepare('SELECT count, reset_at FROM throttle WHERE key = ?')
    .bind(key)
    .first();

  if (!row) {
    await env.DB.prepare('INSERT INTO throttle (key, count, reset_at) VALUES (?, 1, ?)')
      .bind(key, now + windowSec)
      .run();
    return;
  }
  if (Number(row.count) >= limit) {
    const minutes = Math.max(1, Math.ceil((row.reset_at - now) / 60));
    throw new ApiError(429, `操作太频繁了，请 ${minutes} 分钟后再试`);
  }
  await env.DB.prepare('UPDATE throttle SET count = count + 1 WHERE key = ?').bind(key).run();
}

async function createSession(env, userId) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const now = nowSec();

  // 顺手清理过期会话，省得表越来越大
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  )
    .bind(tokenHash, userId, now, now + SESSION_DAYS * 86400)
    .run();

  return token;
}

async function sendMail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM || 'onboarding@resend.dev',
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      console.error('[mail] 发送失败：', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('[mail] 发送异常：', err);
    return false;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
