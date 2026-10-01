(function (global) {
  "use strict";

  function Emitter() {
    this._handlers = {};
  }

  Emitter.prototype.on = function (type, handler) {
    if (!this._handlers[type]) this._handlers[type] = [];
    this._handlers[type].push(handler);
    return this;
  };

  Emitter.prototype.off = function (type, handler) {
    var list = this._handlers[type];
    if (!list) return this;
    var index = list.indexOf(handler);
    if (index > -1) list.splice(index, 1);
    return this;
  };

  Emitter.prototype.emit = function (type, detail) {
    var list = this._handlers[type];
    if (!list) return;
    for (var i = 0; i < list.length; i++) list[i](detail);
  };

  function pause(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /* The real duration of an element's animation, read after every override has
     been applied. Under reduced motion this resolves to a millisecond, so waits
     are not spent on motion that never plays. */
  function motionMs(el) {
    if (!el || !global.getComputedStyle) return 0;

    var value = global.getComputedStyle(el).animationDuration;
    var first = (value || "").split(",")[0].trim();

    if (first.slice(-2) === "ms") return parseFloat(first) || 0;
    if (first.slice(-1) === "s") return (parseFloat(first) || 0) * 1000;
    return 0;
  }

  function folio(face, number, side) {
    var el = document.createElement("span");
    el.className = "folio folio--" + side;
    el.textContent = String(number);
    face.appendChild(el);
  }

  function Book(elements) {
    this.el = elements;
    this.emitter = new Emitter();
    this.animator = null;
    this.chapters = [];
    this.pages = [];
    this.leaves = [];
    this._settledIndex = null;
    /* The turn currently animating, if any. Held so an interrupted turn can be
       finished rather than left half-rotated. */
    this._active = null;

    this.state = {
      isOpen: false,
      isAnimating: false,
      index: 0,
      total: 0,
      direction: 0,
      layout: "spread"
    };
  }

  Book.prototype.setAnimator = function (animator) {
    this.animator = animator;
  };

  /* A chapter is a title page plus any number of text pages. Everything is
     flattened into one ordered list of pages, because the book turns pages,
     not chapters: spread k shows pages 2k and 2k+1, and leaf k carries the
     recto and verso of that pair. */
  Book.prototype._flatten = function () {
    var pages = [];
    var i, j;

    for (i = 0; i < this.chapters.length; i++) {
      var chapter = this.chapters[i];
      for (j = 0; j < chapter.faces.length; j++) {
        pages.push({ element: chapter.faces[j], title: chapter.title });
      }
    }

    var last = this.chapters[this.chapters.length - 1];
    if (last && last.end) {
      pages.push({ element: last.end, title: "The end" });
    }

    /* Pad to an even count so the closing leaf always ends on a recto, which is
       where the final page of a printed book belongs. */
    while (pages.length % 2 !== 0) {
      pages.push({ element: null, title: "The end" });
    }

    return pages;
  };

  Book.prototype.setChapters = function (chapters) {
    this.chapters = chapters;
    this.pages = this._flatten();
    /* A book of N pages has N/2 spreads, so N/2 - 1 is the last spread the
       reader can turn to. total is the furthest index, not the number of
       spreads: making it the spread count would leave the reader one turn past
       the end, looking at a blank leaf. */
    this.state.total = Math.max(0, this.pages.length / 2 - 1);
  };

  Book.prototype._reduced = function () {
    return !!(this.animator && this.animator.isReduced());
  };

  Book.prototype._after = function (el) {
    if (this._reduced()) return pause(40);

    return new Promise(function (resolve) {
      var settled = false;

      function done(e) {
        if (e && e.target !== el) return;
        if (settled) return;
        settled = true;
        el.removeEventListener("animationend", done);
        clearTimeout(timer);
        resolve();
      }

      /* animationend is the happy path. The timer is a floor, not a guess:
         it can never fire before the motion has had time to finish, but it
         keeps a dropped animation from stalling the book. */
      var timer = setTimeout(done, motionMs(el) + 200);

      el.addEventListener("animationend", done);
    });
  };

  Book.prototype.mount = function () {
    var el = this.el;
    var pages = this.pages;
    var spreads = pages.length / 2;

    el.slotLeft.innerHTML = "";
    el.slotRight.innerHTML = "";
    el.leaves.innerHTML = "";
    this.leaves = [];

    if (pages[0] && pages[0].element) {
      el.slotLeft.appendChild(pages[0].element);
      folio(el.slotLeft, 2, "left");
    }

    for (var k = 0; k < spreads; k++) {
      this.leaves.push(this._buildLeaf(pages, k));
      el.leaves.appendChild(this.leaves[k]);
    }

    this._settle();
    this.emitter.emit("book:progress", this._progress());
  };

  Book.prototype._buildLeaf = function (pages, k) {
    var leaf = document.createElement("div");
    leaf.className = "leaf";
    leaf.dataset.index = String(k);
    this._stack(leaf, k, false);

    var recto = pages[2 * k + 1];
    var verso = pages[2 * k + 2];

    var front = document.createElement("div");
    front.className = "leaf__face leaf__face--front";
    if (recto && recto.element) {
      front.appendChild(recto.element);
      folio(front, 2 * k + 3, "right");
    }

    var back = document.createElement("div");
    back.className = "leaf__face leaf__face--back";
    if (verso && verso.element) {
      back.appendChild(verso.element);
      folio(back, 2 * k + 4, "left");
    }

    leaf.appendChild(front);
    leaf.appendChild(back);
    return leaf;
  };

  Book.prototype._unturnedDepth = function (i) {
    return 0.4 + (this.state.total - 1 - i) * 0.4;
  };

  Book.prototype._turnedDepth = function (i) {
    return 1.8 + i * 0.55;
  };

  /* Owns the turned/open state of one leaf.

     is-turned is what actually puts a leaf on the left of the spine: it carries
     the rotateY(-180deg) that flips it over. Depth and z-index only order the
     stack. This function therefore sets all three together, so the class and the
     geometry can never disagree. When they did — a jump moving the index without
     moving the leaves — leaves were given turned-stack depth while still lying on
     the right, and the lowest one painted over the page the reader had jumped to,
     so every turn after it looked like the same page. */
  Book.prototype._stack = function (leaf, i, isTurned) {
    if (leaf.classList.contains("is-turned") !== isTurned) {
      leaf.classList.toggle("is-turned", isTurned);
    }

    leaf.style.setProperty(
      "--depth-to",
      (isTurned ? this._turnedDepth(i) : this._unturnedDepth(i)) + "px"
    );
    leaf.style.zIndex = isTurned ? 200 + i : 100 + (this.state.total - 1 - i);
  };

  /* Restacking every leaf on every turn wrote ~140 custom properties and
     z-index values per page, which is more style invalidation than the turn
     itself. Only the leaf that changed sides needs restacking, so the previous
     boundary is tracked and everything between the old and new one is skipped. */
  Book.prototype._restack = function (fromIndex) {
    var leaves = this.leaves;
    var first = Math.max(0, fromIndex);
    var last = Math.min(leaves.length - 1, this.state.index);

    for (var i = first; i <= last; i++) {
      var turned = i < this.state.index;
      this._stack(leaves[i], i, turned);
      leaves[i].setAttribute("aria-hidden", turned ? "true" : "false");
    }
  };

  Book.prototype._settle = function () {
    var s = this.state;
    var prev = this._settledIndex;

    this.el.slotLeft.classList.toggle("is-revealed", s.index === 0);
    this.el.slotLeft.classList.toggle("is-covered", s.index !== 0);
    this.el.slotLeft.setAttribute("aria-hidden", s.index === 0 ? "false" : "true");

    this.el.slotRight.classList.toggle("is-revealed", s.index > s.total);
    this.el.slotRight.classList.toggle("is-covered", s.index <= s.total);
    this.el.slotRight.setAttribute("aria-hidden", s.index > s.total ? "false" : "true");

    if (prev === null || prev === undefined) {
      for (var i = 0; i < this.leaves.length; i++) {
        var turned0 = i < s.index;
        this._stack(this.leaves[i], i, turned0);
        this.leaves[i].setAttribute("aria-hidden", turned0 ? "true" : "false");
      }
    } else if (prev < s.index) {
      this._restack(prev);
    } else if (prev > s.index) {
      this._restack(s.index);
    }

    this._settledIndex = s.index;
  };

  /* The recto of the spread on screen, or the last page once the book is done. */
  Book.prototype._rectoIndex = function () {
    var i = this.state.index;
    if (i < this.state.total) return 2 * i + 1;
    return this.pages.length - 1;
  };

  Book.prototype._progress = function () {
    var i = this.state.index;
    var atEnd = i >= this.state.total;
    var page = this.pages[this._rectoIndex()];

    return {
      index: i,
      total: this.state.total,
      isOpen: this.state.isOpen,
      isAnimating: this.state.isAnimating,
      canPrev: this.state.isOpen && i > 0,
      canNext: this.state.isOpen && !atEnd,
      atFirst: i === 0,
      atLast: atEnd,
      label: atEnd ? "The end" : (page ? page.title : ""),
      /* The last spread is the end page, so the usual recto numbering already
         lands on it: total is the spread before last, and 2 * total + 3 is the
         final printed number. */
      folio: String(2 * i + 3)
    };
  };

  Book.prototype.getState = function () {
    return {
      isOpen: this.state.isOpen,
      isAnimating: this.state.isAnimating,
      index: this.state.index,
      total: this.state.total,
      direction: this.state.direction
    };
  };

  Book.prototype.getVisibleFaces = function () {
    var s = this.state;
    var faces = [];

    if (s.index === 0) {
      faces.push(this.el.slotLeft);
    } else if (s.index <= s.total && this.leaves[s.index - 1]) {
      faces.push(this.leaves[s.index - 1].querySelector(".leaf__face--back"));
    }

    if (s.index <= s.total && this.leaves[s.index]) {
      faces.push(this.leaves[s.index].querySelector(".leaf__face--front"));
    } else {
      faces.push(this.el.slotRight);
    }

    if (s.layout === "single") faces = [faces[faces.length - 1]];
    return faces.filter(Boolean);
  };

  Book.prototype.setLayout = function (layout) {
    if (this.state.layout === layout) return;
    this.state.layout = layout;
    this.emitter.emit("book:layout", { layout: layout });
  };

  Book.prototype.open = function () {
    var self = this;
    if (this.state.isOpen || this.state.isAnimating) return Promise.resolve(false);

    this.state.isAnimating = true;
    this.emitter.emit("book:opening", this._progress());

    this.el.root.classList.add("is-opening");

    /* The interior is uncovered as the board swings past the spine, not when
       the animation ends, so the spread is already there to be revealed. */
    return pause(motionMs(this.el.cover) * 0.4)
      .then(function () {
        self.el.root.classList.add("is-revealing");
        self.state.isOpen = true;
        self._settle();
        self.emitter.emit("book:opened", self._progress());
        return self._after(self.el.cover);
      })
      .then(function () {
        self.el.root.classList.remove("is-opening");
        self.el.root.dataset.state = "open";
        self.state.isAnimating = false;
        self.emitter.emit("book:settled", self._progress());
        return true;
      });
  };

  Book.prototype.close = function () {
    var self = this;
    if (!this.state.isOpen || this.state.isAnimating) return Promise.resolve(false);

    this.state.isAnimating = true;
    this.emitter.emit("book:closing", this._progress());

    this.el.root.classList.add("is-closing");

    return this._after(this.el.cover)
      .then(function () {
        self.el.root.classList.remove("is-closing", "is-revealing");
        self.el.root.dataset.state = "closed";
        self.state.isOpen = false;
        self.state.isAnimating = false;
        self.emitter.emit("book:closed", self._progress());
        return true;
      });
  };

  /* The landing half of a turn, kept as its own function so a turn that is
     interrupted can be finished immediately instead of waiting for its
     animation to run out. The scrubber calls that on every drag step. */
  Book.prototype._completeTurn = function (turn) {
    /* The animation's own promise may still be pending after an interrupted
       turn has been retired by hand. It will call back when its timer ends, and
       that call must not turn the same leaf twice. */
    if (turn.done) return;
    turn.done = true;

    var leaf = turn.leaf;

    leaf.classList.remove("is-turning-forward", "is-turning-back", "is-settling");
    leaf.style.willChange = "auto";

    /* _stack sets is-turned as well as the depth and z-index, so the leaf lands
       in exactly the state its new position implies. */
    this._stack(leaf, turn.i, turn.direction > 0);

    if (!turn.isSingle) {
      var revealed = turn.direction > 0 ? this.leaves[turn.i + 1] : leaf;
      if (revealed) revealed.classList.add("is-revealed");
    }

    this.el.root.classList.remove("is-turning");
    this.el.turnShadow.classList.remove("is-active");

    this.state.index = turn.i + (turn.direction > 0 ? 1 : 0);
    this.state.isAnimating = false;
    this._active = null;

    /* _settle restacks from the previous index to this one, which is the leaf
       that just changed sides. Setting it here would skip that leaf, so it is
       left alone and _settle does the single update it needs. */
    this._settle();
  };

  Book.prototype._turn = function (i, direction) {
    var self = this;
    var leaf = this.leaves[i];
    var isSingle = this.state.layout === "single";
    var className = direction > 0 ? "is-turning-forward" : "is-turning-back";

    this.state.isAnimating = true;
    this.state.direction = direction;

    var turn = { leaf: leaf, i: i, direction: direction, isSingle: isSingle };
    this._active = turn;

    /* Every one of these writes is applied in the same task, before the browser
       has painted anything, so they collapse into a single style recalculation
       and a single frame. There is deliberately no rAF here: it would add a
       frame of delay before the leaf moves, which is exactly the lag being
       removed, and a turn must never be able to stall waiting on one. */
    leaf.style.setProperty(
      "--depth-from",
      (direction > 0 ? self._unturnedDepth(i) : self._turnedDepth(i)) + "px"
    );
    leaf.style.setProperty(
      "--depth-to",
      (direction > 0 ? self._turnedDepth(i) : self._unturnedDepth(i)) + "px"
    );

    leaf.style.zIndex = 450;
    leaf.classList.add(className);
    if (this._reduced()) leaf.classList.add("is-settling");

    this.el.root.classList.add("is-turning");
    this.el.turnShadow.dataset.cast = direction > 0 ? "right-page" : "left-page";
    this.el.turnShadow.classList.add("is-active");

    return this._after(leaf).then(function () {
      self._completeTurn(turn);
      self.emitter.emit("book:turned", self._progress());
      return true;
    });
  };

  Book.prototype.next = function () {
    if (!this.state.isOpen || this.state.isAnimating) return Promise.resolve(false);
    if (this.state.index >= this.state.total) return Promise.resolve(false);
    return this._turn(this.state.index, 1);
  };

  Book.prototype.prev = function () {
    if (!this.state.isOpen || this.state.isAnimating) return Promise.resolve(false);
    if (this.state.index <= 0) return Promise.resolve(false);
    return this._turn(this.state.index - 1, -1);
  };

  Book.prototype.goTo = function (target) {
    var self = this;
    var goal = Math.max(0, Math.min(this.state.total, target));

    function step() {
      if (self.state.index === goal) return Promise.resolve(true);
      if (self.state.index < goal) return self.next().then(step);
      return self.prev().then(step);
    }

    return step();
  };

  /* Lands on a spread directly.

     goTo walks there one animated turn at a time, which is right for the
     keyboard but wrong for the scrubber: dragging from page 3 to page 90 would
     try to run 87 animations in sequence. This finishes whatever turn is in
     flight, clears the animation lock, and then sets the index outright. No
     leaf rotates, so a long drag costs one style pass rather than ninety, and
     the final position is always exact.

     A one-page jump still gets the turn, because that is the reader pressing
     next and expecting a page to move. */
  Book.prototype.jumpTo = function (target) {
    if (!this.state.isOpen) return Promise.resolve(false);

    var goal = Math.round(target);
    if (!isFinite(goal)) return Promise.resolve(false);
    goal = Math.max(0, Math.min(this.state.total, goal));

    if (goal === this.state.index && !this._active) return Promise.resolve(true);

    /* Retire the interrupted turn at once: no animation is left running, so
       nothing can overlap. */
    if (this._active) this._completeTurn(this._active);

    var distance = Math.abs(goal - this.state.index);

    if (distance === 1) {
      return goal > this.state.index ? this.next() : this.prev();
    }

    /* Reveal the leaf on the spread being landed on, so its content settles in
       the same way it does after a turn. */
    /* Land on the spread. _settle now restacks and reclassifies every leaf that
       differs from the new index, so the stack and the page agree. */
    this._settledIndex = null;
    this.state.index = goal;
    this.state.isAnimating = false;
    this._settle();

    if (this.state.layout !== "single" && this.leaves[goal]) {
      this.leaves[goal].classList.add("is-revealed");
    }

    this.emitter.emit("book:turned", this._progress());
    return Promise.resolve(true);
  };

  global.BMT = global.BMT || {};
  global.BMT.Book = Book;
  global.BMT.Emitter = Emitter;
})(window);
