(function (global) {
  "use strict";

  var SWIPE_DISTANCE = 48;
  var SWIPE_SLOPE = 1.1;
  var SWIPE_WINDOW = 900;

  function isTextEntry(el) {
    if (!el) return false;
    var name = el.tagName;
    return (
      name === "INPUT" ||
      name === "TEXTAREA" ||
      name === "SELECT" ||
      el.isContentEditable === true
    );
  }

  function Navigation(book, ui, music) {
    this.book = book;
    this.ui = ui;
    this.music = music || null;
    this.touch = null;
  }

  /* Music follows the book's open state and nothing else. Wiring it to these
     two events rather than to next/prev is what keeps the track from restarting
     on a page change. */
  Navigation.prototype._wireMusic = function () {
    var self = this;
    if (!this.music) return;

    this.book.emitter.on("book:opened", function () {
      self.music.onBookOpen();
    });

    this.book.emitter.on("book:closed", function () {
      self.music.onBookClose();
    });
  };

  Navigation.prototype.init = function () {
    var self = this;
    var ui = this.ui;
    var book = this.book;

    this._bind(ui.btnOpen, function () { self.book.open(); });
    this._bind(ui.btnClose, function () { self.book.close(); });
    this._bind(ui.btnPrev, function () { self.book.prev(); });
    this._bind(ui.btnNext, function () {
      /* At the very end the reader has reached the closing page, so Next is the
         exit rather than a dead button. getState() has no atLast, so the end is
         read straight off the index. */
      var state = self.book.getState();
      if (state.index >= state.total) self.book.close();
      else self.book.next();
    });

    this._bind(ui.cover, function () {
      if (!self.book.getState().isOpen) self.book.open();
    });

    this._bindKeys();
    this._bindSwipe();
    this._bindScrubber();
    this._wireMusic();

    book.emitter.on("book:progress", function (p) { self.render(p); });
    book.emitter.on("book:turned", function (p) { self.render(p); self.announce(p); });
    book.emitter.on("book:opened", function (p) { self.render(p); self.announce(p); });
    book.emitter.on("book:settled", function (p) { self.render(p); });
    book.emitter.on("book:closed", function (p) { self.render(p); });

    this.render(this.book._progress());
  };

  Navigation.prototype._bind = function (el, handler) {
    if (!el) return;
    el.addEventListener("click", function (e) {
      e.preventDefault();
      handler(e);
    });
  };

  Navigation.prototype._bindKeys = function () {
    var self = this;
    var book = this.book;

    document.addEventListener("keydown", function (e) {
      if (e.defaultPrevented) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (isTextEntry(e.target)) return;

      var state = book.getState();
      if (state.isAnimating) return;

      if (e.key === "ArrowRight" || e.key === " " || e.key === "Spacebar") {
        if (!state.isOpen) return;
        e.preventDefault();
        /* Same as the Next button: on the closing page it is the exit. */
        if (state.index >= state.total) book.close();
        else book.next();
      } else if (e.key === "ArrowLeft") {
        if (!state.isOpen || state.index <= 0) return;
        e.preventDefault();
        book.prev();
      } else if (e.key === "Escape") {
        if (!state.isOpen) return;
        e.preventDefault();
        book.close();
      } else if (e.key === "Enter" && !state.isOpen) {
        e.preventDefault();
        book.open();
      }
    });
  };

  Navigation.prototype._scrollables = function () {
    var faces = this.book.getVisibleFaces();
    var out = [];

    for (var i = 0; i < faces.length; i++) {
      var chapter = faces[i] && faces[i].querySelector(".chapter");
      if (chapter && chapter.scrollHeight - chapter.clientHeight > 2) out.push(chapter);
    }
    return out;
  };

  Navigation.prototype._swipeBlocked = function (dx) {
    var list = this._scrollables();
    if (!list.length) return false;

    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var max = el.scrollHeight - el.clientHeight;
      if (dx < 0 && el.scrollTop < max - 1) return true;
      if (dx > 0 && el.scrollTop > 1) return true;
    }
    return false;
  };

  Navigation.prototype._bindSwipe = function () {
    var self = this;
    var stage = this.ui.stage;
    if (!stage) return;

    var startX = 0;
    var startY = 0;
    var startedAt = 0;
    var tracking = false;

    function point(touch) {
      return { x: touch.clientX, y: touch.clientY };
    }

    stage.addEventListener(
      "touchstart",
      function (e) {
        if (e.touches.length !== 1) {
          tracking = false;
          return;
        }
        if (self.book.getState().isAnimating) {
          tracking = false;
          return;
        }
        var p = point(e.touches[0]);
        startX = p.x;
        startY = p.y;
        startedAt = Date.now();
        tracking = true;
      },
      { passive: true }
    );

    stage.addEventListener(
      "touchend",
      function (e) {
        if (!tracking) return;
        tracking = false;

        var touch = e.changedTouches[0];
        if (!touch) return;

        var dx = touch.clientX - startX;
        var dy = touch.clientY - startY;
        var elapsed = Date.now() - startedAt;

        if (elapsed > SWIPE_WINDOW) return;
        if (Math.abs(dx) < SWIPE_DISTANCE) return;
        if (Math.abs(dy) > Math.abs(dx) / SWIPE_SLOPE) return;
        if (self._swipeBlocked(dx)) return;

        var state = self.book.getState();
        if (!state.isOpen) {
          if (dx > 0) self.book.open();
          return;
        }

        if (dx < 0) self.book.next();
        else self.book.prev();
      },
      { passive: true }
    );

    stage.addEventListener("touchcancel", function () {
      tracking = false;
    }, { passive: true });
  };

  /* ------------------------------------------------------------------
     Page scrubber

     The ribbon at the bottom of the controls is a slider over the book's
     spreads. It reuses the book's own state: the value comes from
     Book._progress() and navigation goes through book.jumpTo(), so the bar
     can never disagree with the page.
     ------------------------------------------------------------------ */

  /* Fraction 0..1 across the track. Clamped and guarded because a pointer
     coordinate can be outside the element, and a bad value here would
     otherwise propagate into the book state as NaN. */
  Navigation.prototype._scrubFraction = function (clientX) {
    var bar = this.ui.ribbon;
    if (!bar) return 0;

    var r = bar.getBoundingClientRect();
    if (!r.width) return 0;

    var f = (clientX - r.left) / r.width;
    if (!isFinite(f)) return 0;
    if (f < 0) return 0;
    if (f > 1) return 1;
    return f;
  };

  Navigation.prototype._scrubIndex = function (clientX) {
    var total = this.book.state.total;
    if (!total) return 0;
    var index = Math.round(this._scrubFraction(clientX) * total);
    if (!isFinite(index)) return 0;
    if (index < 0) return 0;
    if (index > total) return total;
    return index;
  };

  Navigation.prototype._bindScrubber = function () {
    var self = this;
    var bar = this.ui.ribbon;
    if (!bar) return;

    var dragging = false;
    var pending = 0;
    var frame = 0;
    var lastX = 0;

    /* Only the visual state is written per move: two transform writes. The
       book is not touched until the pointer is released. */
    function paint(clientX) {
      var f = self._scrubFraction(clientX);
      if (self.ui.ribbonFill) {
        self.ui.ribbonFill.style.transform = "scaleX(" + f.toFixed(4) + ")";
      }
      if (self.ui.ribbonHandle) {
        self.ui.ribbonHandle.style.transform =
          "translate3d(" + (f * bar.clientWidth).toFixed(1) + "px, 0, 0)";
      }
    }

    /* One navigation per frame, and only the most recent target is honoured.
       A fast drag produces far more pointermove events than the book has
       turns, so the intermediate values are dropped instead of queued. */
    function flush() {
      frame = 0;
      if (pending === self.book.getState().index) return;

      var target = pending;
      pending = self.book.getState().index;
      self.book.jumpTo(target);
    }

    function schedule(target) {
      pending = target;
      if (frame) return;
      frame = global.requestAnimationFrame(flush);
    }

    bar.addEventListener("pointerdown", function (e) {
      if (!self.book.getState().isOpen) return;
      if (self.book.state.total <= 0) return;

      dragging = true;
      lastX = e.clientX;
      bar.dataset.active = "true";
      bar.setPointerCapture(e.pointerId);

      paint(e.clientX);
      pending = self._scrubIndex(e.clientX);
      schedule(pending);
      e.preventDefault();
    });

    bar.addEventListener("pointermove", function (e) {
      if (!dragging) {
        /* Hover emphasis only. No layout reads, no book calls. */
        return;
      }
      lastX = e.clientX;
      paint(e.clientX);
      schedule(self._scrubIndex(e.clientX));
      e.preventDefault();
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      bar.dataset.active = "false";
      if (frame) {
        global.cancelAnimationFrame(frame);
        frame = 0;
      }

      /* Land on the exact page under the pointer, whatever the last frame
         happened to be showing. */
      var goal = self._scrubIndex(e ? e.clientX : lastX);
      pending = goal;
      flush();

      try {
        bar.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* The pointer may already be gone on a cancelled touch. */
      }

      /* Paint from the book's own state so the handle cannot be left wherever
         the finger happened to end up. */
      self.render(self.book._progress());
      e.preventDefault();
    }

    bar.addEventListener("pointerup", endDrag);
    bar.addEventListener("pointercancel", endDrag);

    /* Keyboard. When the scrubber has focus the arrows adjust the scrubber, so
       they are handled here and the event is stopped before the document-level
       handler sees it. Without the stop, one key press would both move the
       scrubber and turn a page. Home and End are not bound anywhere else. */
    bar.addEventListener("keydown", function (e) {
      var state = self.book.getState();
      if (!state.isOpen) return;

      var handled = true;

      if (e.key === "Home") {
        self.book.jumpTo(0);
      } else if (e.key === "End") {
        self.book.jumpTo(state.total);
      } else if (e.key === "ArrowLeft") {
        self.book.prev();
      } else if (e.key === "ArrowRight") {
        self.book.next();
      } else if (e.key === "PageUp") {
        self.book.prev();
      } else if (e.key === "PageDown") {
        self.book.next();
      } else {
        handled = false;
      }

      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
  };

  Navigation.prototype.render = function (p) {
    var ui = this.ui;

    if (ui.controls) ui.controls.dataset.visible = p.isOpen ? "true" : "false";

    if (ui.chapterLabel) ui.chapterLabel.textContent = p.isOpen ? p.label : "BurnMyTongue";

    if (ui.folioLabel) {
      ui.folioLabel.textContent = p.isOpen ? p.folio : "—";
    }

    /* One place owns the scrubber's appearance, and it reads the same state
       object the buttons do. Dragging writes transforms directly while the
       finger is down, then hands back to render() on release. */
    if (ui.ribbonFill) {
      var pct = p.isOpen && p.total ? p.index / p.total : 0;
      ui.ribbonFill.style.transform = "scaleX(" + pct.toFixed(4) + ")";
    }

    if (ui.ribbonHandle) {
      var handleX = p.isOpen && p.total ? pct * ui.ribbon.clientWidth : 0;
      ui.ribbonHandle.style.transform = "translate3d(" + handleX.toFixed(1) + "px, 0, 0)";
    }

    if (ui.ribbon) {
      ui.ribbon.setAttribute("aria-disabled", p.isOpen ? "false" : "true");
      ui.ribbon.setAttribute("aria-valuemin", "0");
      ui.ribbon.setAttribute("aria-valuemax", String(Math.max(0, p.total)));
      ui.ribbon.setAttribute("aria-valuenow", String(p.isOpen ? p.index : 0));
      ui.ribbon.setAttribute("aria-valuetext", p.isOpen ? "Page " + p.folio : "Book closed");
    }

    /* Next stays enabled on the closing page so it can act as the exit; every
       other button follows the book state directly. */
    this._disabled(ui.btnNext, p.isAnimating || (!p.atLast && !p.canNext));
    this._disabled(ui.btnPrev, !p.canPrev || p.isAnimating);
    this._disabled(ui.btnOpen, p.isOpen || p.isAnimating);
    this._disabled(ui.btnClose, !p.isOpen || p.isAnimating);

    /* On the closing page there is nothing left to turn to, so Next becomes the
       way out: same button, same position, but it closes the book instead of
       doing nothing. The book is the only page, so closing is returning to the
       cover rather than navigating away. */
    if (ui.btnNext) {
      ui.btnNext.querySelector(".btn__label").textContent = p.atLast ? "Close the book" : "Next";
      ui.btnNext.querySelector(".btn__glyph").textContent = p.atLast ? "\u2715" : "\u25B6";
    }
  };

  Navigation.prototype._disabled = function (el, disabled) {
    if (el) el.disabled = !!disabled;
  };

  Navigation.prototype.announce = function (p) {
    if (!this.ui.announcer) return;
    this.ui.announcer.textContent = p.label + ", page " + p.folio;
  };

  global.BMT = global.BMT || {};
  global.BMT.Navigation = Navigation;
})(window);
