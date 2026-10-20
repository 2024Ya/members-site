// 极简 Markdown 渲染器（先转义再渲染，避免 XSS）
// 支持：标题、粗体、斜体、行内代码、代码块、列表、引用、分割线、链接、图片
(function () {
  'use strict';

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function inline(text) {
    let out = escapeHtml(text);
    out = out.replace(/`([^`\n]+)`/g, (m, code) => '<code>' + code + '</code>');
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    out = out.replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    return out;
  }

  const BLOCK_START = /^(#{1,6}\s|\s*[-*+]\s+|\s*\d+[.)]\s+|\s*>|\s*```)/;

  function render(source) {
    const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 代码块
      if (/^\s*```/.test(line)) {
        const lang = line.trim().slice(3).trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // 跳过结束的 ```
        html.push(
          '<pre><code' + (lang ? ' class="language-' + escapeHtml(lang) + '"' : '') + '>' +
          escapeHtml(buf.join('\n')) + '</code></pre>'
        );
        continue;
      }

      if (!line.trim()) { i++; continue; }

      // 分割线
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        html.push('<hr>');
        i++;
        continue;
      }

      // 标题
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        html.push('<h' + level + '>' + inline(heading[2].trim()) + '</h' + level + '>');
        i++;
        continue;
      }

      // 引用
      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        html.push('<blockquote>' + render(buf.join('\n')) + '</blockquote>');
        continue;
      }

      // 无序列表
      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
          i++;
        }
        html.push('<ul>' + items.map((t) => '<li>' + inline(t) + '</li>').join('') + '</ul>');
        continue;
      }

      // 有序列表
      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
          i++;
        }
        html.push('<ol>' + items.map((t) => '<li>' + inline(t) + '</li>').join('') + '</ol>');
        continue;
      }

      // 独占一行的图片
      const img = line.match(/^\s*!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)\s*$/);
      if (img) {
        html.push('<img src="' + escapeHtml(img[2]) + '" alt="' + escapeHtml(img[1]) + '" loading="lazy">');
        i++;
        continue;
      }

      // 段落
      const buf = [];
      while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      if (!buf.length) { buf.push(lines[i]); i++; } // 兜底，防止死循环
      html.push('<p>' + inline(buf.join(' ')) + '</p>');
    }

    return html.join('\n');
  }

  window.renderMarkdown = render;
})();
