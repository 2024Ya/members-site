-- ============================================================
--  会员制网站 · 数据库结构（Cloudflare D1 / SQLite 语法）
--  在 Cloudflare 后台 D1 的 Console 里一次性粘贴执行即可
-- ============================================================

-- 用户表 ------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,           -- 用户唯一 ID（UUID）
  email           TEXT NOT NULL UNIQUE,       -- 邮箱（统一转小写存储）
  name            TEXT NOT NULL DEFAULT '',   -- 昵称
  password_hash   TEXT NOT NULL,              -- PBKDF2 派生出的密码哈希
  salt            TEXT NOT NULL,              -- 每个用户独立的随机盐
  iterations      INTEGER NOT NULL DEFAULT 100000,
  role            TEXT NOT NULL DEFAULT 'user', -- 'user' 或 'admin'
  verified        INTEGER NOT NULL DEFAULT 0, -- 邮箱是否已验证：0/1
  verify_token    TEXT,
  verify_expires  INTEGER,
  reset_token     TEXT,
  reset_expires   INTEGER,
  failed_attempts INTEGER NOT NULL DEFAULT 0, -- 连续登录失败次数
  locked_until    INTEGER,                    -- 锁定到期时间（Unix 秒）
  banned          INTEGER NOT NULL DEFAULT 0, -- 是否停用：0/1
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_email  ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_verify ON users(verify_token);
CREATE INDEX IF NOT EXISTS idx_users_reset  ON users(reset_token);

-- 会话表（登录状态）-------------------------------------------
-- 只存 token 的 SHA-256 哈希，即使数据库泄露也拿不到可用的登录凭证
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON sessions(expires_at);

-- 文章 / 教程表 -----------------------------------------------
CREATE TABLE IF NOT EXISTS articles (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  summary    TEXT NOT NULL DEFAULT '',  -- 列表页显示的摘要
  content    TEXT NOT NULL DEFAULT '',  -- 正文，支持 Markdown
  published  INTEGER NOT NULL DEFAULT 0,-- 0 = 草稿（仅管理员可见），1 = 已发布（会员可见）
  author_id  TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_pub ON articles(published, created_at DESC);

-- 简易限流表（防刷注册 / 防刷找回密码）------------------------
CREATE TABLE IF NOT EXISTS throttle (
  key      TEXT PRIMARY KEY,   -- 例如 "register:1.2.3.4"
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL    -- 这个时间点后计数自动归零
);
