/* Lead capture for plain forms: sends every <form data-lead-form="name"> on the page to /api/lead as JSON and says
   how it went. Installed by the landing-page-lead-capture skill. No dependencies, no other host.

   Mark each form:   <form data-lead-form="demo" novalidate?>
   Optional words:   data-lead-sending="Sending..." data-lead-success="Thanks, we'll be in touch." data-lead-error="..."
   Optional place:   an element inside the form with data-lead-status shows the message (one is added if missing).
   A hidden field named hp, honeypot or _gotcha is the bot trap. Never name it "website": that is a real field.
   On success the form is reset and fires a "lead:sent" event; on failure the visitor can send again. */
(function () {
  "use strict";
  var ENDPOINT = "/api/lead";
  var PASS = ["src", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid", "msclkid"];
  var params = new URLSearchParams(location.search);

  function statusOf(form) {
    var el = form.querySelector("[data-lead-status]");
    if (!el) {
      el = document.createElement("p");
      el.setAttribute("data-lead-status", "");
      form.appendChild(el);
    }
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    return el;
  }

  // The form's fields as JSON: repeated names become lists, a lone checkbox becomes true or false
  function collect(form) {
    var data = {};
    new FormData(form).forEach(function (v, k) {
      if (typeof v !== "string") return;   // files are not sent
      if (Object.prototype.hasOwnProperty.call(data, k)) data[k] = [].concat(data[k], v); else data[k] = v;
    });
    var boxes = {};
    form.querySelectorAll("input[type=checkbox][name]").forEach(function (c) { boxes[c.name] = (boxes[c.name] || 0) + 1; });
    Object.keys(boxes).forEach(function (name) {
      if (boxes[name] !== 1) return;
      var c = form.querySelector('input[type=checkbox][name="' + name.replace(/"/g, '\\"') + '"]');
      data[name] = c.checked ? (c.value === "on" ? true : c.value) : false;
    });
    data.form = form.getAttribute("data-lead-form") || form.id || "default";
    data.page = location.href;
    if (document.referrer) data.referrer = document.referrer;
    PASS.forEach(function (k) { if (params.has(k)) data[k] = params.get(k); });
    return data;
  }

  function bind(form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (form.getAttribute("aria-busy") === "true") return;
      if (!form.noValidate && form.reportValidity && !form.reportValidity()) return;
      var msg = statusOf(form);
      var btn = form.querySelector('[type="submit"]');
      var trap = form.querySelector('[name="hp"], [name="honeypot"], [name="_gotcha"]');
      var say = function (text, ok) { msg.textContent = text; msg.setAttribute("data-state", ok ? "ok" : "error"); };
      if (trap && trap.value) { form.reset(); say(form.getAttribute("data-lead-success") || "Thanks, we'll be in touch.", true); return; }
      var data = collect(form);
      delete data.hp; delete data.honeypot; delete data._gotcha;
      form.setAttribute("aria-busy", "true");
      if (btn) btn.disabled = true;
      say(form.getAttribute("data-lead-sending") || "Sending...", true);
      var signal = window.AbortSignal && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined;
      fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(data), signal: signal })
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); })
        .then(function () {
          form.reset();
          say(form.getAttribute("data-lead-success") || "Thanks, we'll be in touch.", true);
          form.dispatchEvent(new CustomEvent("lead:sent", { bubbles: true, detail: { form: data.form } }));
        })
        .catch(function () {
          say(form.getAttribute("data-lead-error") || "That did not send. Please try again in a moment.", false);
        })
        .then(function () {
          form.removeAttribute("aria-busy");
          if (btn) btn.disabled = false;
        });
    });
  }

  document.querySelectorAll("form[data-lead-form]").forEach(bind);
})();
