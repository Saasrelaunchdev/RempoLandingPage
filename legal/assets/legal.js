/* Rempo legal pages. Your Privacy Choices: reads and writes the same choice the ad landing pages' cookie notice uses
   (localStorage "rm-consent", { v, ads: "granted" | "denied", at, src }), so a choice made here applies there at once.
   Global Privacy Control always wins: with it, nothing loads and "Allow" stays off. */
(function () {
  "use strict";
  var KEY = "rm-consent";
  var box = document.getElementById("choices");
  if (!box) return;
  var gpc = navigator.globalPrivacyControl === true;
  var now = document.getElementById("choice-now");
  var done = document.getElementById("choice-done");
  var buttons = Array.prototype.slice.call(box.querySelectorAll("[data-choice]"));
  var LABEL = {
    granted: "Allowed: advertising and analytics tools may load on our pages",
    denied: "Opted out: no sale or sharing, and advertising and analytics tools stay off"
  };
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function render() {
    var c = read();
    var ads = gpc ? "denied" : (c && LABEL[c.ads] ? c.ads : null);
    if (ads) now.textContent = LABEL[ads] + (gpc ? " (Global Privacy Control)" : c && c.at ? " (since " + new Date(c.at).toLocaleDateString() + ")" : "");
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-choice") === ads)); });
  }
  if (gpc) {
    document.getElementById("gpc-status").hidden = false;
    buttons.forEach(function (b) { if (b.getAttribute("data-choice") === "granted") b.disabled = true; });
  }
  buttons.forEach(function (b) {
    b.addEventListener("click", function () {
      var choice = b.getAttribute("data-choice");
      if (gpc && choice === "granted") return;
      var saved = write({ v: 1, ads: choice, at: new Date().toISOString(), src: "privacy-choices" });
      render();
      done.textContent = !saved
        ? "Your browser blocked storage, so we couldn't save this choice. Advertising and analytics tools stay off until you allow them."
        : choice === "denied" ? "Done. You're opted out on this browser." : "Done. Advertising and analytics tools may load on our pages.";
    });
  });
  render();
})();
