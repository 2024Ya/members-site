# 会员制内容站 · 上线手册

一个「注册登录 + 会员专属文章 + 管理后台」的完整网站，全部跑在 **Cloudflare 免费额度**内。
整个部署过程不需要写任何代码，照着下面的步骤点鼠标就行。

---

## 一、这个站有什么

**访客看到**
- 首页（介绍 + 注册/登录入口）
- 注册、登录、忘记密码、重置密码
- 会员中心：只显示「已发布」的文章
- 文章阅读页：支持 Markdown 排版

**管理员能做**
- 写文章、存草稿、编辑、删除、发布/下架
- 看注册用户列表
- 停用（封禁）用户、解封
- 把某人设为管理员 / 取消管理员
- 帮用户重置密码
- 看基础数据（用户数、近 7 天新增、文章数）

**已经做好的安全措施**
- 密码用 PBKDF2-SHA256 加盐哈希存储，数据库里没有明文密码
- 登录状态存在 HttpOnly + Secure Cookie 里，前端 JS 读不到
- 会话只存 SHA-256 哈希，数据库泄露也拿不到可用凭证
- 连续 5 次密码错误锁定 15 分钟
- 同一 IP 每小时最多注册 10 个账号、最多申请 5 次找回密码（防刷额度）
- 所有写操作校验请求来源（防 CSRF），并校验登录状态与管理员权限
- 文章正文先转义再渲染，防止内容里塞脚本
- 改密码后自动踢掉其他所有设备的登录状态

---

## 二、目录结构

```
members-site/
├─ public/                  ← 网站页面（静态文件）
│  ├─ index.html            首页
│  ├─ register.html         注册
│  ├─ login.html            登录
│  ├─ forgot.html           忘记密码
│  ├─ reset.html            设置新密码
│  ├─ app.html              会员中心
│  ├─ article.html          文章阅读页
│  ├─ admin.html            管理后台
│  ├─ _routes.json          只让 /api/* 走后端，节省免费额度
│  └─ assets/
│     ├─ config.js          ★ 站点名字在这里改
│     ├─ style.css          全部样式
│     ├─ common.js          公共前端逻辑
│     └─ markdown.js        Markdown 渲染
├─ functions/                ← 后端接口（Cloudflare Pages Functions）
│  ├─ api/[[path]].js       所有接口：注册/登录/文章/后台
│  └─ _lib/
│     ├─ http.js            Cookie、会话、权限
│     └─ crypto.js          密码哈希
├─ schema.sql               ★ 数据库建表语句
├─ wrangler.toml
└─ README.md                就是本文件
```

---

## 三、开始之前，准备两个免费账号

| 账号 | 用途 | 费用 |
|---|---|---|
| [GitHub](https://github.com/signup) | 存代码，改动后自动触发部署 | 免费 |
| [Cloudflare](https://dash.cloudflare.com/sign-up) | 运行网站 + 数据库 | 免费 |

注册时用真实邮箱，Cloudflare 可能会发验证邮件。

---

## 四、第 1 步：把代码传到 GitHub

1. 登录 GitHub，右上角 **+** → **New repository**
2. Repository name 填 `members-site`，选 **Public**（私有也行），点 **Create repository**
3. 在新仓库页面点 **uploading an existing file**（或 *Add file → Upload files*）
4. 打开电脑上的 `members-site` 文件夹，**把里面的所有文件和文件夹一起拖进浏览器窗口**
   - 包括 `public`、`functions`、`schema.sql`、`wrangler.toml` 等
5. 等文件列表出现后，点绿色 **Commit changes**

> 提示：拖拽时是整个文件夹一起拖，GitHub 会自动保留 `public/assets/...` 这样的层级。
> 上传完可以点开 `public` 文件夹确认里面有 `index.html`。

---

## 五、第 2 步：在 Cloudflare 创建项目

1. 登录 Cloudflare 后台，左侧点 **Workers & Pages**
2. 点 **Create** → 选 **Pages** 标签 → **Connect to Git**
3. 授权 GitHub，选中刚才的 `members-site` 仓库 → **Begin setup**
4. 填写构建设置（**很重要**）：

   | 项目 | 填写内容 |
   |---|---|
   | Project name | `members-site`（这个名字决定你的网址） |
   | Production branch | `main` |
   | Framework preset | `None` |
   | Build command | **留空** |
   | Build output directory | `public` |

5. 点 **Save and Deploy**，等一两分钟

完成后你会拿到一个网址：`https://members-site.pages.dev`
（如果名字被占用，Cloudflare 会让你换一个，比如 `members-site-abc.pages.dev`）

> ⚠️ 这时候打开网页能看，但**注册会报错**，因为数据库还没建。继续下一步。

---

## 六、第 3 步：创建数据库

1. 左侧菜单点 **Workers & Pages** → 上方标签 **D1 SQL Database** → **Create**
   （新版界面也可能是 *Storage & Databases → D1 SQL Database*）
2. Database name 填 `members-db` → **Create**
3. 创建好后，进这个库，点 **Console** 标签
4. 用记事本打开项目里的 `schema.sql`，**全选复制**，粘贴到 Console 的输入框
5. 点 **Execute**（或 Run）

执行成功后，左侧表列表里会出现 `articles`、`sessions`、`users` 三张表。

---

## 七、第 4 步：把数据库绑定到网站（关键）

1. 回到 **Workers & Pages** → 点你的 `members-site` 项目
2. 点 **Settings** → **Bindings**（新版叫 *Bindings* 或 *Functions → D1 database bindings*）
3. 点 **Add** → 选 **D1 database**
4. 填写：
   - **Variable name**：必须一字不差地填 `DB`（大写）
   - **D1 database**：选 `members-db`
5. 保存

> 如果界面区分 Production / Preview 环境，两个都加一遍。

---

## 八、第 5 步：设置管理员邮箱（关键）

1. 同一个 **Settings** 页面 → **Variables and Secrets**（旧版叫 *Environment variables*）
2. 点 **Add**，添加下面这一条：

   | Variable name | Value |
   |---|---|
   | `ADMIN_EMAIL` | 你自己的邮箱，例如 `me@example.com` |

3. 保存

> 用这个邮箱注册的账号会自动获得管理员权限。
> **填错或忘了填，就进不了后台**（补救办法见文末「常见问题」）。

---

## 九、第 6 步：重新部署，让配置生效

改完绑定和环境变量后，**必须重新部署一次**才会生效：

1. 项目页 → **Deployments** 标签
2. 找到最新那条部署，右侧 **⋯** → **Retry deployment**
3. 等状态变成 **Success**

---

## 十、第 7 步：注册管理员，发第一篇文章

1. 打开 `https://你的项目名.pages.dev/register`
2. 用**和 `ADMIN_EMAIL` 完全一致**的邮箱注册
3. 注册成功后进入会员中心，顶栏会出现 **管理后台**
4. 进后台 → **+ 新建文章** → 填标题、摘要、正文 → 勾选「立即发布」→ 保存
5. 回到会员中心刷新，文章就出现了

---

## 十一、可选：绑定自己的域名

1. 先买一个域名（约 30–80 元/年，Cloudflare 后台 **Domain Registration** 按成本价卖）
2. 把这个域名添加到 Cloudflare（免费套餐即可）
3. 回到 Pages 项目 → **Custom domains** → **Set up a custom domain** → 输入你的域名
4. 按提示添加 DNS 记录（如果域名本来就在 Cloudflare，通常一键完成）

绑定后 HTTPS 证书自动签发，不用额外操作。

---

## 十二、可选：开通邮件功能（找回密码 / 邮箱验证）

不配置也能用，只是「忘记密码」会提示你联系管理员。

1. 注册 [Resend](https://resend.com)（免费额度：每天 100 封）
2. 后台 **API Keys** → 创建一个 Key → 复制
3. 回 Cloudflare 项目 → Settings → Variables and Secrets，添加：

   | 名称 | 值 |
   |---|---|
   | `RESEND_API_KEY` | 刚才复制的 Key |
   | `MAIL_FROM` | 例如 `noreply@你的域名`（需先在 Resend 验证域名） |

4. 重新部署

**注意**：Resend 默认的发件地址 `onboarding@resend.dev` 只能发给**你自己注册 Resend 用的那个邮箱**。
想让别人收到邮件，必须在 Resend 里添加并验证你的域名（免费）。

想强制新用户验证邮箱，再加一条 `REQUIRE_VERIFY` = `1`。
（不配 `RESEND_API_KEY` 时，这个开关会自动忽略，避免把所有人挡在门外。）

---

## 十三、常见问题

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 注册时提示「数据库还没绑定好」 | D1 没绑，或变量名不是 `DB` | Settings → Bindings 加 D1，变量名填 `DB`，然后 Retry deployment |
| 部署失败 | 输出目录或构建命令填错 | Build command 留空，Build output directory 必须是 `public` |
| 注册成功了，但没有「管理后台」入口 | `ADMIN_EMAIL` 没设，或和注册邮箱不一致 | 设好 `ADMIN_EMAIL` 后用同一邮箱重新登录；或按下面 SQL 手动提权 |
| 登录提示「密码错误次数太多」 | 连续错 5 次触发锁定 | 等 15 分钟，或用下面 SQL 解锁 |
| 收不到验证 / 重置邮件 | Resend 没配好或域名未验证 | 先设 `REQUIRE_VERIFY=0`，用后台「改密码」功能代替 |
| 改了代码，网站没变 | 还在部署中 / 浏览器缓存 | 看 Deployments 是否 Success，再按 Ctrl+F5 强制刷新 |
| 打开很慢、偶尔打不开 | 国内访问 Cloudflare 免费节点不稳定 | 换网络试试；重要用户群在国内需另做打算 |

### 救急 SQL（在 D1 → Console 里执行）

```sql
-- 1. 把自己设为管理员（把邮箱换成你的）
UPDATE users SET role = 'admin' WHERE email = 'me@example.com';

-- 2. 解锁被锁定的账号
UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE email = 'me@example.com';

-- 3. 让所有设备退出登录
DELETE FROM sessions;

-- 4. 看看现在有哪些用户
SELECT email, name, role, banned, created_at FROM users ORDER BY created_at DESC;
```

---

## 十四、免费额度（个人站基本用不完）

| 项目 | 免费额度 | 说明 |
|---|---|---|
| Pages 静态请求 | 不限量 | 页面、图片、CSS 都不计数 |
| Workers 请求 | 100,000 次/天 | 只有 `/api/*` 计数，一次页面浏览约 1–3 次 |
| Workers CPU | 10 ms/次 | 登录注册时算密码会用到，偶尔超一点有弹性余量 |
| D1 存储 | 5 GB | 存几万用户 + 上千篇文章绰绰有余 |
| D1 读 | 500 万行/天 | 个人站远用不到 |

> 如果登录时页面报 **Error 1102（Worker exceeded resource limits）**，
> 说明密码计算超过了免费 CPU 限制。在环境变量里加 `PBKDF2_ITERATIONS` = `25000` 再部署一次即可。

**真正的成本**：只有域名（可选）。`.pages.dev` 子域名永久免费。

---

## 十五、想改点什么

| 想改 | 改哪里 |
|---|---|
| 网站名字 | `public/assets/config.js` 里的 `name` |
| 一句话介绍 | `public/assets/config.js` 里的 `description` |
| 主色调 | `public/assets/style.css` 开头的 `--brand` |
| 首页文案 | `public/index.html` |
| 注册时最少密码位数 | `functions/api/[[path]].js` 里的 `password.length < 8` |
| 登录有效期 | 同文件里的 `SESSION_DAYS = 30` |

改完在 GitHub 上重新上传对应文件（或直接在线编辑），Cloudflare 会自动重新部署。

---

## 十六、几条实在的提醒

1. **先在本地留一份备份**：文章正文最好也在自己的笔记软件里存一份，别只存在数据库里。
2. **管理员密码要强**：这个账号能改所有内容，别用和其他网站相同的密码。
3. **上线前自己走一遍流程**：注册 → 退出 → 登录 → 看文章 → 找回密码。
4. **免费条款会变**：Cloudflare 的免费额度调整过几次，重要项目记得偶尔看一眼后台用量。
5. **国内访问有波动**：这是 Cloudflare 免费版绕不开的问题，不是配置错误。

---

需要加功能（评论、付费、文件下载、多级分类、搜索……）时，直接说需求就行，代码结构是照着能扩展的样子搭的。
