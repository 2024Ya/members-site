// 前端公共工具：接口调用、导航渲染、提示条、登录态判断
(function () {
  'use strict';

  async function request(path, options) {
    const opts = Object.assign({ method: 'GET', credentials: 'same-origin', headers: {} }, options || {});
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }

    let res;
    try {
      res = await fetch('/api' + path, opts);
    } catch (e) {
      throw new Error('网络连接失败，请检查网络后再试');
    }

    const text = await res.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error('服务器返回了无法识别的内容，可能部署还没完成（状态码 ' + res.status + '）');
      }
    }

    if (!res.ok) {
      const err = new Error(data.error || '请求失败（' + res.status + '）');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const API = {
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body }),
    patch: (path, body) => request(path, { method: 'PATCH', body }),
    del: (path) => request(path, { method: 'DELETE' }),
    me: async () => {
      try {
        const data = await request('/auth/me');
        return data.user || null;
      } catch (e) {
        return null;
      }
    },
    logout: async () => {
      await request('/auth/logout', { method: 'POST' });
      location.href = '/';
    },
  };

  // ---------- 提示条 ----------
  function toast(message, type) {
    let host = document.getElementById('toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-host';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .2s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 220);
    }, 2600);
  }

  // ---------- 顶栏 ----------
  function applySiteName() {
    const site = window.SITE || {};
    if (!site.name) return;
    document.querySelectorAll('[data-site-name]').forEach((el) => {
      el.textContent = site.name;
    });
    if (document.title.indexOf('会员站') !== -1) {
      document.title = document.title.replace('会员站', site.name);
    }
  }

  async function mountNav() {
    applySiteName();
    const box = document.getElementById('nav-actions');
    if (!box) return null;

    const user = await API.me();
    if (!user) {
      box.innerHTML =
        '<a class="navlink" href="/login">登录</a>' +
        '<a class="btn btn-primary btn-sm" href="/register">免费注册</a>';
      return null;
    }

    const adminLink = user.role === 'admin'
      ? '<a class="navlink" href="/admin">管理后台</a>'
      : '';
    box.innerHTML =
      '<a class="navlink" href="/app">会员中心</a>' +
      adminLink +
      '<a class="navlink" href="#" id="logout-link">退出</a>';

    const logoutLink = document.getElementById('logout-link');
    if (logoutLink) {
      logoutLink.addEventListener('click', (e) => {
        e.preventDefault();
        API.logout();
      });
    }
    return user;
  }

  /** 页面需要登录：没登录就跳转登录页，并记住来路 */
  async function requireLogin() {
    const user = await API.me();
    if (!user) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = '/login?next=' + next;
      return null;
    }
    return user;
  }

  function formatDate(seconds) {
    if (!seconds) return '';
    const d = new Date(seconds * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function showAlert(id, message, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'alert alert-' + (type || 'error');
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function hideAlert(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }

  /** 登录后跳回原页面，但只允许站内路径，防止被跳到外站 */
  function safeNext(fallback) {
    const raw = new URLSearchParams(location.search).get('next');
    if (raw && raw.charAt(0) === '/' && raw.charAt(1) !== '/') return raw;
    return fallback || '/app';
  }

  window.API = API;
  window.UI = { toast, mountNav, requireLogin, formatDate, escapeHtml, showAlert, hideAlert, safeNext };
})();
