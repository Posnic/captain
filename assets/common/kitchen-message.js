(function (win) {
  "use strict";
  const t = (s) => win.I18N?.t(s) || s,
    el = (id) => document.getElementById(id);
  let owner,
    key,
    draft,
    recorder,
    busy = false,
    refreshing = null,
    leaving = false,
    sending = false;
  const identity = () =>
    JSON.stringify([
      win.POSNIC.session.shopKey,
      win.POSNIC.session.user?.id,
      localStorage.getItem("branch_id"),
    ]);
  function check() {
    if (identity() !== owner) throw Error(t("Sign in with your account"));
  }
  const api = async (action, body = {}) => {
    check();
    const result = await win.POSNIC.api.post(
      "/captain/v1/kitchen-audio/" + action,
      body,
      { timeout: 15000 },
    );
    check();
    return result;
  };
  function save(value = draft) {
    check();
    localStorage.setItem(key, JSON.stringify(value));
  }
  function error(e) {
    el("voice-error").textContent = [
      "NotAllowedError",
      "NotFoundError",
      "NotReadableError",
    ].includes(e?.name)
      ? t("Microphone unavailable. Check app permissions.")
      : e?.message || t("Could not save. Please try again.");
  }
  const icons = {
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="m8 4 12 8-12 8Z"/>',
    send: '<path d="m3 3 19 9-19 9 4-9-4-9ZM7 12h15"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
  };
  function button(id, icon, label) {
    const node = el(id);
    node.setAttribute("aria-label", t(label));
    node.title = t(label);
    if (node.dataset.icon !== icon) {
      node.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[icon] + "</svg>";
      node.dataset.icon = icon;
    }
  }
  function render() {
    const recording = recorder?.state === "recording";
    const working =
      busy || sending || ["opening", "saving"].includes(recorder?.state);
    const duration = recorder?.elapsed() || draft?.duration || 0;
    button(
      "voice-record",
      recording ? "pause" : "mic",
      recording
        ? "Pause recording"
        : draft
          ? "Resume recording"
          : "Record voice note",
    );
    button(
      "voice-discard",
      draft?.sent ? "close" : "trash",
      draft?.sent ? "Close" : "Discard recording",
    );
    button("voice-send", "send", "Send to kitchen");
    const audio = el("voice-preview");
    button(
      "voice-play",
      audio.paused ? "play" : "pause",
      audio.paused ? "Play recording" : "Pause playback",
    );
    el("voice-record").hidden = !!draft?.sent;
    el("voice-record").disabled =
      working || !!draft?.id || (!recording && duration >= 30000);
    el("voice-send").hidden = (!draft && !recording) || !!draft?.sent;
    el("voice-send").disabled = working;
    el("voice-discard").hidden = !draft && !recording;
    el("voice-discard").disabled = working;
    el("voice-play").hidden = !draft?.data || recording;
    el("voice-play").disabled = working;
    if (audio.getAttribute("src") !== (draft?.data || ""))
      audio.src = draft?.data || "";
    const seconds = Math.floor(
      (!audio.paused ? audio.currentTime * 1000 : duration) / 1000,
    );
    el("voice-duration").textContent =
      Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
    el("voice-composer").dataset.recording = String(recording);
    const canvas = el("voice-wave"),
      ctx = canvas.getContext("2d"),
      peaks = recorder?.peaks?.length ? recorder.peaks : draft?.peaks || [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = getComputedStyle(canvas).color;
    for (let i = 0; i < 48; i++) {
      const height = Math.min(
        canvas.height,
        Math.max(3, (peaks[i] || 0.04) * canvas.height * 3),
      );
      ctx.fillRect(i * 5 + 1, (canvas.height - height) / 2, 3, height);
    }
    const status = t(
      recording
        ? "Recording…"
        : draft?.complete
          ? "Playback completed"
          : draft?.sent
            ? "Queued for playback"
            : draft
              ? "Voice note saved on this phone"
              : "Tap to record, then review and send.",
    );
    if (el("voice-status").textContent !== status) el("voice-status").textContent = status;
  }
  function stop() {
    return recorder?.pause() || Promise.resolve(true);
  }
  async function record() {
    if (busy || sending || leaving || draft?.id) return;
    el("voice-error").textContent = "";
    try {
      check();
      el("voice-preview").pause();
      if (recorder.state === "recording") await stop();
      else await recorder.start();
    } catch (e) {
      error(e);
    }
  }
  async function send() {
    if (busy || sending || draft?.sent) return;
    sending = true;
    render();
    const saved = await stop();
    if (saved === false || !draft) {
      sending = false;
      render();
      return;
    }
    el("voice-preview").pause();
    busy = true;
    el("voice-error").textContent = "";
    render();
    try {
      check();
      save();
      // Persist the session before uploading so an ambiguous response retries the same message.
      if (!draft.id) {
        const session = await api("start");
        if (!session?.id) throw Error(t("Could not save. Please try again."));
        draft.id = session.id;
        save();
      }
      const result = await api("voice", { id: draft.id, data: draft.data });
      if (result?.id !== draft.id || !result.queued)
        throw Error(t("Could not save. Please try again."));
      draft.sent = true;
      save();
      await refresh();
    } catch (e) {
      error(e);
    } finally {
      busy = false;
      sending = false;
      render();
    }
  }
  function refresh() {
    if (refreshing) return refreshing;
    el("voice-refresh").disabled = true;
    refreshing = (async () => {
      try {
        const result = await api("status");
        if (
          draft?.sent &&
          result.jobs?.some((job) => job.id === draft.id && job.complete)
        ) {
          draft.complete = true;
          save();
          render();
        }
        const host = el("voice-history");
        host.replaceChildren();
        for (const job of result.jobs || []) {
          const row = document.createElement("div");
          row.className = "voice-history-item";
          const title = document.createElement("strong");
          title.textContent = t(
            job.complete ? "Playback completed" : "Queued for playback",
          );
          row.append(title);
          for (const target of job.targets || []) {
            const p = document.createElement("p");
            p.textContent = target.label + " · " + t(target.status);
            row.append(p);
          }
          host.append(row);
        }
        el("voice-error").textContent = "";
        return true;
      } catch (e) {
        error(e);
        return false;
      } finally {
        refreshing = null;
        el("voice-refresh").disabled = false;
      }
    })();
    return refreshing;
  }
  async function back(event) {
    event?.preventDefault();
    event?.stopImmediatePropagation();
    if (busy || sending || leaving) return;
    leaving = true;
    // Finish saving a recording before navigation; returning restores this staff member's draft.
    const saved = await stop();
    if (saved === false) {
      leaving = false;
      return;
    }
    try {
      if (draft) save();
    } catch (e) {
      error(e);
      leaving = false;
      return;
    }
    win.location.assign("kot-management.html");
  }
  async function init() {
    try {
      await win.POSNIC.session.whenReady?.();
      if (
        !win.POSNIC.session.user?.id ||
        !win.POSNIC.session.shopKey ||
        !localStorage.getItem("branch_id")
      )
        throw Error(t("Sign in with your account"));
      owner = identity();
      key = "posnic.kitchen-voice:" + owner;
      draft = JSON.parse(localStorage.getItem(key) || "null");
      recorder = new win.CaptainVoiceRecorder({
        initial: draft,
        saved: async (value) => {
          check();
          const next = { ...value, created: draft?.created || Date.now() };
          save(next);
          draft = next;
        },
        changed: render,
        error,
      });
      render();
      el("voice-play").onclick = async () => {
        const audio = el("voice-preview");
        try {
          if (audio.paused) await audio.play();
          else audio.pause();
        } catch {
          error(Error(t("Recording failed. Please record again.")));
        }
        render();
      };
      for (const event of ["play", "pause", "ended", "timeupdate"])
        el("voice-preview").addEventListener(event, render);
      el("voice-record").onclick = record;
      el("voice-send").onclick = send;
      if (!win.MobileGestures) el("voice-refresh").onclick = refresh;
      win.MobileGestures?.setRefresh(refresh);
      document.querySelector(".me-back").onclick = back;
      win.addEventListener("captain:back", back, true);
      el("voice-discard").onclick = async () => {
        if (busy || sending) return;
        try {
          check();
          el("voice-preview").pause();
          await recorder.discard();
          localStorage.removeItem(key);
          draft = null;
          render();
        } catch (e) {
          error(e);
        }
      };
      await refresh();
    } catch (e) {
      error(e);
      el("voice-record").disabled = true;
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  win.addEventListener("pagehide", stop);
  init();
})(window);
