/*
 * ONE WAITER'S OWN DAY.
 *
 * Owner: "sales history of own and table wise seperate."
 *
 * Everything on this page comes from POST /sales/myDay, which scopes the
 * figures to whoever the TOKEN names. This page cannot ask for somebody
 * else's day, whatever is typed at it, and that is deliberate: the same
 * screen is on every waiter's phone.
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

    const escape = (text) =>
        String(text == null ? '' : text).replace(/[&<>"]/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
        );

    /** A local date string, never toISOString: that is UTC, and a shop is not. */
    function stamp(date) {
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0'),
        ].join('-');
    }

    function when(value) {
        if (!value) return '';
        const then = new Date(value);
        if (isNaN(then.getTime())) return '';
        try {
            return then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        } catch (e) {
            return '';
        }
    }

    function draw(data) {
        const total = at('sales-total');
        const count = at('sales-count');
        const cancelled = at('sales-cancelled');

        if (total) total.textContent = money(data.total);
        if (count) {
            count.textContent = data.orders
                ? data.orders + (data.orders === 1 ? ' order' : ' orders')
                : 'Nothing sold yet';
        }
        if (cancelled) {
            cancelled.hidden = !data.cancelled;
            cancelled.textContent = data.cancelled
                ? data.cancelled + (data.cancelled === 1 ? ' cancelled order, not counted' : ' cancelled orders, not counted')
                : '';
        }

        const tables = at('sales-tables');
        if (tables) {
            const rows = (data.tables || []).map(
                (row) =>
                    '<div class="me-row me-row-read">' +
                    '<span class="me-row-label">' + escape(row.table) + '</span>' +
                    '<span class="me-row-value">' + money(row.total) + ' · ' +
                    row.orders + (row.orders === 1 ? ' order' : ' orders') + '</span>' +
                    '</div>'
            );
            tables.innerHTML = rows.length
                ? rows.join('')
                : '<p class="me-note">No tables yet.</p>';
        }

        const recent = at('sales-recent');
        if (recent) {
            const rows = (data.recent || []).map(
                (row) =>
                    '<div class="me-row me-row-read' + (row.cancelled ? ' is-struck' : '') + '">' +
                    '<span class="me-row-label">' +
                    escape(row.table_number ? row.table_number : 'No table') +
                    '<span class="me-row-sub">' + escape(when(row.created_at)) + '</span>' +
                    '</span>' +
                    '<span class="me-row-value">' + money(row.total_amount) + '</span>' +
                    '</div>'
            );
            recent.innerHTML = rows.length ? rows.join('') : '<p class="me-note">No orders yet.</p>';
        }
    }

    function saySomethingWentWrong(why) {
        const tables = at('sales-tables');
        const recent = at('sales-recent');
        const note = '<p class="me-note">' + escape(why) + '</p>';
        if (tables) tables.innerHTML = note;
        if (recent) recent.innerHTML = note;

        const total = at('sales-total');
        if (total) total.textContent = '';
    }

    async function load(which) {
        const day = new Date();
        if (which === 'yesterday') day.setDate(day.getDate() - 1);

        try {
            const said = await POSNIC.api.post('/sales/myDay', {
                branch_id: localStorage.getItem('branch_id') || '',
                day: stamp(day),
            });
            draw((said && said.data) || {});
        } catch (error) {
            /*
             * A till that will not answer is not "you have sold nothing". The
             * difference matters on a screen about money.
             */
            saySomethingWentWrong(
                (error && error.message) || 'The till did not answer. Try again in a moment.'
            );
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        const back = at('sales-back');
        if (back) {
            back.addEventListener('click', function () {
                window.location.href = 'me.html';
            });
        }

        document.querySelectorAll('.sales-day').forEach(function (button) {
            button.addEventListener('click', function () {
                document.querySelectorAll('.sales-day').forEach(function (other) {
                    other.classList.toggle('is-on', other === button);
                });
                load(button.getAttribute('data-day'));
            });
        });

        load('today');
    });
})();
