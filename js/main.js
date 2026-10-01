(function (global) {
  "use strict";

  var doc = document;

  function query(selector) {
    return doc.querySelector(selector);
  }

  function parseManifest(raw) {
    return raw
      .split(";")
      .map(function (chunk) {
        var parts = chunk.split("|");
        return { path: (parts[0] || "").trim(), title: (parts[1] || "").trim() };
      })
      .filter(function (entry) {
        return entry.path;
      });
  }

  function readFragment(text) {
    var parsed = new DOMParser().parseFromString(text, "text/html");
    var nodes = parsed.querySelectorAll(".chapter");
    var out = { faces: [], end: null };

    for (var i = 0; i < nodes.length; i++) {
      var el = doc.importNode(nodes[i], true);
      if (el.classList.contains("chapter--end")) out.end = el;
      else out.faces.push(el);
    }

    if (!out.faces.length) {
      throw new Error("a chapter fragment needs at least one .chapter block");
    }

    return out;
  }

  function loadChapter(entry) {
    return global
      .fetch(entry.path, { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error(entry.path + " responded " + res.status);
        return res.text();
      })
      .then(function (text) {
        var parts = readFragment(text);

        if (!parts.faces.length || !parts.faces[0].classList.contains("chapter--opener")) {
          throw new Error(entry.path + " must begin with a .chapter--opener block");
        }

        return {
          title: entry.title,
          faces: parts.faces,
          end: parts.end
        };
      });
  }

  function showNotice(headline, body, command) {
    var notice = query("#notice");
    if (!notice) return;

    var title = notice.querySelector(".notice__title");
    var copy = query("#noticeBody");
    var code = query("#noticeCode");

    if (title) title.textContent = headline;
    if (copy) copy.textContent = body;
    if (code && command) code.textContent = command;
    if (code && !command) code.hidden = true;

    notice.hidden = false;
  }

  function boot() {
    var bookEl = query("#book");

    if (!bookEl || !global.BMT || !global.BMT.Book) {
      showNotice("The book could not start", "A required script failed to load. Check the js folder is complete.");
      return;
    }

    var manifest = parseManifest(bookEl.dataset.chapters || "");

    if (!manifest.length) {
      showNotice("The book has no chapters", "No reading order was declared on the book element.");
      return;
    }

    var book = new global.BMT.Book({
      root: bookEl,
      cover: query("#cover"),
      slotLeft: query("#slotLeft"),
      slotRight: query("#slotRight"),
      leaves: query("#leaves"),
      turnShadow: query("#turnShadow")
    });

    var animations = new global.BMT.Animations(book);
    book.setAnimator(animations);

    var music = new global.BMT.Music({
      audio: query("#bgMusic"),
      btnToggle: query("#btnMusic"),
      btnMute: query("#btnMute")
    });

    /* Navigation owns the music hooks, so it needs the instance. */
    var navigation = new global.BMT.Navigation(
      book,
      {
        stage: query("#stage"),
        controls: query("#controls"),
        cover: query("#cover"),
        btnOpen: query("#btnOpen"),
        btnClose: query("#btnClose"),
        btnPrev: query("#btnPrev"),
        btnNext: query("#btnNext"),
        chapterLabel: query("#chapterLabel"),
        folioLabel: query("#folioLabel"),
        ribbonFill: query("#ribbonFill"),
        ribbon: query("#ribbon"),
        ribbonHandle: query("#ribbonHandle"),
        announcer: query("#announcer")
      },
      music
    );

    var singlePage = global.matchMedia
      ? global.matchMedia("(max-width: 47.99em), (min-width: 48em) and (max-width: 63.99em) and (orientation: portrait)")
      : null;
    var applyLayout = function () {
      book.setLayout(singlePage && singlePage.matches ? "single" : "spread");
    };
    applyLayout();
    if (singlePage && singlePage.addEventListener) singlePage.addEventListener("change", applyLayout);

    Promise.all(manifest.map(loadChapter))
      .then(function (chapters) {
        book.setChapters(chapters);
        book.mount();
        navigation.init();
        music.init();

        doc.body.classList.remove("is-booting");
        global.BMT.book = book;

        /* Only restores a preference the reader set on a previous visit. On a
           first visit the Open button starts the music, which is the gesture
           browsers require. */
        var restore = function () {
          music.restore();
          doc.removeEventListener("pointerdown", restore, true);
          doc.removeEventListener("keydown", restore, true);
        };
        doc.addEventListener("pointerdown", restore, true);
        doc.addEventListener("keydown", restore, true);
      })
      .catch(function (error) {
        var local = global.location && global.location.protocol === "file:";
        if (local) {
          showNotice(
            "This book needs a local server",
            "Browsers block chapter loading on file://. Open a terminal in the project folder and run one of these, then reload:",
            "python -m http.server 8000"
          );
        } else {
          showNotice("A chapter could not be loaded", String(error && error.message ? error.message : error), "");
        }
        doc.body.classList.remove("is-booting");
      });
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
