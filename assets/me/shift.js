/* Explicit attendance actions only. Never enqueue, auto-end, or replay on a
 * different server. After an uncertain result, refresh before another action. */
(function () {
  'use strict';
  const at = id => document.getElementById(id);
  const t = text => window.I18N?.t(text) || text;
  let state = null, busy = false;
  const owner = () => JSON.stringify([POSNIC.session.shopKey, POSNIC.session.user?.id]);
  function message(text) { at('shift-status').textContent = t(text); }
  function controls() {
    ['shift-action', 'shift-refresh', 'shift-save', 'shift-enabled'].forEach(id => { at(id).disabled = busy; });
  }
  function failure(error) {
    at('shift-connect').hidden = error.code !== 'ATTENDANCE_WIFI_REQUIRED';
    const messages = {
      ATTENDANCE_WIFI_REQUIRED: 'Connect to the shop Wi-Fi to record your shift.',
      ATTENDANCE_DISABLED: 'Ask your manager to enable mobile attendance.',
      SHIFTS_DISABLED: 'Enable staff shifts in POS first.',
      SHIFT_ALREADY_OPEN: 'You already have an open shift. Refresh to see it.',
      MANAGER_REQUIRED: 'Permission is required.',
    };
    message(messages[error.code] || (error.status === 404
      ? 'Update the shop POS to use mobile attendance.'
      : 'Could not confirm your shift. Refresh before trying again.'));
  }
  async function load() {
    if (busy) return;
    busy = true; state = null; controls();
    at('shift-action').hidden = true; at('shift-settings').hidden = true;
    at('shift-connect').hidden = true;
    at('shift-time').textContent = '';
    at('shift-who').textContent = POSNIC.session.user?.name || POSNIC.session.user?.email || '';
    message('Loading...');
    const identity = owner();
    try {
      const result = await POSNIC.api.get('/captain/v1/attendance', { timeout: 7000 });
      if (identity !== owner()) return;
      if (typeof result.enabled !== 'boolean' || !('shift' in result)) throw new Error('invalid_response');
      state = result;
      at('shift-settings').hidden = result.canManage !== true;
      at('shift-enabled').checked = result.enabled;
      const shift = result.shift;
      message(shift ? 'On shift' : result.enabled ? 'Not on shift' : 'Ask your manager to enable mobile attendance.');
      if (shift) at('shift-time').textContent = new Date(shift.clockIn).toLocaleString();
      const otherBranch = shift && shift.branchId !== result.branchId;
      if (otherBranch) message('End your open shift at its original branch.');
      at('shift-action').hidden = otherBranch || (!shift && !result.enabled);
      at('shift-action').textContent = t(shift ? 'End shift' : 'Start shift');
    } catch (error) { failure(error); }
    finally { busy = false; controls(); }
  }
  async function act() {
    if (busy || !state) return;
    const shift = state.shift;
    if (shift && !window.confirm(t('End your shift now?'))) return;
    busy = true; controls(); message('Loading...');
    const identity = owner();
    try {
      const result = await POSNIC.api.post('/captain/v1/attendance', {
        action: shift ? 'end' : 'start', shiftId: shift?.id, requestId: crypto.randomUUID(),
      }, { timeout: 7000 });
      if (identity !== owner()) return;
      if (result.confirmed !== true || !result.shift?.id) throw new Error('unconfirmed');
      if (shift && result.shift.status === 'closed') {
        message('Shift ended');
        at('shift-time').textContent = new Date(result.shift.clockIn).toLocaleString() + ' – ' + new Date(result.shift.clockOut).toLocaleString();
        state = null; at('shift-action').hidden = true;
      } else { busy = false; await load(); }
    } catch (error) {
      state = null; at('shift-action').hidden = true; failure(error);
    } finally { busy = false; controls(); }
  }
  at('shift-refresh').onclick = load;
  at('shift-connect').onclick = () => at('me-server').click();
  at('shift-action').onclick = act;
  at('shift-save').onclick = async () => {
    if (busy || !state?.canManage) return;
    const value = at('shift-enabled').checked;
    busy = true; controls(); message('Loading...');
    try {
      const result = await POSNIC.api.post('/captain/v1/attendance/settings', { enabled: value }, { timeout: 7000 });
      if (result.saved !== true || result.enabled !== value) throw new Error('unconfirmed');
      busy = false; await load();
    } catch (error) { state = null; at('shift-action').hidden = true; failure(error); }
    finally { busy = false; controls(); }
  };
  window.addEventListener('hashchange', () => { if (location.hash === '#shift') void load(); });
  if (location.hash === '#shift') void load();
})();
