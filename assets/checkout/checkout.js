function showCartLoader() {
    const el = document.getElementById('page-loader');
    if (el) el.style.display = 'flex';
}

function hideCartLoader() {
    const el = document.getElementById('page-loader');
    if (el) el.style.display = 'none';
}

async function kioskPlaceOrder() {
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
    }
}
