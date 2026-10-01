(function (global) {
  "use strict";

  var PLAY_KEY = "bmt:music";
  var MUTE_KEY = "bmt:muted";
  /* Low enough to sit under the reading without ever competing with it. */
  var VOLUME = 0.35;

  function read(key) {
    try {
      return global.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function write(key, value) {
    try {
      global.localStorage.setItem(key, value);
    } catch (e) {
      /* storage unavailable, preference simply will not persist */
    }
  }

  function Music(elements) {
    this.audio = elements.audio;
    this.btnToggle = elements.btnToggle;
    this.btnMute = elements.btnMute;
    this.ready = false;
  }

  Music.prototype.init = function () {
    if (!this.audio) return;

    var self = this;
    var source = this.audio.getAttribute("src");

    this.audio.volume = VOLUME;
    this.audio.muted = read(MUTE_KEY) === "1";

    this.audio.addEventListener("error", function () {
      self._unavailable();
    });

    this.btnToggle.addEventListener("click", function () {
      self.toggle();
    });

    this.btnMute.addEventListener("click", function () {
      self.toggleMute();
    });

    this._sync();

    this._probe(source).then(function (exists) {
      if (exists === false) self._unavailable();
      else self.ready = true;
    });
  };

  Music.prototype._probe = function (source) {
    if (!source || !global.fetch) return Promise.resolve(null);
    if (global.location && global.location.protocol === "file:") return Promise.resolve(null);

    return global
      .fetch(source, { method: "HEAD" })
      .then(function (res) {
        return res.ok;
      })
      .catch(function () {
        return null;
      });
  };

  Music.prototype._unavailable = function () {
    this.ready = false;
    if (this.btnToggle) this.btnToggle.hidden = true;
    if (this.btnMute) this.btnMute.hidden = true;
  };

  Music.prototype.isPlaying = function () {
    return !!this.audio && !this.audio.paused && !this.audio.ended;
  };

  Music.prototype.play = function () {
    var self = this;
    if (!this.audio) return Promise.resolve(false);

    var attempt = this.audio.play();
    if (!attempt || typeof attempt.then !== "function") return Promise.resolve(true);

    return attempt.then(
      function () {
        self._sync();
        return true;
      },
      function () {
        self._sync();
        return false;
      }
    );
  };

  Music.prototype.pause = function () {
    if (!this.audio) return;
    this.audio.pause();
    this._sync();
  };

  Music.prototype.toggle = function () {
    if (!this.audio) return;

    if (this.isPlaying()) {
      this._userPaused = true;
      this.pause();
      write(PLAY_KEY, "off");
      return;
    }

    var self = this;
    this._userPaused = false;
    this.play().then(function (ok) {
      write(PLAY_KEY, ok ? "on" : "off");
      self._sync();
    });
  };

  Music.prototype.toggleMute = function () {
    if (!this.audio) return;
    this.audio.muted = !this.audio.muted;
    write(MUTE_KEY, this.audio.muted ? "1" : "0");
    this._sync();
  };

  Music.prototype._sync = function () {
    var playing = this.isPlaying();

    if (this.btnToggle) {
      this.btnToggle.setAttribute("aria-pressed", playing ? "true" : "false");
      this.btnToggle.querySelector(".btn__label").textContent = playing ? "Pause" : "Play music";
    }

    if (this.btnMute) {
      this.btnMute.setAttribute("aria-pressed", this.audio && this.audio.muted ? "true" : "false");
      this.btnMute.querySelector(".btn__label").textContent =
        this.audio && this.audio.muted ? "Unmute" : "Mute";
    }
  };

  /* Started when the reader opens the book.

     The Open button is the user gesture browsers require before audio may begin,
     so play() is called from that click and nowhere else. Nothing in page
     navigation touches this module: Next, Previous and the scrubber cannot
     restart or interrupt the track, because they never reach it. */
  Music.prototype.onBookOpen = function () {
    if (this._userPaused) return;
    this.play();
  };

  /* Stops and rewinds when the book is closed, so reopening starts the song
     from the top. */
  Music.prototype.onBookClose = function () {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.currentTime = 0;
    this._sync();
  };

  Music.prototype.restore = function () {
    if (read(PLAY_KEY) === "off") this._userPaused = true;
    if (read(PLAY_KEY) !== "on") return;
    var self = this;
    this.play().then(function (ok) {
      if (!ok) write(PLAY_KEY, "off");
      self._sync();
    });
  };

  global.BMT = global.BMT || {};
  global.BMT.Music = Music;
})(window);
