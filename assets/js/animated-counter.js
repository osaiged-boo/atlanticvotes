/* Atlantic Votes — animated counters (vanilla JS, no dependencies).
   Eased count-up for seat / vote numbers and bar widths.
   - Page load (pei.html): [data-av-count] numbers count up from 0 and
     [data-av-bar] widths grow from 0 to their authored values.
   - Live refresh (bc.html, us-midterms.html): AVCount.setNumber /
     setNumberFrom / setWidth animate a number only when it changed;
     unchanged values are left alone (no flicker, no re-animation).
   - Respects prefers-reduced-motion: values are set instantly, no animation.
   - If this file fails to load, every page still shows its authored numbers:
     callers guard with `window.AVCount` and fall back to plain text.
*/
(function () {
  "use strict";
  var REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var DUR = 900; /* ms */

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function fmtInt(n) { return Math.round(n).toLocaleString("en-US"); }
  function parseNum(text) {
    if (text === null || text === undefined) return null;
    var m = String(text).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  function formatValue(v, decimals, kind) {
    if (kind === "pct") return v.toFixed(1) + "%";
    if (decimals && decimals > 0) return v.toFixed(decimals);
    return fmtInt(v);
  }
  function animateNumber(el, from, to, opts) {
    opts = opts || {};
    var decimals = opts.decimals || 0;
    var kind = opts.kind || "int";
    if (REDUCED || from === null || from === undefined || from === to) {
      el.textContent = formatValue(to, decimals, kind);
      return;
    }
    if (el._avRaf) cancelAnimationFrame(el._avRaf);
    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / DUR);
      var v = from + (to - from) * easeOutCubic(p);
      el.textContent = formatValue(v, decimals, kind);
      if (p < 1) {
        el._avRaf = requestAnimationFrame(frame);
      } else {
        el._avRaf = null;
        el.textContent = formatValue(to, decimals, kind);
      }
    }
    el._avRaf = requestAnimationFrame(frame);
  }
  function animateWidth(el, fromPct, toPct) {
    if (REDUCED || fromPct === null || fromPct === undefined || fromPct === toPct) {
      el.style.transition = "";
      el.style.width = toPct + "%";
      return;
    }
    /* Drive the width on the same clock and easing as the numbers (the old
       CSS transition ran on a different curve and finished well ahead of
       the count-up, so the bars looked already full while numbers were
       still rising). */
    if (el._avRaf) cancelAnimationFrame(el._avRaf);
    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / DUR);
      var v = fromPct + (toPct - fromPct) * easeOutCubic(p);
      el.style.transition = "";
      el.style.width = v + "%";
      if (p < 1) {
        el._avRaf = requestAnimationFrame(frame);
      } else {
        el._avRaf = null;
        el.style.width = toPct + "%";
      }
    }
    el._avRaf = requestAnimationFrame(frame);
  }

  window.AVCount = {
    reduced: REDUCED,
    parseNum: parseNum,
    fmtInt: fmtInt,
    /* Animate el from its currently displayed number to `to`; no-op if unchanged. */
    setNumber: function (el, to, opts) {
      if (!el) return;
      animateNumber(el, parseNum(el.textContent), to, opts);
    },
    /* Animate el from a given previous value to `to`; no-op if unchanged. */
    setNumberFrom: function (el, from, to, opts) {
      if (!el) return;
      animateNumber(el, from, to, opts);
    },
    /* Animate el from 0 to `to` (page-load count-up). */
    countUp: function (el, to, opts) {
      if (!el) return;
      animateNumber(el, 0, to, opts);
    },
    /* Animate a bar's width from fromPct to toPct; no-op if unchanged. */
    setWidth: function (el, fromPct, toPct) {
      if (!el) return;
      animateWidth(el, fromPct, toPct);
    },
    /* Count one number element up from 0. */
    countUpOne: function (n) {
      var to = parseFloat(n.getAttribute("data-av-to"));
      if (isNaN(to)) return;
      animateNumber(n, 0, to, {
        decimals: parseInt(n.getAttribute("data-av-decimals") || "0", 10),
        kind: n.getAttribute("data-av-kind") || "int"
      });
    },
    /* Grow one bar from 0 to its authored width. */
    growOne: function (b) {
      var w = parseFloat(b.getAttribute("data-av-width"));
      if (isNaN(w)) return;
      animateWidth(b, 0, w);
    },
    /* Page-load count-up: [data-av-count] numbers and [data-av-bar] widths. */
    initLoadCounters: function () {
      if (REDUCED) return; /* values stay exactly as authored in the HTML */
      var nums = document.querySelectorAll("[data-av-count]");
      for (var i = 0; i < nums.length; i++) window.AVCount.countUpOne(nums[i]);
      var bars = document.querySelectorAll("[data-av-bar]");
      for (var j = 0; j < bars.length; j++) window.AVCount.growOne(bars[j]);
    },
    /* Animate each counter/bar the first time it scrolls into view, so
       below-the-fold sections still show their motion when reached. */
    initScrollCounters: function () {
      if (REDUCED) return; /* values stay exactly as authored in the HTML */
      if (!("IntersectionObserver" in window)) { window.AVCount.initLoadCounters(); return; }
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (!entries[i].isIntersecting) continue;
          var el = entries[i].target;
          io.unobserve(el);
          if (el.hasAttribute("data-av-count")) window.AVCount.countUpOne(el);
          else window.AVCount.growOne(el);
        }
      }, { threshold: 0.2 });
      var nums = document.querySelectorAll("[data-av-count]");
      for (var a = 0; a < nums.length; a++) io.observe(nums[a]);
      var bars = document.querySelectorAll("[data-av-bar]");
      for (var b = 0; b < bars.length; b++) io.observe(bars[b]);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", window.AVCount.initScrollCounters);
  } else {
    window.AVCount.initScrollCounters();
  }
})();
