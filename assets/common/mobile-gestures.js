/* Shared mobile interactions. Pull only at the top; never compete with
 * typing, nested scrolling, dialogs, multi-touch, or system edge gestures. */
(function () {
    let refreshAction, pending = null, gesture = null, hideTimer, suppressClickUntil = 0;
    let indicator, symbol, message;
    const visible = node => node && node.getClientRects().length > 0;
    const overlayOpen = () => [...document.querySelectorAll(
        '.modal.show, dialog[open], .notes-modal, #menu-index:not([hidden]), #item-picker:not([hidden]), .cart-sheet.open, #kot-sliding-panel.open'
    )].some(visible);
    const editing = () => document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
    function atTop(target) {
        for (let node = target; node && node !== document; node = node.parentElement) {
            if (node.scrollTop > 1) return false;
        }
        return (document.scrollingElement?.scrollTop || 0) <= 1;
    }
    function show(state, distance = 56) {
        clearTimeout(hideTimer);
        indicator.hidden = false;
        if (indicator.dataset.state !== state) indicator.dataset.state = state;
        indicator.style.setProperty('--pull-distance', Math.min(distance, 72) + 'px');
        symbol.textContent = {pull:'↓', ready:'↻', loading:'↻', done:'✓', error:'!'}[state];
        const text = state === 'loading' ? 'Loading' : state === 'done' ? 'Done' : state === 'error' ? 'Connection failed' : 'Refresh';
        const translated = window.I18N ? I18N.t(text) : text;
        if (message.textContent !== translated) message.textContent = translated;
    }
    function reset() {
        if (gesture?.sheet) gesture.sheet.style.transform = '';
        gesture = null;
        if (!pending) indicator.hidden = true;
    }
    function refresh() {
        if (pending) return pending;
        if (!refreshAction || overlayOpen()) return Promise.resolve(false);
        show('loading');
        const buttons = [...document.querySelectorAll('[data-mobile-refresh]')];
        buttons.forEach(button => { button.disabled = true; button.setAttribute('aria-busy', 'true'); });
        pending = Promise.resolve().then(refreshAction).then(result => {
            show(result === false ? 'error' : 'done');
            return result !== false;
        }, error => {
            console.warn('Refresh failed', error);
            show('error');
            return false;
        }).finally(() => {
            pending = null;
            buttons.forEach(button => { button.disabled = false; button.removeAttribute('aria-busy'); });
            hideTimer = setTimeout(() => { indicator.hidden = true; }, 1600);
        });
        return pending;
    }
    window.MobileGestures = { refresh };
    document.addEventListener('DOMContentLoaded', () => {
        const path = location.pathname;
        if (path.endsWith('kot-management.html')) refreshAction = () => loadTables();
        else if (path.endsWith('order-history.html')) refreshAction = () => loadOrderHistory({background:true});
        else if (path.endsWith('products.html')) refreshAction = () => refreshProductsPage(null);
        if (refreshAction) document.documentElement.classList.add('mobile-refresh-enabled');
        indicator = document.createElement('div');
        indicator.id = 'mobile-refresh-status';
        indicator.hidden = true;
        indicator.setAttribute('role', 'status');
        indicator.setAttribute('aria-live', 'polite');
        symbol = document.createElement('span');
        symbol.setAttribute('aria-hidden', 'true');
        message = document.createElement('span');
        indicator.append(symbol, message);
        document.body.append(indicator);
        document.addEventListener('click', event => {
            if (Date.now() < suppressClickUntil) {
                event.preventDefault(); event.stopImmediatePropagation(); return;
            }
            if (event.target.closest('[data-mobile-refresh]')) {
                event.preventDefault(); event.stopImmediatePropagation(); refresh();
            }
        }, true);
        document.addEventListener('touchstart', event => {
            suppressClickUntil = 0; // A fresh tap is intentional, not the prior swipe's click.
            reset();
            if (event.touches.length === 1 && !event.target.closest('button')) {
                const menuHead = event.target.closest('#menu-index .ui-sheet-head, #menu-index .mobile-sheet-handle');
                const summaryHead = event.target.closest('#cart-summary-sheet .cart-sheet-handle, #cart-summary-sheet .cart-sheet-header');
                const sheet = menuHead ? menuHead.closest('.ui-sheet') : summaryHead?.closest('.cart-sheet');
                if (sheet && visible(sheet)) {
                    const touch = event.touches[0];
                    gesture = {x:touch.clientX, y:touch.clientY, distance:0, sheet,
                        dismiss:menuHead ? () => MenuScreen.closeIndex() : () => closeCartSummarySheet()};
                    return;
                }
            }
            if (!refreshAction || pending || event.touches.length !== 1 || overlayOpen() || editing() ||
                event.target.closest('button, input, textarea, select, [contenteditable="true"]') || !atTop(event.target)) return;
            const touch = event.touches[0];
            if (touch.clientX < 24 || touch.clientX > innerWidth - 24) return;
            gesture = {x:touch.clientX, y:touch.clientY, target:event.target, distance:0};
        }, {passive:true});
        document.addEventListener('touchmove', event => {
            if (!gesture) return;
            if (event.touches.length !== 1 || (!gesture.sheet && (overlayOpen() || editing() || !atTop(gesture.target)))) { reset(); return; }
            const touch = event.touches[0];
            const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
            if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) || dy < -8) { reset(); return; }
            if (dy < 10) return;
            if (event.cancelable) event.preventDefault();
            gesture.distance = Math.max(0, dy);
            suppressClickUntil = Date.now() + 600;
            if (gesture.sheet) gesture.sheet.style.transform = 'translateY(' + Math.min(dy, 240) + 'px)';
            else show(dy >= 96 ? 'ready' : 'pull', dy * 0.5);
        }, {passive:false});
        document.addEventListener('touchend', () => {
            const ready = gesture && gesture.distance >= 96;
            const dismiss = gesture?.dismiss;
            reset();
            if (ready) { if (dismiss) dismiss(); else refresh(); }
        }, {passive:true});
        document.addEventListener('touchcancel', reset, {passive:true});
        window.addEventListener('pagehide', reset);
    });
})();
