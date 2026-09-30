/* Account details use the current restaurant identity; no local-only profile edits. */
(function () {
  "use strict";
  const t = (text) => window.I18N?.t(text) || text;
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  let page,
    home,
    current = "",
    busy = false,
    profile,
    generation = 0, nameDraft = "", phoneNumber = "", phoneChallenge = null, resendAt = 0, phoneTimer;
  function dirty() {
    if (["phone", "phone-code"].includes(current)) return (page.querySelector("#phone-number")?.value ?? phoneNumber) !== String(profile?.phone || "") || nameDraft !== String(profile?.name || "");
    if (current === "password") return [...page.querySelectorAll("input")].some(input => input.value !== "");
    const name = page?.querySelector("#profile-name");
    return current === "profile" && name && name.value !== String(profile?.name ?? "");
  }
  function back() {
    if (!current) return false;
    if (busy) return true;
    if (current === "phone-code") { showPhone(); return true; }
    if (current === "phone") { renderProfile(nameDraft); return true; }
    if (dirty() && !confirm(t("Discard changes?"))) return true;
    clearInterval(phoneTimer);
    generation++;
    page.hidden = true;
    home.hidden = false;
    current = "";
    window.CaptainMe?.render();
    return true;
  }
  function field(label, id, type, value = "", autocomplete = "off") {
    return `<label class="profile-field">${esc(t(label))}<input class="ui-field" id="${id}" name="${id}" type="${type}" value="${esc(value)}" autocomplete="${autocomplete}" required></label>`;
  }
  function show(view) {
    if (busy) return;
    current = view;
    home.hidden = true;
    page.hidden = false;
    document.querySelector(".me-title").textContent = t(
      view === "password" ? "Change password" : "Profile details",
    );
    page.innerHTML =
      view === "password"
        ? `<form id="profile-form">${field("Current password", "currentPassword", "password", "", "current-password")}${field("New password", "newPassword", "password", "", "new-password")}${field("Confirm password", "confirmPassword", "password", "", "new-password")}<p class="me-note">${esc(t("Use at least 10 characters and repeat the new password."))}</p><p class="me-note">${esc(t("After changing your password, sign in again. Saved orders stay on this phone."))}</p>${actions()}</form>`
        : `<p role="status">${esc(t("Loading..."))}</p>`;
    if (view === "profile") void load();
  }
  function actions() {
    return `<p id="profile-message" role="status"></p><div class="profile-actions"><button type="button" data-profile-back class="profile-secondary">${esc(t("Cancel"))}</button><button class="profile-primary" type="submit">${esc(t("Save"))}</button></div>`;
  }
  async function load() {
    const requestGeneration = ++generation;
    try {
      const loaded = await POSNIC.api.get("/captain/v1/profile");
      if (current !== "profile" || requestGeneration !== generation) return;
      profile = loaded;
      renderProfile();
    } catch {
      if (current !== "profile" || requestGeneration !== generation) return;
      page.innerHTML = `<p role="status">${esc(t("Connection failed"))}</p><button type="button" class="profile-primary" data-profile-retry>${esc(t("Retry"))}</button>`;
    }
  }
  function renderProfile(name = profile.name) {
    clearInterval(phoneTimer);
    current = "profile";
    document.querySelector(".me-title").textContent = t("Profile details");
    page.innerHTML = `<form id="profile-form">${field("Name", "profile-name", "text", name, "name")}<div class="profile-detail"><span>${esc(t("Email"))}</span><strong translate="no">${esc(profile.email || "—")}</strong></div><div class="profile-detail"><span>${esc(t("Phone number"))}</span><strong translate="no">${esc(profile.phone || "—")}</strong><button type="button" class="profile-secondary" data-profile-phone>${esc(t("Change"))}</button></div>${actions()}</form>`;
    page.querySelector("input").maxLength = 100;
  }
  function phoneClock() {
    const button = page.querySelector('[data-phone-send],[data-phone-resend]');
    if (!button) return;
    const seconds = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
    const label = button.hasAttribute('data-phone-send') ? 'Send verification code' : 'Resend code';
    button.textContent = t(label) + (seconds ? ` (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')})` : '');
    button.disabled = busy || seconds > 0;
  }
  function showPhone(code = false) {
    clearInterval(phoneTimer);
    current = code ? "phone-code" : "phone";
    document.querySelector(".me-title").textContent = t(code ? "Code" : "Phone number");
    page.innerHTML = `<form id="phone-form">${code ? `<p translate="no" dir="ltr">${esc(phoneNumber)}</p>${field("Code", "phone-code", "text", "", "one-time-code")}` : `${field("Phone number", "phone-number", "tel", phoneNumber, "tel")}<p class="me-note">${esc(t("Enter a phone number with country code."))}</p>`}<p id="profile-message" role="status"></p><div class="profile-actions"><button type="button" class="profile-secondary" data-profile-back>${esc(t("Back"))}</button><button type="submit" class="profile-primary" ${code ? '' : 'data-phone-send'}>${esc(t(code ? "Continue" : "Send verification code"))}</button></div>${code ? `<button type="button" class="profile-secondary phone-resend" data-phone-resend>${esc(t("Resend code"))}</button>` : ''}</form>`;
    const input = page.querySelector('input');
    input.dir = 'ltr';
    if (code) { input.inputMode = 'numeric'; input.pattern = '[0-9]{6}'; input.maxLength = 6; }
    else { input.maxLength = 25; input.placeholder = '+919000000000'; }
    phoneClock(); phoneTimer = setInterval(phoneClock, 1000);
    if (code) input.focus();
  }
  async function phoneSubmit(resend = false) {
    if (busy) return;
    const verifying = current === 'phone-code' && !resend;
    if (!verifying && Date.now() < resendAt) return;
    if (!verifying && current === 'phone') phoneNumber = page.querySelector('#phone-number').value.replace(/[ ()-]/g, '');
    const message = page.querySelector('#profile-message');
    if (!verifying && !/^\+[1-9]\d{7,14}$/.test(phoneNumber)) { message.textContent = t('Enter a phone number with country code.'); return; }
    const body = verifying ? {challenge:phoneChallenge.challenge,code:page.querySelector('#phone-code').value} : {phone:phoneNumber};
    busy = true;
    page.querySelectorAll('button,input').forEach(node => node.disabled = true);
    message.textContent = t('Loading...');
    try {
      const result = await POSNIC.api.post('/captain/v1/profile/phone/' + (verifying ? 'verify' : 'start'), body);
      if (verifying) {
        if (result.saved !== true || result.phone !== phoneNumber) throw new Error('unconfirmed');
        profile.phone = result.phone;
        try { await POSNIC.session.updateProfile?.(profile); } catch { /* The server has saved the verified phone. */ }
        renderProfile(nameDraft);
        page.querySelector('#profile-message').textContent = t('Saved');
      } else {
        if (typeof result.challenge !== 'string' || !result.challenge || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error('unconfirmed');
        phoneChallenge = result;
        resendAt = Date.now() + Math.max(60, Number(result.retryAfter) || 60) * 1000;
        showPhone(true);
      }
    } catch (error) {
      if (error.status === 429) resendAt = Date.now() + 60000;
      if (verifying && error.status === 409) resendAt = 0;
      message.textContent = t(error.status === 404 ? 'This shop’s server is too old for this screen. Update POSNIC on the till.' : error.status === 400 ? 'Check the verification code.' : error.status === 409 ? 'Request a new verification code.' : error.status === 429 ? 'Resend code' : verifying ? 'Could not save. Please try again.' : 'Could not send the code. Check SMS settings or try again later.');
    } finally {
      busy = false;
      page.querySelectorAll('button,input').forEach(node => node.disabled = false);
      phoneClock();
    }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (["phone", "phone-code"].includes(current)) { void phoneSubmit(); return; }
    const values = Object.fromEntries(new FormData(event.target));
    const message = page.querySelector("#profile-message");
    const password = current === "password";
    if (password && new TextEncoder().encode(values.newPassword).length > 54) {
      message.textContent = t("Choose a shorter password.");
      return;
    }
    if (
      password &&
      (values.newPassword.length < 10 ||
        values.newPassword !== values.confirmPassword)
    ) {
      message.textContent = t(
        "Use at least 10 characters and repeat the new password.",
      );
      return;
    }
    busy = true;
    page
      .querySelectorAll("button,input")
      .forEach((node) => (node.disabled = true));
    message.textContent = t("Loading...");
    try {
      const result = await POSNIC.api.post(
        password ? "/captain/v1/password" : "/captain/v1/profile",
        password ? values : { name: values["profile-name"] },
      );
      if (password) {
        if (result.saved !== true) throw new Error("Unconfirmed");
        await POSNIC.session.end();
        // Preserve the restaurant cache and durable orders for the same user to resume.
        current = "";
        busy = false;
        location.href = "index.html";
      } else {
        profile = result;
        page.querySelector("#profile-name").value = result.name;
        await POSNIC.session.updateProfile?.(result);
        document.getElementById("me-who").textContent = result.name;
        document.getElementById("me-home-who").textContent = result.name;
        message.textContent = t("Saved");
      }
    } catch (error) {
      message.textContent = t(
        password && error.status === 400
          ? "The current password is incorrect."
          : "Could not save. Please try again.",
      );
    } finally {
      busy = false;
      page
        .querySelectorAll("button,input")
        .forEach((node) => (node.disabled = false));
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    home = document.querySelector(".me-body");
    page = document.createElement("main");
    page.classList.add("me-body", "profile-page");
    page.hidden = true;
    home.after(page);
    document
      .getElementById("me-profile")
      .addEventListener("click", () => show("profile"));
    document
      .getElementById("me-password")
      .addEventListener("click", () => show("password"));
    page.addEventListener("submit", submit);
    page.addEventListener("click", (event) => {
      if (event.target.closest("[data-profile-phone]") && !busy) { nameDraft = page.querySelector('#profile-name').value; phoneNumber = profile.phone || ''; phoneChallenge = null; showPhone(); }
      if (event.target.closest("[data-phone-resend]")) void phoneSubmit(true);
      if (event.target.closest("[data-profile-back]")) back();
      if (event.target.closest("[data-profile-retry]")) void load();
    });
  });
  window.addEventListener("captain:back", (event) => {
    if (current && !event.defaultPrevented) {
      event.preventDefault();
      back();
    }
  });
  window.addEventListener("beforeunload", event => {
    if (busy || dirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.CaptainProfile = { back, get active() { return Boolean(current); } };
})();
