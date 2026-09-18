/*
 * THE PAGE FOR EVERYTHING THAT IS NOT AN ORDER.
 *
 * Owner: "arrange profile update, logout, app setting or preferences and etc
 * make it professional arrangements."
 *
 * Each control here already existed somewhere. What did not exist was a place
 * to look for them: sign out was on the floor and only on a one-branch shop,
 * the preferences were in a sheet behind a server icon, and the version was on
 * the sign-in screen. This is the place.
 */
(function () {
    'use strict';

    const at = (id) => document.getElementById(id);

    const money = (amount) => {
        const number = Number(amount) || 0;
        try {
            return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
        } catch (e) {
            return String(Math.round(number));
        }
    };

    /* ------------------------------------------------------------- who */

    function paintWho() {
        const line = at('me-who');
        if (!line) return;

        let name = '';
        try {
            name = (POSNIC.session && POSNIC.session.user && POSNIC.session.user.name) || '';
        } catch (e) {
            name = '';
        }
        line.textContent = name || 'Signed in on this phone';
    }

    /*
     * TODAY'S TAKINGS, ON THE WAY TO THE PAGE THAT BREAKS THEM DOWN.
     *
     * Quietly: a waiter opening this page to sign out does not need to wait
     * for a number, so a failure leaves the row saying nothing rather than
     * putting an error on a screen nobody came here for.
     */
    async function paintToday() {
        const cell = at('me-today');
        if (!cell) return;

        try {
            const said = await POSNIC.api.post('/sales/myDay', {
                branch_id: localStorage.getItem('branch_id') || '',
            });
            const data = (said && said.data) || {};
            cell.textContent = data.orders
                ? money(data.total) + ' · ' + data.orders + (data.orders === 1 ? ' order' : ' orders')
                : 'Nothing yet';
        } catch (e) {
            cell.textContent = '';
        }
    }

    /* --------------------------------------------------------- the lock */

    function paintLock() {
        const state = at('me-lock-state');
        const off = at('me-lock-off');
        const row = at('me-lock');
        if (!state || !off || !row) return;

        let on = false;
        try {
            on = !!(window.POSNIC && POSNIC.lock && POSNIC.lock.isSet());
        } catch (e) {
            on = false;
        }

        state.textContent = on ? 'On' : 'Off';
        row.querySelector('.me-row-label').textContent = on ? 'Change the PIN' : 'Screen lock';
        off.hidden = !on;
    }

    function wireLock() {
        const row = at('me-lock');
        const off = at('me-lock-off');
        if (row) {
            row.addEventListener('click', function () {
                if (window.POSNIC && POSNIC.lock) POSNIC.lock.choose().then(paintLock);
            });
        }
        if (off) {
            off.addEventListener('click', function () {
                if (!(window.POSNIC && POSNIC.lock)) return;
                /* The current PIN first: whoever is holding this phone is past
                   the lock, so this stops it being handed back with the lock
                   quietly gone. */
                POSNIC.lock
                    .unlock('', { why: 'Enter your PIN to turn the lock off', escape: 'Not now' })
                    .then(function (ok) {
                        if (ok) POSNIC.lock.clear();
                        paintLock();
                    });
            });
        }
    }

    /* --------------------------------------------------- what this phone is set to */

    /* THE SAME KEY THE FLOOR SHEET USES, spelled the way it spells it. A
       second name for one setting is two settings that disagree, and this had
       an underscore where the app has a dot. */
    const COPIES = 'posnic.bill_copies';

    function paintPreferences() {
        const language = at('me-language');
        if (language && typeof I18N !== 'undefined') language.value = I18N.language();

        const copies = at('me-copies');
        if (copies) {
            let held = '';
            try {
                held = localStorage.getItem(COPIES) || '';
            } catch (e) {
                held = '';
            }
            copies.value = ['1', '2', '3'].includes(held) ? held : '';
        }

        const where = at('me-server-where');
        if (where) {
            let address = '';
            try {
                address = (POSNIC.server && POSNIC.server.baseUrl) || '';
            } catch (e) {
                address = '';
            }
            where.textContent = address;
        }

        const version = at('me-version');
        if (version) {
            const build = window.POSNIC_BUILD;
            version.textContent = build && build.version
                ? 'Captain ' + build.version + (build.commit ? ' (' + build.commit + ')' : '')
                : 'Captain dev build';
        }
    }

    function wirePreferences() {
        const language = at('me-language');
        if (language) {
            language.addEventListener('change', function () {
                if (typeof I18N !== 'undefined') I18N.use(language.value);
            });
        }

        const copies = at('me-copies');
        if (copies) {
            copies.addEventListener('change', function () {
                try {
                    if (copies.value) localStorage.setItem(COPIES, copies.value);
                    else localStorage.removeItem(COPIES);
                } catch (e) {
                    /* The choice lasts this session and the shop's setting
                       answers on the next one. */
                }
            });
        }

        const server = at('me-server');
        if (server) {
            server.addEventListener('click', function () {
                /* The connect sheet lives on the sign-in screen: three hundred
                   lines of scanning, sweeping and pairing, and a second copy
                   would drift from the first the week after it was made. */
                try {
                    sessionStorage.setItem('posnic_change_server', '1');
                } catch (e) {
                    /* private mode: the page still opens, just without the sheet */
                }
                window.location.href = 'index.html';
            });
        }
    }

    /* ------------------------------------------------------- the account */

    function wireAccount() {
        const password = at('me-password');
        if (password) {
            password.addEventListener('click', function () {
                /*
                 * NOT YET, AND SAID PLAINLY RATHER THAN HIDDEN.
                 *
                 * The till has an endpoint for it, but it stores a password
                 * base64-encoded before hashing and that endpoint writes it
                 * raw. A password changed from here would still sign in on
                 * this phone and on the till's main login, and would fail the
                 * super-admin check - a half-broken account is worse than a
                 * row that says where to go.
                 */
                if (typeof showErrorPopup === 'function') {
                    showErrorPopup('Ask the shop to change your password on the till. It cannot be changed from a phone yet.');
                } else {
                    alert('Ask the shop to change your password on the till.');
                }
            });
        }

        const out = at('me-sign-out');
        if (out) {
            out.addEventListener('click', async function () {
                /* The credential first: this used to clear the menu and the
                   cart and leave the token, so the phone looked signed out and
                   was not. */
                try {
                    if (window.POSNIC && POSNIC.session) POSNIC.session.end();
                } catch (e) {
                    /* storage that will not answer; the rest still runs */
                }

                [
                    'kiosk_selected_branch',
                    'kiosk_branch_list',
                    'kiosk_force_branch_select',
                    'branch_id',
                    'user_id',
                    'orderType',
                    'lastActiveCategory',
                    'kiosk_table_no',
                    'kiosk_table_id',
                ].forEach(function (key) {
                    try {
                        localStorage.removeItem(key);
                    } catch (e) {
                        /* nothing */
                    }
                });

                try {
                    sessionStorage.clear();
                } catch (e) {
                    /* nothing */
                }

                try {
                    const db = await getDB();
                    const tx = db.transaction([BRANCH_STORE, STORE_NAME, CART_STORE], 'readwrite');
                    tx.objectStore(BRANCH_STORE).clear();
                    tx.objectStore(STORE_NAME).clear();
                    tx.objectStore(CART_STORE).clear();
                } catch (e) {
                    /* A phone that cannot open its own database is still
                       signed out: the credential is already gone. */
                }

                window.location.href = 'index.html';
            });
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        const back = at('me-back');
        if (back) {
            back.addEventListener('click', function () {
                window.location.href = 'kot-management.html';
            });
        }

        paintWho();
        paintLock();
        paintPreferences();
        wireLock();
        wirePreferences();
        wireAccount();
        paintToday();
    });
})();
