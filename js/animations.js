(function (global) {
  "use strict";

  var reduceQuery = global.matchMedia
    ? global.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false, addEventListener: function () {} };

  function Animations(book) {
    this.book = book;
  }

  Animations.prototype.isReduced = function () {
    return reduceQuery.matches;
  };

  Animations.prototype.onChange = function (handler) {
    if (typeof reduceQuery.addEventListener === "function") {
      reduceQuery.addEventListener("change", handler);
    } else if (typeof reduceQuery.addListener === "function") {
      reduceQuery.addListener(handler);
    }
  };

  Animations.prototype.coverDirection = function () {
    return this.book.getState().isOpen ? "close" : "open";
  };

  /* Restarting a CSS animation needs one forced style flush so the browser
     sees the element without the animation before it sees it again. This is the
     one place in the project where reading layout is genuinely required. */
  Animations.prototype.replay = function (el, className) {
    if (!el) return;
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  };

  Animations.prototype.settle = function (target) {
    if (!target) return;
    target.classList.remove("is-revealed");
    void target.offsetWidth;
    target.classList.add("is-revealed");
  };

  global.BMT = global.BMT || {};
  global.BMT.Animations = Animations;
  global.BMT.reduceQuery = reduceQuery;
})(window);
