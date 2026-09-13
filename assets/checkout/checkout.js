function showCartLoader() {
    const el = document.getElementById('page-loader');
    if (el) el.style.display = 'flex';
}

function hideCartLoader() {
    const el = document.getElementById('page-loader');
    if (el) el.style.display = 'none';
}

/*
 * ONE ORDER PER TAP.
 *
 * Reported from a live floor: an order sent for table 5 arrived at the till
 * twice, and cancelling one cancelled both.
 *
 * The loader appears but the button stays live, so a second tap during the
 * second or two this takes starts a whole second checkout. On a slow shop
 * network that is not a rare accident, it is what anybody does when nothing
 * seems to be happening.
 *
 * The order key does not stop it, and is not meant to. OrderQueue.newKey() is
 * minted once per CHECKOUT and reused on every retry of that checkout, which
 * is exactly right for the case it was built for: a request that never got an
 * answer, queued and sent again later under the same name. Two taps are two
 * checkouts, so they mint two keys and the till sees two different orders -
 * correctly, because as far as anything downstream can tell, they are.
 *
 * So the fix belongs here, where the second tap happens, and nowhere else.
 */
let kioskOrderInFlight = false;

async function kioskPlaceOrder() {
    if (kioskOrderInFlight) {
        console.debug('[order] already sending; this tap is ignored');
        return;
    }
    kioskOrderInFlight = true;

    const btn = document.getElementById('next-btn');
    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }

    try {
        showCartLoader();

        // All discount/table/person details already saved from discount.html
        const transactionId = generateUniqueToken(); // from indexedDB.js
        await checkout(transactionId);

        // success: next page (thankyou) will load; loader disappears with this page
    } catch (e) {
        console.error("Error during checkout:", e);

        showErrorPopup("Failed to place order. Please try again.");
    } finally {
        // always hide loader if we are still on this page
        hideCartLoader();

        /*
         * Released unless this page is on its way out.
         *
         * Only a placed order navigates. Every other ending leaves the waiter
         * standing here: the server refused the order, or it went in the
         * on-phone queue because the shop was unreachable - and that second
         * one does not throw, so releasing in the catch alone would have left
         * a dead Place Order button after the commonest failure on a bad
         * network. The flag is set by checkout() at the moment it decides to
         * navigate, which is the only thing that actually knows.
         */
        if (!window.__kioskOrderPlaced) {
            kioskOrderInFlight = false;
            if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
        }
    }
}
