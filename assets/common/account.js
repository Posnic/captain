(function () {
  let changing = false;
  async function change(mode = "staff") {
    if (changing) return;
    const say = (text) =>
      typeof showErrorPopup === "function"
        ? showErrorPopup(text)
        : alert(window.I18N ? I18N.t(text) : text);
    if (window.OrderQueue?.all().length) {
      say(
        "Send saved orders before switching accounts. Connection settings remain available.",
      );
      return;
    }
    const cart =
      typeof getData === "function"
        ? await getData("cart").catch(() => [])
        : [];
    if (
      cart.length &&
      !confirm(window.I18N ? I18N.t("Discard changes?") : "Discard changes?")
    )
      return;
    changing = true;
    try {
      await POSNIC.session.end();
      localStorage.removeItem("user_id");
      sessionStorage.removeItem("posnic_editing_server");
      if (mode === "cloud") sessionStorage.setItem("posnic_change_server", "1");
      await clearKioskLocalCache({
        keepServer: true,
        redirectTo: "index.html",
      });
    } catch (error) {
      say(error.message);
    } finally {
      changing = false;
    }
  }
  window.CaptainAccount = { change };
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-account-change]");
    if (button) void change(button.dataset.accountChange);
  });
})();
