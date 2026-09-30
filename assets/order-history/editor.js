/* The item review is the main screen. Less frequent changes have their own steps. */
(function () {
    'use strict';
    const byId = id => document.getElementById(id);
    let view = 'items', setting = '', beforeSetting = null, initial = null;
    let originalLines = new WeakSet(), saving = false, saved = false, cancelling = false;
    let ownsHistory = false;
    const historyKey = 'captainOrderEditor';
    const selected = name => document.querySelector('input[name="' + name + '"]:checked');
    const order = () => orderBeingModified();
    function details() {
        const table = selected('edit_table_no');
        return {
            type: selected('edit_dine_type')?.value || order()?.dine_type || 'Dine-in',
            tableRadio: table?.id || '',
            table: table?.id === 'edit_table_manual_radio' ? byId('edit_manual_table_input').value.trim().toUpperCase() : table?.value || order()?.table_number || order()?.kiosk_table_no || '',
            manual: byId('edit_manual_table_input')?.value || '',
            guests: order()?.person_count || 1,
        };
    }
    function fingerprint() {
        return JSON.stringify({ details: details(), items: order()?.items || [] });
    }
    function restore(value) {
        document.querySelectorAll('input[name="edit_dine_type"]').forEach(input => input.checked = input.value === value.type);
        document.querySelectorAll('input[name="edit_table_no"]').forEach(input => input.checked = input.id === value.tableRadio);
        if (byId('edit_manual_table_input')) byId('edit_manual_table_input').value = value.manual;
        setEditPersonCount(value.guests);
    }
    function show(next) {
        view = next;
        for (const name of ['items', 'details', 'settings']) byId('order-editor-' + name).hidden = name !== next;
        document.querySelector('#editOrderModal .editor-footer').hidden = next !== 'items';
        refresh();
        const target = next === 'items' ? byId('open-item-picker') : next === 'details' ? document.querySelector('[data-editor-setting]:not([hidden])') : byId('editor-setting-back');
        target?.focus({ preventScroll: true });
        document.querySelector('#editOrderModal .modal-body').scrollTop = 0;
    }
    function typeChanged() {
        if (view !== 'settings') return;
        byId('edit-type-section').hidden = setting !== 'type';
        // Converting a takeaway to dine-in includes choosing its destination.
        const tableNeeded = setting === 'table' || (setting === 'type' && details().type === 'Dine-in');
        byId('edit-table-section').hidden = !tableNeeded;
        byId('edit-pax-section').hidden = setting !== 'guests';
        byId('edit-table-section').style.display = '';
        byId('edit-pax-section').style.display = '';
    }
    function refresh() {
        if (!byId('order-editor-items') || !order()) return;
        const value = details(), dineIn = value.type === 'Dine-in';
        byId('order-editor-context').textContent = dineIn && value.table ? 'Table ' + value.table : 'Takeaway';
        const type = document.createElement('span'); type.textContent = value.type;
        const guests = document.createElement('span'); guests.textContent = 'Guests';
        byId('order-editor-meta').replaceChildren(type);
        if (dineIn) byId('order-editor-meta').append(document.createTextNode(' · ' + value.guests + ' '), guests);
        byId('editor-table-value').textContent = value.table;
        byId('editor-guests-value').textContent = value.guests;
        byId('editor-type-value').textContent = value.type;
        document.querySelector('[data-editor-setting="table"]').hidden = !dineIn;
        document.querySelector('[data-editor-setting="guests"]').hidden = !dineIn;
        const count = (order().items || []).filter(item => !lineIsCancelled(item, order())).reduce((sum, item) => sum + Number(item.quantity || item.item_quantity || 0), 0);
        for (const prefix of ['editor', 'picker']) {
            byId(prefix + '-item-count').textContent = count === 1 ? '1 item' : count + ' items';
            byId(prefix + '-total-value').textContent = CaptainMoney.display(order().total_amount || 0);
        }
        byId('cancel-order-changes').disabled = saving;
        byId('save-order-changes').disabled = saving || (initial !== null && initial === fingerprint());
    }
    function begin() {
        saved = false; saving = false; beforeSetting = null;
        originalLines = new WeakSet(order()?.items || []);
        initial = fingerprint();
        show('items');
    }
    function openSetting(name) {
        setting = name; beforeSetting = details();
        byId('editor-setting-title').textContent = { table: 'Move table', guests: 'Guests', type: 'Order Type' }[name];
        show('settings'); typeChanged();
    }
    function back() {
        if (beforeSetting) restore(beforeSetting);
        beforeSetting = null;
        show('details');
    }
    function apply() {
        const value = details();
        if (value.type === 'Dine-in' && !value.table) {
            showToast('Choose a table first.', 'error'); return;
        }
        if (value.type === 'Dine-in' && value.tableRadio === 'edit_table_manual_radio' && !/^[A-Z0-9]{1,6}$/.test(value.table)) {
            showToast('Table must be 1–6 letters/numbers (A–Z, 0–9).', 'error'); return;
        }
        beforeSetting = null;
        show('items');
    }
    function cancel() {
        if (saving) return;
        if (initial !== null && fingerprint() !== initial && !window.confirm(window.I18N ? I18N.t('Discard changes?') : 'Discard changes?')) return;
        cancelling = true;
        bootstrap.Modal.getInstance(byId('editOrderModal'))?.hide();
        cancelling = false;
    }
    document.addEventListener('click', event => {
        if (event.target.closest('#cancel-order-changes')) cancel();
        if (event.target.closest('#order-editor-details-open')) show('details');
        const action = event.target.closest('[data-editor-setting]');
        if (action) openSetting(action.dataset.editorSetting);
        if (event.target.closest('[data-editor-view="items"]')) show('items');
        if (event.target.closest('#editor-setting-back')) back();
        if (event.target.closest('#editor-setting-apply')) apply();
    });
    document.addEventListener('DOMContentLoaded', () => {
        const modal = byId('editOrderModal');
        if (!modal) return;
        modal.addEventListener('show.bs.modal', () => {
            if (ownsHistory) return;
            history.pushState({ ...history.state, [historyKey]: true }, '', location.href);
            ownsHistory = true;
        });
        window.addEventListener('popstate', () => {
            if (!ownsHistory || !modal.classList.contains('show')) return;
            ownsHistory = false;
            bootstrap.Modal.getInstance(modal)?.hide();
            // A nested step or a declined discard consumes Back without leaving the draft.
            if (modal.classList.contains('show')) {
                history.pushState({ ...history.state, [historyKey]: true }, '', location.href);
                ownsHistory = true;
            }
        });
        window.addEventListener('captain:back', event => {
            if (event.defaultPrevented || document.querySelector('dialog[open], #posnic-lock.is-open') || !modal.classList.contains('show')) return;
            event.preventDefault();
            const nested = [...document.querySelectorAll('.modal.show')].filter(node => node !== modal).pop();
            bootstrap.Modal.getInstance(nested || modal)?.hide();
        });
        modal.addEventListener('hide.bs.modal', event => {
            if (saved || cancelling) return;
            if (saving) { event.preventDefault(); return; }
            if (!byId('item-picker').hidden) { event.preventDefault(); closeItemPicker(); return; }
            if (view === 'settings') { event.preventDefault(); back(); return; }
            if (view === 'details') { event.preventDefault(); show('items'); return; }
            if (initial !== null && fingerprint() !== initial && !window.confirm(window.I18N ? I18N.t('Discard changes?') : 'Discard changes?')) event.preventDefault();
        });
        modal.addEventListener('hidden.bs.modal', () => {
            if (ownsHistory && history.state?.[historyKey]) { ownsHistory = false; history.back(); }
            initial = null;
            setOrderBeingModified(null);
            if (!byId('orderDetailsModal')?.classList.contains('show')) currentOrderId = null;
            closeItemPicker();
        });
    });
    window.OrderEditor = {
        begin, refresh, typeChanged,
        isAdded: item => initial !== null && !originalLines.has(item),
        setSaving(value) { saving = value; refresh(); },
        saved() { saved = true; },
    };
})();
