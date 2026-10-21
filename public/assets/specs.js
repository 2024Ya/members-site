// 规范库共用：状态标签、文件大小、目录生成
(function () {
  'use strict';

  const STATUS = {
    active: ['现行', 'badge-ok'],
    replaced: ['被替代', 'badge-warn'],
    abolished: ['作废', 'badge-danger'],
    draft: ['征求意见', 'badge'],
  };

  function statusOf(value) {
    return STATUS[value] || STATUS.active;
  }

  function formatSize(bytes) {
    const n = Number(bytes || 0);
    if (!n) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  /** 把正文里的 h2/h3 变成左侧目录 */
  function buildToc(root, tocEl) {
    if (!tocEl) return;
    const heads = root.querySelectorAll('h2, h3');
    if (!heads.length) {
      tocEl.innerHTML = '';
      tocEl.style.display = 'none';
      return;
    }

    const parts = ['<div class="toc-title">目录</div>'];
    heads.forEach(function (h, index) {
      const id = 'sec-' + index;
      h.id = id;
      const cls = h.tagName === 'H3' ? ' class="lvl3"' : '';
      parts.push('<a' + cls + ' href="#' + id + '">' + UI.escapeHtml(h.textContent) + '</a>');
    });
    tocEl.innerHTML = parts.join('');
    tocEl.style.display = '';

    tocEl.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.getElementById(link.getAttribute('href').slice(1));
        if (!target) return;
        window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 84, behavior: 'smooth' });
      });
    });
  }

  /** 拼接「查时效」跳转链接，没有配置就返回空 */
  function checkUrl(code) {
    const tpl = (window.SITE && window.SITE.checkUrl) || '';
    if (!tpl || !code || String(code).trim() === '') return '';
    return tpl.replace('{code}', encodeURIComponent(String(code).trim()));
  }

  function checkName() {
    return (window.SITE && window.SITE.checkName) || '标准网站';
  }

  window.Specs = { STATUS, statusOf, formatSize, buildToc, checkUrl, checkName };
})();
