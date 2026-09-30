(function (win) {
  "use strict";
  const t = (s) => win.I18N?.t(s) || s,
    el = (id) => document.getElementById(id);
  let owner,
    key,
    draft,
    recorder,
    stream,
    timer,
    busy = false,
    opening = false,
    refreshing = null,
    leaving = false,
    stopPending = null;
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
  function save() {
    check();
    localStorage.setItem(key, JSON.stringify(draft));
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
  function render() {
    const recording = recorder?.state === "recording";
    el("voice-record").hidden = !!draft;
    el("voice-record").disabled = busy || opening;
    el("voice-record").textContent = t(
      recording ? "Stop recording" : "Record voice note",
    );
    el("voice-send").hidden = !draft || !!draft.sent;
    el("voice-send").disabled = busy;
    el("voice-discard").hidden = !draft;
    el("voice-discard").disabled = busy;
    el("voice-discard").textContent = t(
      draft?.sent ? "Close" : "Discard recording",
    );
    el("voice-preview").hidden = !draft?.data;
    if (el("voice-preview").getAttribute("src") !== (draft?.data || ""))
      el("voice-preview").src = draft?.data || "";
    el("voice-status").textContent = t(
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
  }
  function stop() {
    clearTimeout(timer);
    if (recorder?.state === "recording") recorder.stop();
    stream?.getTracks().forEach((track) => track.stop());
    return stopPending || Promise.resolve();
  }
  async function record() {
    if (busy || opening || leaving) return;
    if (recorder?.state === "recording") {
      stop();
      return;
    }
    opening = true;
    render();
    el("voice-error").textContent = "";
    try {
      check();
      if (!navigator.mediaDevices?.getUserMedia || !win.MediaRecorder)
        throw Error(t("Microphone unavailable. Check app permissions."));
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      check();
      if (document.hidden || leaving) {
        stop();
        return;
      }
      const parts = [];
      recorder = new MediaRecorder(stream, { audioBitsPerSecond: 32000 });
      recorder.ondataavailable = (e) => {
        if (e.data.size) parts.push(e.data);
      };
      recorder.onerror = () => {
        error(Error(t("Microphone unavailable. Check app permissions.")));
        stop();
      };
      let finishStop;
      stopPending = new Promise((resolve) => {
        finishStop = resolve;
      });
      recorder.onstop = async () => {
        let saved = false;
        stream?.getTracks().forEach((track) => track.stop());
        busy = true;
        render();
        try {
          const blob = new Blob(parts, { type: recorder.mimeType });
          if (!blob.size || blob.size > 1000000)
            throw Error(t("Recording failed. Please record again."));
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          check();
          draft = { data, created: Date.now() };
          save();
          saved = true;
        } catch (e) {
          error(e);
        } finally {
          busy = false;
          recorder = null;
          render();
          finishStop(saved);
          stopPending = null;
        }
      };
      recorder.start();
      timer = setTimeout(stop, 30000);
    } catch (e) {
      stop();
      error(e);
    } finally {
      opening = false;
      render();
    }
  }
  async function send() {
    if (busy || !draft || draft.sent) return;
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
    if (busy || leaving) return;
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
      render();
      el("voice-record").onclick = record;
      el("voice-send").onclick = send;
      if (!win.MobileGestures) el("voice-refresh").onclick = refresh;
      win.MobileGestures?.setRefresh(refresh);
      document.querySelector(".me-back").onclick = back;
      win.addEventListener("captain:back", back, true);
      el("voice-discard").onclick = () => {
        if (busy) return;
        check();
        localStorage.removeItem(key);
        draft = null;
        render();
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
