/* ==========================================================================
   RuanooUI — 交互脚本
   --------------------------------------------------------------------------
   零依赖。页面加载后自动执行 initAll()，也可按需单独调用：

     RuanooUI.initTheme()         主题切换（读写 localStorage）
     RuanooUI.initSelects(scope)  自定义下拉
     RuanooUI.initSegments(scope) 分段控件（theme-switch / layout-presets）
     RuanooUI.initManageLists()   列表选择项
     RuanooUI.initModals(scope)   弹窗
     RuanooUI.initLabelOverflow() 分段控件长文案的滚动检测
     RuanooUI.initAll()           一次性初始化全部
     RuanooUI.openModal(id)       打开弹窗
     RuanooUI.closeModal(el)      关闭弹窗

   scope 用于动态插入的内容：RuanooUI.initSelects(panel) 只初始化该子树。

   自定义事件（都冒泡）：
     ruanoo:select-change    detail: { value }
     ruanoo:segment-change   detail: { index }
     ruanoo:preset-change    detail: { value }
     ruanoo:manage-select    detail: { action }
   ========================================================================== */
(function (global) {
  'use strict';

  var THEME_KEY = 'ruanoo-ui-theme';
  var GAP = 4;              // 浮层与触发器之间的间距
  var VIEWPORT_PAD = 8;     // 浮层与视口边缘的最小距离
  var MIN_DROPDOWN_H = 96;  // 翻转后仍保留的最小可读高度

  var FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  // 全局监听只注册一次：重复 init 不会叠加监听器
  var globalsBound = false;
  var overflowTargets = [];
  var lastTrigger = null;
  var modalSeq = 0;

  /* ---------------- 工具 ---------------- */

  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function isOpen(el) {
    return !!el && el.classList.contains('ruanoo-active');
  }

  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  /* ---------------- 主题 ---------------- */

  function initTheme() {
    var root = document.documentElement;
    var saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') root.dataset.ruTheme = saved;

    all('[data-ru-set-theme]').forEach(function (btn) {
      if (btn.dataset.ruReady) return;
      btn.dataset.ruReady = '1';
      btn.addEventListener('click', function () {
        var theme = btn.dataset.ruSetTheme;
        root.dataset.ruTheme = theme;
        localStorage.setItem(THEME_KEY, theme);
        syncThemeButtons();
      });
    });
    syncThemeButtons();

    function syncThemeButtons() {
      var current = root.dataset.ruTheme === 'dark' ? 'dark' : 'light';
      all('[data-ru-set-theme]').forEach(function (btn) {
        btn.classList.toggle('on', btn.dataset.ruSetTheme === current);
      });
    }
  }

  /* ---------------- 自定义下拉 ---------------- */

  function closeSelect(wrap, refocus) {
    var dropdown = wrap.querySelector('.ruanoo-custom-select-dropdown');
    var display = wrap.querySelector('.ruanoo-custom-select-display');
    if (dropdown) dropdown.classList.remove('ruanoo-active', 'ruanoo-drop-up');
    if (display) {
      display.classList.remove('ruanoo-active');
      display.setAttribute('aria-expanded', 'false');
    }
    if (refocus && display) display.focus();
  }

  function closeAllSelects(except) {
    all('.ruanoo-custom-select-dropdown.ruanoo-active').forEach(function (dropdown) {
      var wrap = dropdown.closest('.ruanoo-custom-select-wrapper');
      if (wrap && wrap !== except) closeSelect(wrap);
    });
  }

  /* 浮层是 position: fixed，需要手动贴到触发器旁边：
     空间不足时向上展开，并收敛到视口内。 */
  function placeDropdown(dropdown, display) {
    var rect = display.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    dropdown.classList.remove('ruanoo-drop-up');
    dropdown.style.maxHeight = '';
    dropdown.style.minWidth = rect.width + 'px';

    var spaceBelow = vh - rect.bottom - GAP - VIEWPORT_PAD;
    var spaceAbove = rect.top - GAP - VIEWPORT_PAD;
    var natural = dropdown.offsetHeight;                 // CSS max-height 约束下的自然高度
    var openUp = natural > spaceBelow && spaceAbove > spaceBelow;

    dropdown.style.maxHeight = Math.max(MIN_DROPDOWN_H, openUp ? spaceAbove : spaceBelow) + 'px';
    if (openUp) dropdown.classList.add('ruanoo-drop-up');

    var height = dropdown.offsetHeight;
    var top = openUp ? rect.top - GAP - height : rect.bottom + GAP;
    var left = clamp(rect.left, VIEWPORT_PAD, Math.max(VIEWPORT_PAD, vw - rect.width - VIEWPORT_PAD));

    dropdown.style.left = left + 'px';
    dropdown.style.top = clamp(top, VIEWPORT_PAD, Math.max(VIEWPORT_PAD, vh - height - VIEWPORT_PAD)) + 'px';
  }

  function openSelect(wrap) {
    var dropdown = wrap.querySelector('.ruanoo-custom-select-dropdown');
    var display = wrap.querySelector('.ruanoo-custom-select-display');
    if (!dropdown || !display) return;
    placeDropdown(dropdown, display);
    dropdown.classList.add('ruanoo-active');
    display.classList.add('ruanoo-active');
    display.setAttribute('aria-expanded', 'true');
  }

  function optionsOf(dropdown) {
    return all('.ruanoo-custom-select-option:not(.ruanoo-disabled)', dropdown);
  }

  function chooseOption(wrap, opt) {
    var dropdown = wrap.querySelector('.ruanoo-custom-select-dropdown');
    var text = wrap.querySelector('.ruanoo-custom-select-text');
    all('.ruanoo-custom-select-option', dropdown).forEach(function (o) {
      var picked = o === opt;
      o.classList.toggle('ruanoo-selected', picked);
      o.setAttribute('aria-selected', picked ? 'true' : 'false');
    });
    if (text) text.textContent = opt.textContent.trim();
    closeSelect(wrap, true);
    wrap.dispatchEvent(new CustomEvent('ruanoo:select-change', {
      bubbles: true,
      detail: { value: opt.dataset.ruValue || opt.textContent.trim() }
    }));
  }

  function initSelects(scope) {
    all('.ruanoo-custom-select-wrapper[data-ru-select]', scope || document).forEach(function (wrap) {
      if (wrap.dataset.ruReady) return;
      wrap.dataset.ruReady = '1';

      var display = wrap.querySelector('.ruanoo-custom-select-display');
      var dropdown = wrap.querySelector('.ruanoo-custom-select-dropdown');
      if (!display || !dropdown) return;

      // 选项用方向键导航，不进入 Tab 序列
      all('.ruanoo-custom-select-option', dropdown).forEach(function (opt) {
        opt.tabIndex = -1;
        opt.addEventListener('click', function (e) {
          e.stopPropagation();
          if (opt.classList.contains('ruanoo-disabled')) return;
          chooseOption(wrap, opt);
        });
      });

      display.addEventListener('click', function (e) {
        e.stopPropagation();
        if (isOpen(dropdown)) {
          closeSelect(wrap);
        } else {
          closeAllSelects(wrap);
          openSelect(wrap);
        }
      });

      display.addEventListener('keydown', function (e) {
        var opts = optionsOf(dropdown);
        if (!opts.length) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (isOpen(dropdown)) {
            opts[e.key === 'ArrowUp' ? opts.length - 1 : 0].focus();
          } else {
            closeAllSelects(wrap);
            openSelect(wrap);
            opts[e.key === 'ArrowUp' ? opts.length - 1 : 0].focus();
          }
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (isOpen(dropdown)) closeSelect(wrap);
          else { closeAllSelects(wrap); openSelect(wrap); }
        } else if (e.key === 'Escape' && isOpen(dropdown)) {
          e.preventDefault();
          closeSelect(wrap, true);
        }
      });

      dropdown.addEventListener('keydown', function (e) {
        var opts = optionsOf(dropdown);
        var i = opts.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); opts[Math.min(i + 1, opts.length - 1)].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); opts[Math.max(i - 1, 0)].focus(); }
        else if (e.key === 'Home') { e.preventDefault(); opts[0].focus(); }
        else if (e.key === 'End') { e.preventDefault(); opts[opts.length - 1].focus(); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (i >= 0) chooseOption(wrap, opts[i]); }
        else if (e.key === 'Escape') { e.preventDefault(); closeSelect(wrap, true); }
        else if (e.key === 'Tab') { closeSelect(wrap); }
      });
    });
  }

  /* ---------------- 分段控件 ---------------- */

  function initSegments(scope) {
    var root = scope || document;

    // theme-switch：三项等分，滑块位移由容器上的 ruanoo-idx-N 控制
    all('.ruanoo-theme-switch[data-ru-segment]', root).forEach(function (sw) {
      if (sw.dataset.ruReady) return;
      sw.dataset.ruReady = '1';
      var opts = all('.ruanoo-theme-option', sw);

      function selectIndex(i) {
        opts.forEach(function (o, j) {
          o.classList.toggle('ruanoo-active', j === i);
          o.setAttribute('aria-checked', j === i ? 'true' : 'false');
          o.tabIndex = j === i ? 0 : -1;
        });
        sw.classList.remove('ruanoo-idx-0', 'ruanoo-idx-1', 'ruanoo-idx-2');
        if (i > 0) sw.classList.add('ruanoo-idx-' + i);
        sw.dispatchEvent(new CustomEvent('ruanoo:segment-change', {
          bubbles: true, detail: { index: i }
        }));
      }

      opts.forEach(function (opt, i) {
        opt.addEventListener('click', function () { selectIndex(i); });
        opt.addEventListener('keydown', function (e) {
          var next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1
            : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : -1;
          if (next < 0) return;
          e.preventDefault();
          var target = (next + opts.length) % opts.length;
          opts[target].focus();
          selectIndex(target);
        });
      });
    });

    // layout-presets：卡片高亮与滑块位移必须同步更新
    all('.ruanoo-layout-presets[data-ru-presets]', root).forEach(function (group) {
      if (group.dataset.ruReady) return;
      group.dataset.ruReady = '1';
      var cards = all('.ruanoo-preset-card', group);

      function selectCard(i) {
        cards.forEach(function (c, j) {
          c.classList.toggle('ruanoo-active', j === i);
          c.setAttribute('aria-checked', j === i ? 'true' : 'false');
          c.tabIndex = j === i ? 0 : -1;
        });
        // no-thumb 由使用方在"当前配置与任何预设都不匹配"时加上
        group.classList.remove('ruanoo-idx-0', 'ruanoo-idx-1', 'ruanoo-idx-2', 'ruanoo-no-thumb');
        if (i > 0) group.classList.add('ruanoo-idx-' + i);
        group.dispatchEvent(new CustomEvent('ruanoo:preset-change', {
          bubbles: true, detail: { value: cards[i].dataset.ruLayoutVal }
        }));
      }

      cards.forEach(function (card, i) {
        card.addEventListener('click', function () { selectCard(i); });
        card.addEventListener('keydown', function (e) {
          var next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1
            : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : -1;
          if (next < 0) return;
          e.preventDefault();
          var target = (next + cards.length) % cards.length;
          cards[target].focus();
          selectCard(target);
        });
      });
    });
  }

  /* ---------------- 列表选择项 ---------------- */

  function initManageLists(scope) {
    all('.ruanoo-manage-list[data-ru-manage]', scope || document).forEach(function (list) {
      if (list.dataset.ruReady) return;
      list.dataset.ruReady = '1';
      var opts = all('.ruanoo-manage-option', list);

      function select(opt) {
        opts.forEach(function (o) {
          var picked = o === opt;
          o.setAttribute('aria-selected', picked ? 'true' : 'false');
          o.tabIndex = picked ? 0 : -1;
        });
        list.dispatchEvent(new CustomEvent('ruanoo:manage-select', {
          bubbles: true, detail: { action: opt.dataset.ruAction }
        }));
      }

      opts.forEach(function (opt, i) {
        opt.addEventListener('click', function () { select(opt); });
        opt.addEventListener('keydown', function (e) {
          var target = -1;
          if (e.key === 'ArrowDown') target = Math.min(i + 1, opts.length - 1);
          else if (e.key === 'ArrowUp') target = Math.max(i - 1, 0);
          else if (e.key === 'Home') target = 0;
          else if (e.key === 'End') target = opts.length - 1;
          else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(opt); return; }
          if (target < 0) return;
          e.preventDefault();
          opts[target].focus();
          select(opts[target]);
        });
      });
    });
  }

  /* ---------------- 分段控件长文案 ---------------- */

  function measureOverflow() {
    overflowTargets.forEach(function (label) {
      var inner = label.querySelector('.ruanoo-theme-option-label-inner');
      if (!inner) return;
      var shift = inner.scrollWidth - label.clientWidth;
      if (shift > 1) {
        inner.style.setProperty('--ru-label-shift', shift + 'px');
        inner.classList.add('ruanoo-overflowing');
      } else {
        inner.style.removeProperty('--ru-label-shift');
        inner.classList.remove('ruanoo-overflowing');
      }
    });
  }

  function initLabelOverflow(scope) {
    var found = all('.ruanoo-theme-option-label', scope || document).filter(function (label) {
      return overflowTargets.indexOf(label) === -1;
    });
    if (found.length) overflowTargets = overflowTargets.concat(found);
    measureOverflow();
  }

  /* ---------------- 弹窗 ---------------- */

  function openModal(id) {
    var overlay = typeof id === 'string' ? document.getElementById(id) : id;
    if (!overlay || isOpen(overlay)) return;

    lastTrigger = document.activeElement;
    overlay.classList.add('ruanoo-active');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('ruanoo-modal-open');

    var dialog = overlay.querySelector('.ruanoo-modal-dialog');
    if (!dialog) return;
    var first = all(FOCUSABLE, dialog).filter(isVisible)[0];
    (first || dialog).focus();
  }

  function closeModal(el) {
    var overlay = el && el.closest ? el.closest('.ruanoo-modal-overlay') : null;
    if (!overlay || !isOpen(overlay)) return;

    overlay.classList.remove('ruanoo-active');
    overlay.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.ruanoo-modal-overlay.ruanoo-active')) {
      document.body.classList.remove('ruanoo-modal-open');
    }
    // 焦点归还给打开它的元素
    if (lastTrigger && lastTrigger.focus) lastTrigger.focus();
    lastTrigger = null;
  }

  function initModals(scope) {
    var root = scope || document;

    all('.ruanoo-modal-overlay', root).forEach(function (overlay) {
      if (overlay.dataset.ruReady) return;
      overlay.dataset.ruReady = '1';

      var dialog = overlay.querySelector('.ruanoo-modal-dialog');
      if (dialog) {
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
        var header = dialog.querySelector('.ruanoo-modal-header');
        if (header) {
          if (!header.id) header.id = 'ruanoo-modal-title-' + (++modalSeq);
          dialog.setAttribute('aria-labelledby', header.id);
        }
      }
      if (!isOpen(overlay)) overlay.setAttribute('aria-hidden', 'true');

      // 点遮罩关闭（点在对话框内部不关）
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeModal(overlay);
      });
    });

    all('[data-ru-open-modal]', root).forEach(function (btn) {
      if (btn.dataset.ruReady) return;
      btn.dataset.ruReady = '1';
      btn.addEventListener('click', function () { openModal(btn.dataset.ruOpenModal); });
    });

    all('[data-ru-close-modal]', root).forEach(function (btn) {
      if (btn.dataset.ruReady) return;
      btn.dataset.ruReady = '1';
      btn.addEventListener('click', function () { closeModal(btn); });
    });
  }

  /* ---------------- 全局监听（只注册一次） ---------------- */

  function bindGlobals() {
    if (globalsBound) return;
    globalsBound = true;

    // 点击组件之外任意位置收起下拉
    document.addEventListener('click', function () { closeAllSelects(); });

    function reposition() {
      all('.ruanoo-custom-select-dropdown.ruanoo-active').forEach(function (dropdown) {
        var wrap = dropdown.closest('.ruanoo-custom-select-wrapper');
        var display = wrap && wrap.querySelector('.ruanoo-custom-select-display');
        if (display) placeDropdown(dropdown, display);
      });
    }
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('resize', measureOverflow);

    document.addEventListener('keydown', function (e) {
      var open = document.querySelector('.ruanoo-modal-overlay.ruanoo-active');

      if (e.key === 'Escape') {
        if (open) { closeModal(open); return; }
        closeAllSelects();
        return;
      }

      // 焦点循环锁在对话框内部
      if (e.key !== 'Tab' || !open) return;
      var dialog = open.querySelector('.ruanoo-modal-dialog');
      if (!dialog) return;
      var items = all(FOCUSABLE, dialog).filter(isVisible);
      if (!items.length) { e.preventDefault(); dialog.focus(); return; }
      var first = items[0];
      var last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* ---------------- 初始化 ---------------- */

  function initAll() {
    bindGlobals();
    initTheme();
    initSelects();
    initSegments();
    initManageLists();
    initModals();
    initLabelOverflow();
  }

  var RuanooUI = {
    KEY: THEME_KEY,
    initTheme: initTheme,
    initSelects: initSelects,
    initSegments: initSegments,
    initManageLists: initManageLists,
    initModals: initModals,
    initLabelOverflow: initLabelOverflow,
    openModal: openModal,
    closeModal: closeModal,
    initAll: initAll
  };

  global.RuanooUI = RuanooUI;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})(window);
