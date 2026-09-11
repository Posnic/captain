let currentNotesProductId = null;
let currentNotesProductName = "";

function isApkRuntime() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ||
        /Android/i.test(navigator.userAgent || '');
}

function getLocalImageUrl(src) {
    /* assets/images/placeholder.png has never existed in this repo, so every
       item with no photograph drew a broken-image glyph in the Frequently
       Ordered strip. This one is actually shipped. */
    if (!src) return 'images/default-product.webp';

    let localOrigin = '';
    try {
        /* Images come from whichever server is answering, so the origin they
           resolve against moves with it. */
        localOrigin = POSNIC.server.imageOrigin || '';
    } catch (e) {
        localOrigin = '';
    }

    const resolvedUrl = localOrigin
        ? src.replace(/^http:\/\/(localhost|127\.0\.0\.1):5555/i, localOrigin)
        : src;

    try {
        if (!/^https?:\/\//i.test(resolvedUrl)) return resolvedUrl;
        const cacheKey = localStorage.getItem('POSNIC_IMAGE_CACHE_BUST');
        if (!cacheKey) return resolvedUrl;
        const url = new URL(resolvedUrl);
        url.searchParams.set('_posnic_img', cacheKey);
        return url.toString();
    } catch (e) {
        return resolvedUrl;
    }
}

async function setKioskImagesFromIndexedDB() {
    try {
        const images = await getKioskImages();
        if (images) {
            updateKioskImageUI(images);
        }
    } catch (error) {
        console.warn("⚠ Could not load kiosk images:", error);
    }
}

// Add this function to your existing products script
function openOrderHistory() {
    window.location.href = 'order-history.html';
}

async function refreshProductsPage(button) {
    const selectedBranch = localStorage.getItem('kiosk_selected_branch');
    if (!selectedBranch) {
        showErrorPopup('No branch is selected. Please select a branch first.');
        return;
    }

    const icon = button ? button.querySelector('i') : null;
    if (button) button.disabled = true;
    if (icon) icon.classList.add('fa-spin');

    try {
        localStorage.setItem('POSNIC_IMAGE_CACHE_BUST', String(Date.now()));
        await fetchAndStoreBranch(selectedBranch, false, true);
        await setKioskImagesFromIndexedDB();
    } catch (error) {
        console.error('Failed to refresh product data:', error);
        showErrorPopup('Unable to refresh products. Check the server connection and try again.');
    } finally {
        if (icon) icon.classList.remove('fa-spin');
        if (button) button.disabled = false;
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    /* The rail, the index sheet and the resize handlers, attached once.
       Before the first draw, or the chips it draws have nothing listening. */
    MenuScreen.start();

    await loadProducts();
    loadFrequentItems();
    /* After the menu, so an item can be matched to it; awaited so the cart
       check is against the real cart rather than an empty one mid-load. */
    await renderRepeatLastOrder();
    await openDB();
    await setKioskImagesFromIndexedDB();

    const searchInput = document.getElementById('product-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            applyProductFilter();
        });
    }

    /*
     * A way out of a search that is not the backspace key.
     *
     * Clearing a mistyped term meant holding backspace, which on a phone means
     * watching the results flicker through six wrong answers on the way to
     * none. One tap instead, and the keyboard stays up because the likeliest
     * next thing is typing something else.
     */
    const clearBtn = document.getElementById('product-search-clear');
    if (clearBtn && searchInput) {
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            applyProductFilter();
            searchInput.focus();
        });
    }

    /*
     * A chip means "take me there", so the search box has to let go first.
     *
     * Tapping Desserts while a search is running used to jump to a section
     * that was not on the screen, because the screen was showing results.
     */
    const categoryList = document.getElementById('category-list');
    if (categoryList) {
        categoryList.addEventListener('click', async (e) => {
            const chip = e.target.closest('.menu-chip');
            if (!chip) return;

            const searchEl = document.getElementById('product-search-input');
            if (searchEl && searchEl.value) {
                searchEl.value = '';
                /* The menu back before the jump, or there is nothing to jump
                   to. MenuScreen.goTo runs again after, on the real list. */
                await applyProductFilter();
                MenuScreen.goTo(chip.dataset.category);
            }
        });
    }
    // ✅ Open bottom sheet when cart summary clicked
    const discountSummary = document.querySelector('.discount-cart-summary');
    if (discountSummary) {
        discountSummary.addEventListener('click', () => {
            openCartSummarySheet();
        });
    }

    // ✅ Auto-close keyboard when user interacts with product list
    const scrollableProducts = document.querySelector('.scrollable-products');
    if (scrollableProducts) {
        // Close keyboard on touch start (mobile)
        scrollableProducts.addEventListener('touchstart', () => {
            const searchEl = document.getElementById('product-search-input');
            if (searchEl && document.activeElement === searchEl) {
                searchEl.blur();
            }
        });

        /* Close keyboard on scroll. On the WINDOW, because the menu now
           scrolls the page rather than a box inside it - a nested scroller
           under a sticky header is where the keyboard used to leave somebody
           looking at a strip of screen four rows tall. */
        window.addEventListener('scroll', () => {
            const searchEl = document.getElementById('product-search-input');
            if (searchEl && document.activeElement === searchEl) {
                searchEl.blur();
            }
        }, { passive: true });

        // Close keyboard on mouse over (desktop/tablet)
        scrollableProducts.addEventListener('mouseover', () => {
            const searchEl = document.getElementById('product-search-input');
            if (searchEl && document.activeElement === searchEl) {
                searchEl.blur();
            }
        });
    }
});

async function loadFrequentItems() {
    const section = document.getElementById('frequent-section');
    const container = document.getElementById('frequent-items');
    if (!section || !container) return;

    try {
        const branchId = localStorage.getItem('branch_id');
        if (!branchId) {
            return; // no branch, nothing to show
        }

        const data = await POSNIC.api.post('/sales/getFrequentItems', {
            branch_id: branchId,
            limit: 10
        });
        if (data.type !== 'success' || !data.data || !data.data.items || data.data.items.length === 0) {
            section.style.display = 'none';
            return;
        }

        /* Remembered for the search ranking: these are the shop's own answer
           to which of two equally-good text matches somebody meant. */
        window._frequentItemIds = new Set((data.data.items || []).map(i => String(i.id)));
        renderFrequentItems(data.data.items);
        section.style.display = 'block';
    } catch (e) {
        console.error('Failed to load frequent items:', e);
        section.style.display = 'none';
    }
}

function renderFrequentItems(items) {
    const container = document.getElementById('frequent-items');
    if (!container) return;

    // Flatten global products map into a simple array
    const flatProducts = [];
    for (const itemsArr of Object.values(products || {})) {
        itemsArr.forEach(p => flatProducts.push(p));
    }

    const html = items.map(it => {
        const product = flatProducts.find(p => p.id === it.product_id);
        if (!product) return '';

        const allowNegative = product.negative_stock === true;
        const available = product.available_quantity ?? product.stock ?? 0;

        // ❌ If no negative stock AND quantity <= 0 → skip from frequent list
        if (!allowNegative && available <= 0) {
            return '';
        }

        // Display stock label
        const initialStock = allowNegative ? '∞' : available;
        const stockNumeric = allowNegative ? -1 : available;   // -1 means infinite

        /* Never empty: getLocalImageUrl answers with the placeholder, and an
           empty src makes a browser re-request the page itself. */
        const imageUrl = getLocalImageUrl(product.img || product.image || product.item_image);

        return `
    <div class="frequent-card" data-id="${product.id}">
        <div class="frequent-stock-badge"
            id="frequent-stock-${product.id}"
            data-initial-stock="${stockNumeric}">
            Stock: ${initialStock}
        </div>
        <div class="frequent-inner">
            <div class="frequent-img">
                <img src="${imageUrl}" alt="${product.name}">
            </div>
            <div class="frequent-info">
                <div class="frequent-name">
                    ${product.name}
                </div>
                <div class="frequent-price">₹${product.price.toFixed ? product.price.toFixed(2) : product.price}</div>
            </div>

            <div class="frequent-cart-empty" id="frequent-empty-${product.id}">
                <button class="frequent-add-btn"
                        onclick="event.stopPropagation(); onFrequentAdd('${product.id}')">
                    ADD
                </button>
            </div>

            <div class="frequent-cart-controls" id="frequent-controls-${product.id}" style="display:none;">
                <button class="frequent-decrease"
                        onclick="event.stopPropagation(); onFrequentChange('${product.id}', -1)">-</button>
                <span id="frequent-qty-${product.id}">0</span>
                <button class="frequent-increase"
                        onclick="event.stopPropagation(); onFrequentChange('${product.id}', 1)">+</button>
            </div>
        </div>
    </div>`;
    }).join('');

    container.innerHTML = html;
    items.forEach(it => syncFrequentQtyFromMain(it.product_id));
}

async function syncFrequentQtyFromMain(id) {
    let q = 0;

    // 1️⃣ Try to read qty from visible main product card
    const mainQtyEl = document.getElementById('qty-' + id);
    if (mainQtyEl) {
        q = parseInt(mainQtyEl.textContent || '0', 10) || 0;
    } else if (typeof getCartData === 'function') {
        // 2️⃣ If not visible in current category, read from cart (IndexedDB)
        try {
            const cart = await getCartData();
            const item = cart.find(c => c.id === id);
            if (item && item.quantity) {
                q = item.quantity;
            }
        } catch (e) {
            console.error('Failed to read qty from cart for', id, e);
        }
    }

    const emptyBox = document.getElementById('frequent-empty-' + id);
    const controlsBox = document.getElementById('frequent-controls-' + id);
    const freqQtyEl = document.getElementById('frequent-qty-' + id);
    const stockBadge = document.getElementById('frequent-stock-' + id);

    if (!freqQtyEl || !emptyBox || !controlsBox) return;

    // toggle ADD / - qty +
    if (q > 0) {
        freqQtyEl.textContent = q;
        emptyBox.style.display = 'none';
        controlsBox.style.display = 'flex';
    } else {
        freqQtyEl.textContent = '0';
        emptyBox.style.display = 'block';
        controlsBox.style.display = 'none';
    }

    // update Stock: value on frequent badge
    if (stockBadge) {
        const initialRaw = stockBadge.getAttribute('data-initial-stock') || '0';
        const initial = parseInt(initialRaw, 10);

        if (initial === -1) {
            stockBadge.textContent = 'Stock: ∞';
        } else {
            let remaining = initial - q;
            if (remaining < 0) remaining = 0;
            stockBadge.textContent = 'Stock: ' + remaining;
        }
    }

    // also update main/search product card stock badge (if visible)
    updateStockBadgeForProduct(id);
}

async function onFrequentAdd(id) {
    // default notes (cart notes or product description)
    const notes = await getDefaultNotesForProduct(id);
    if (notes) {
        await setCartItemNotes(id, notes);
    }

    await updateQuantity(id, 1);
    await syncFrequentQtyFromMain(id);
}

async function onFrequentChange(id, delta) {
    // delta > 0 & cartல இன்னும் item இல்லையா / notes இல்லையா என்றால் → default notes set
    if (delta > 0 && typeof getCartData === 'function') {
        const cart = await getCartData();
        const item = cart.find(c => c.id === id);
        if (!item || !item.notes) {
            const notes = await getDefaultNotesForProduct(id);
            if (notes) {
                await setCartItemNotes(id, notes);
            }
        }
    }

    await updateQuantity(id, delta);
    await syncFrequentQtyFromMain(id);
}

// function addFrequentItemToOrder(productId) {
//     const flatProducts = [];
//     for (const itemsArr of Object.values(products || {})) {
//         itemsArr.forEach(p => flatProducts.push(p));
//     }

//     const product = flatProducts.find(p => p.id === productId);
//     if (!product) {
//         console.warn('Product not found for frequent item', productId);
//         return;
//     }
//     addToCart(product);   // your existing add-to-cart logic
// }

// ✅ Click anywhere on the product card to increase quantity (excluding buttons)
// $(document).on("click", ".product-card", async function (e) {
//     if ($(e.target).hasClass("btn-increase") || $(e.target).hasClass("btn-decrease")) {
//         return; // Don't trigger if user clicked the buttons
//     }

//     const $button = $(this);
//     const $productCard = $button.closest(".product-card");
//     const productId = $(this).data("id");

//     const $originalImg = $productCard.find("img").first();
//     const offset = $originalImg.offset();
//     const $img = $originalImg.clone().css({
//         position: "absolute",
//         width: $originalImg.width(),
//         height: $originalImg.height(),
//         zIndex: 1000,
//         top: offset.top,
//         left: offset.left,
//         pointerEvents: "none"
//     });

//     $("body").append($img);

//     const $cart = $(".floating-cart");
//     const cartOffset = $cart.offset();

//     $img.animate({
//         top: cartOffset.top + 10,
//         left: cartOffset.left + 10,
//         width: 30,
//         height: 30,
//         opacity: 0.1
//     }, 800, "swing", function () {
//         $img.remove();
//     });

//     await updateQuantity(productId, 1);
// });
// Click on a dish row (except +/-/ADD buttons) → open notes modal
$(document).on("click", ".dish", function (e) {
    if (
        $(e.target).hasClass("btn-add") ||
        $(e.target).hasClass("btn-increase") ||
        $(e.target).hasClass("btn-decrease") ||
        $(e.target).closest(".dish-action").length
    ) {
        return; // quantity buttons click panna modal open ஆகக்கூடாது
    }

    const $card = $(this);
    const productId = $card.data("id");
    const productName = $card.find(".dish-name").text().trim();

    currentNotesProductId = productId;
    currentNotesProductName = productName;
    loadExistingNotesForProduct(productId);

    $("#notes-product-name").text(productName);
    $("#product-notes-modal").css("display", "flex");
});
// Click on frequent card → open same notes modal
$(document).on("click", ".frequent-card", function (e) {
    // safety: if somehow +/-/ADD buttons bubble, ignore
    if (
        $(e.target).closest('.frequent-add-btn').length ||
        $(e.target).closest('.frequent-increase').length ||
        $(e.target).closest('.frequent-decrease').length
    ) {
        return;
    }

    const $card = $(this);
    const productId = $card.data("id");
    const productName = $card.find(".frequent-name").text().trim();

    currentNotesProductId = productId;
    currentNotesProductName = productName;

    loadExistingNotesForProduct(productId);

    $("#notes-product-name").text(productName);
    $("#product-notes-modal").css("display", "flex");
});
// Cancel → close & clear
$(document).on("click", "#notes-cancel-btn", function () {
    $("#product-notes-text").val("");
    $("#product-notes-modal").hide();
    currentNotesProductId = null;
});

// Apply & Add → save notes + increase quantity
$(document).on("click", "#notes-apply-btn", async function () {
    if (!currentNotesProductId) {
        $("#product-notes-modal").hide();
        return;
    }

    const notes = $("#product-notes-text").val().trim();

    await setCartItemNotes(currentNotesProductId, notes);

    // ✅ Only add quantity if item is not already in cart (qty = 0)
    const cartData = await getCartData();
    const existingItem = cartData.find(i => i.id === currentNotesProductId);
    const currentQty = existingItem ? existingItem.quantity : 0;

    if (currentQty === 0) {
        // First time → add quantity 1
        await updateQuantity(currentNotesProductId, 1);
    }
    // else: qty already > 0 → don't change quantity, just update notes

    // 🔽 backend-ku notes update request
    // try {
    //     await fetch("http://YOUR_API_URL/sales/qrItemNotesUpdate", {
    //         method: "POST",
    //         headers: { "Content-Type": "application/json" },
    //         body: JSON.stringify({
    //             item_id: currentNotesProductId,
    //             item_description: notes
    //             // தேவையான மற்ற fields: sale_id / table_id / token_id...
    //         })
    //     });
    // } catch (e) {
    //     console.error("Failed to sync notes to backend", e);
    // }

    $("#product-notes-text").val("");
    $("#product-notes-modal").hide();
    currentNotesProductId = null;
});
// Set / update notes for a cart item
async function setCartItemNotes(id, notes) {
    let cartData = await getCartData();
    let item = cartData.find(i => i.id === id);

    if (!item) {
        const storedProducts = await getData("products");
        const p = storedProducts.find(x => x.id === id);
        if (!p) return;
        item = {
            id: p.id,
            name: p.name,
            price: Number(p.price || 0),
            discount_price: Number(p.discount_price || 0),
            tax_price: Number(p.tax_price || 0),
            final_price: Number(p.final_price || 0),
            img: p.img,
            quantity: 0,
            notes: notes || ""
        };
        cartData.push(item);
    } else {
        item.notes = notes || "";
    }

    await saveCartData(cartData);
}
async function getDefaultNotesForProduct(id) {
    const cartData = await getCartData();
    const item = cartData.find(i => i.id === id);

    if (item && item.notes) {
        return item.notes;
    }

    let desc = "";

    if (typeof products !== "undefined" && products) {
        for (const itemsArr of Object.values(products)) {
            const p = itemsArr.find(p => p.id === id);
            if (p) {
                desc = p.item_description || p.description || "";
                break;
            }
        }
    }

    if (!desc) return "";

    const tmp = document.createElement("textarea");
    tmp.innerHTML = desc;
    desc = tmp.value
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/?[^>]+>/g, "")
        .trim();

    return desc;
}
async function loadExistingNotesForProduct(id) {
    try {
        const cartData = await getCartData();
        const item = cartData.find(i => i.id === id);

        // 1) Cartல notes இருந்தா → அதையே show பண்ணு
        if (item && item.notes) {
            $("#product-notes-text").val(item.notes);
            return;
        }

        // 2) notes இல்லனா → accessQrkModelல இருந்து வந்த description use பண்ணு
        let desc = "";

        if (typeof products !== "undefined" && products) {
            // products = { categoryId: [ items... ], ... }
            for (const itemsArr of Object.values(products)) {
                const p = itemsArr.find(p => p.id === id);
                if (p) {
                    desc = p.item_description || p.description || "";
                    break;
                }
            }
        }
        if (desc) {
            // HTML entities (&lt; &gt;) decode + basic tag strip
            const tmp = document.createElement("textarea");
            tmp.innerHTML = desc;            // "&lt;p&gt;hi&lt;/p&gt;" → "<p>hi</p>"
            desc = tmp.value
                .replace(/<br\s*\/?>/gi, "\n")   // <br> → new line
                .replace(/<\/?[^>]+>/g, "")      // மற்ற HTML tags remove
                .trim();
            $("#product-notes-text").val(desc);
        } else {
            $("#product-notes-text").val("");
        }
    } catch (e) {
        console.error("Error loading notes:", e);
        $("#product-notes-text").val("");
    }
}
// ADD button → behaves like first + click
/**
 * Show how many the next tap will add, when it is more than one.
 *
 * Without it, typing "3 cb" and tapping add looks identical to adding one,
 * and the difference only shows up on the bill.
 */
/**
 * Put the last order back in the cart.
 *
 * "Same again" is a normal thing to say at a table, and doing it by hand
 * means finding every item a second time. Only offered when the remembered
 * order belongs to this branch and the cart is empty, so it can never
 * quietly double an order somebody is part way through building.
 *
 * Items no longer on the menu are skipped and counted, rather than added as
 * ids the kitchen cannot resolve.
 */
async function repeatLastOrder() {
    let last = null;
    try { last = JSON.parse(localStorage.getItem('posnic.last-order') || 'null'); }
    catch (e) { last = null; }

    const branchId = localStorage.getItem('kiosk_selected_branch');
    if (!last || !Array.isArray(last.items) || !last.items.length) return;
    if (last.branch && branchId && String(last.branch) !== String(branchId)) return;

    const known = new Map();
    for (const itemsArr of Object.values(products || {})) {
        for (const p of itemsArr) known.set(String(p.id), p);
    }

    let added = 0;
    let missing = 0;
    for (const line of last.items) {
        const product = known.get(String(line.item_id));
        if (!product) { missing += 1; continue; }
        await updateQuantity(product.id, Number(line.item_quantity) || 1);
        added += 1;
    }

    if (typeof showToast === 'function') {
        showToast(missing
            ? `Added ${added} items. ${missing} are no longer on the menu.`
            : `Added ${added} items from the last order.`);
    }
}

/** Offered only when it can do something: same branch, and an empty cart. */
async function renderRepeatLastOrder() {
    const host = document.querySelector('.product-search');
    if (!host) return;
    document.getElementById('repeat-last')?.remove();

    let last = null;
    try { last = JSON.parse(localStorage.getItem('posnic.last-order') || 'null'); }
    catch (e) { return; }
    if (!last || !Array.isArray(last.items) || !last.items.length) return;

    const branchId = localStorage.getItem('kiosk_selected_branch');
    if (last.branch && branchId && String(last.branch) !== String(branchId)) return;

    const cart = await getCartData();
    if (cart && cart.length) return;

    const button = document.createElement('button');
    button.id = 'repeat-last';
    button.type = 'button';
    button.textContent = `Repeat last order (${last.items.length} items)`;
    button.style.cssText =
        'display:block;width:100%;margin:8px 0 0;padding:10px;border:1.5px solid #d1d5db;' +
        'border-radius:8px;background:#fff;color:#111827;font-weight:600;cursor:pointer;';
    button.addEventListener('click', async () => {
        button.disabled = true;
        await repeatLastOrder();
        button.remove();
    });
    host.appendChild(button);
}

function showQuantityHint(quantity) {
    let hint = document.getElementById('qty-hint');
    if (!hint) {
        const search = document.querySelector('.product-search-inner');
        if (!search) return;
        hint = document.createElement('span');
        hint.id = 'qty-hint';
        hint.style.cssText =
            'margin-left:8px;padding:2px 9px;border-radius:999px;background:#2563eb;' +
            'color:#fff;font-size:12px;font-weight:700;white-space:nowrap;';
        search.appendChild(hint);
    }
    hint.hidden = !(quantity > 1);
    hint.textContent = quantity > 1 ? `x${quantity}` : '';
}

$(document).on("click", ".btn-add", async function () {
    const id = $(this).data("id");

    const notes = await getDefaultNotesForProduct(id);
    if (notes) {
        await setCartItemNotes(id, notes);
    }

    /* Whatever the search asked for, then back to one: a quantity typed for
       one item must not silently apply to the next thing touched. */
    const quantity = window._pendingQuantity || 1;
    window._pendingQuantity = 1;
    showQuantityHint(1);

    await updateQuantity(id, quantity);

    if (typeof syncFrequentQtyFromMain === 'function') {
        syncFrequentQtyFromMain(id);
    }
});
/*
 * ONE MORE, ONE FEWER.
 *
 * WHAT WAS HERE. Both buttons used to clone the dish's photograph and animate
 * it across the screen to the cart icon, then update the quantity. Three
 * things were wrong with that by the time the menu was rebuilt.
 *
 * It crashed. `$(...).find("img").offset()` is undefined when the row has no
 * photograph - which is now most rows, because a dish without one draws an
 * icon instead - and reading `.top` off undefined threw before the quantity
 * was ever changed. The button simply did nothing, silently.
 *
 * It aimed at something that is gone. The flight ended at
 * `.discount-cart-summary`, which the bill bar replaced.
 *
 * And it was answering a question the screen no longer has. The animation
 * existed to show WHERE a tapped item went, back when the total lived in a
 * corner. The row itself now turns into a stepper showing the count, and the
 * bill bar rises with the total on it, so the answer is already on the screen
 * twice before any picture could arrive.
 */
$(document).on("click", ".btn-increase", async function () {
    const $button = $(this);
    const productId = $button.data("id") || $button.closest(".dish, .frequent-card").data("id");

    const product = await getProductById(productId);
    if (!product) return;

    const cartData = await getCartData();
    const cartItem = cartData.find(item => item.id === productId);
    const currentCartQty = cartItem ? cartItem.quantity : 0;

    /* A shop that allows negative stock is never at its limit. */
    const availableQty = product.available_quantity || 0;
    const allowNegativeStock = product.negative_stock === true || product.negative_stock === 1;
    if (!allowNegativeStock && currentCartQty >= availableQty) {
        $button.prop('disabled', true).addClass('disabled');
        return;
    }

    await updateQuantity(productId, 1);
    if (typeof syncFrequentQtyFromMain === 'function') {
        syncFrequentQtyFromMain(productId);
    }

    /* The row is redrawn by MenuScreen.setRow, so the button that was just
       pressed may be a different element now. Ask for it again. */
    if (!allowNegativeStock && currentCartQty + 1 >= availableQty) {
        $('.btn-increase[data-id="' + productId + '"]').prop('disabled', true).addClass('disabled');
    }
});

$(document).on("click", ".btn-decrease", async function () {
    const $button = $(this);
    const productId = $button.data("id") || $button.closest(".dish, .frequent-card").data("id");

    await updateQuantity(productId, -1);
    if (typeof syncFrequentQtyFromMain === 'function') {
        syncFrequentQtyFromMain(productId);
    }

    /* Going down always makes room to go back up. */
    $('.btn-increase[data-id="' + productId + '"]').prop('disabled', false).removeClass('disabled');
});


async function openCartSummarySheet() {
    const sheet = document.getElementById('cart-summary-sheet');
    if (!sheet) return;

    await renderCartSummaryIntoSheet();

    sheet.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeCartSummarySheet() {
    const sheet = document.getElementById('cart-summary-sheet');
    if (!sheet) return;

    sheet.classList.remove('open');
    document.body.style.overflow = '';
}

// Close on backdrop / close button
document.addEventListener('click', (e) => {
    if (e.target.closest('.cart-sheet-close')) {
        closeCartSummarySheet();
    }
    const backdrop = e.target.closest('.cart-sheet-backdrop');
    if (backdrop) {
        closeCartSummarySheet();
    }
});

async function renderCartSummaryIntoSheet() {
    const bodyEl = document.getElementById('cart-sheet-body');
    const subtitleEl = document.getElementById('cart-sheet-subtitle');
    if (!bodyEl || !subtitleEl) return;

    let cart = [];
    try {
        cart = await getCartData();   // from indexedDB.js
    } catch (e) {
        console.error('Failed to read cart for summary', e);
    }

    if (!Array.isArray(cart) || cart.length === 0) {
        subtitleEl.textContent = 'Cart is empty';
        bodyEl.innerHTML = '<p style="font-size:13px;color:#777;">No items in cart.</p>';
        return;
    }

    let itemCount = 0;
    let totalQty = 0;
    let totalSubtotal = 0;        // gross price
    let totalDiscount = 0;
    let totalTax = 0;
    let finalTotal = 0;

    for (const item of cart) {
        const qty = Number(item.quantity || 0);
        if (qty <= 0) continue;

        itemCount += 1;
        totalQty += qty;
        const subtotal = Number(item.subtotal || 0);
        const discountPrice = Number(item.discount_price || 0);
        const taxPrice = Number(item.tax_price || 0);

        const lineSubtotal = subtotal * qty;
        const lineDiscount = discountPrice * qty;
        const lineTax = taxPrice * qty;

        totalSubtotal += lineSubtotal;
        totalDiscount += lineDiscount;
        totalTax += lineTax;

        // if you already store final (after discount+tax) per item, use it
        if (typeof item.final_price !== 'undefined') {
            finalTotal += Number(item.final_price || 0) * qty;
        } else {
            finalTotal += lineSubtotal - lineDiscount + lineTax;
        }
    }

    subtitleEl.textContent = `${itemCount} item${itemCount !== 1 ? 's' : ''} · ${totalQty} qty`;

    bodyEl.innerHTML = `
        <div class="cart-summary-row">
            <div class="cart-summary-chip-row">
                <div class="cart-summary-chip">
                    <div class="cart-summary-chip-label">Items</div>
                    <div class="cart-summary-chip-value">${itemCount}</div>
                </div>
                <div class="cart-summary-chip">
                    <div class="cart-summary-chip-label">Total Qty</div>
                    <div class="cart-summary-chip-value">${totalQty}</div>
                </div>
            </div>

            <div class="cart-summary-chip-row">
                <div class="cart-summary-chip">
                    <div class="cart-summary-chip-label">Subtotal</div>
                    <div class="cart-summary-chip-value">₹${totalSubtotal.toFixed(2)}</div>
                </div>
                <div class="cart-summary-chip">
                    <div class="cart-summary-chip-label">Discount</div>
                    <div class="cart-summary-chip-value">‑₹${totalDiscount.toFixed(2)}</div>
                </div>
            </div>

            <div class="cart-summary-chip-row">
                <div class="cart-summary-chip">
                    <div class="cart-summary-chip-label">Tax</div>
                    <div class="cart-summary-chip-value">₹${totalTax.toFixed(2)}</div>
                </div>
            </div>

            <div class="cart-summary-total">
                <div class="cart-summary-total-label">Final Amount</div>
                <div class="cart-summary-total-amount">₹${finalTotal.toFixed(2)}</div>
            </div>
        </div>
    `;
}

/*
 * How many matched, in one small line.
 *
 * It had a heading's worth of space around it, which is a lot of a phone
 * screen to spend telling somebody how many things they can already see.
 */
function setSearchCount(text) {
    let line = document.getElementById('search-count');
    if (!line) {
        const host = document.querySelector('.product-search');
        if (!host) return;
        line = document.createElement('div');
        line.id = 'search-count';
        line.className = 'search-count';
        host.appendChild(line);
    }
    line.textContent = text || '';
}

/*
 * What somebody typed, ranked.
 *
 * THE ROWS ARE DRAWN BY MenuView, the same as the menu itself. They used to be
 * built here, separately, by a second copy of the card markup - and the two
 * copies had already drifted: one knew about discounts and the other did not,
 * and one subtracted what was in the cart from the stock count while the other
 * did not. Nobody decided either of those. They happened because the same
 * thing was written twice.
 */
async function applyProductFilter() {
    const input = document.getElementById('product-search-input');
    if (!input) return;

    /* "3 cb" is three of whatever "cb" finds. The number is remembered for
       the next add, then forgotten, so it cannot leak into a later tap. */
    const typed = ItemSearch.parseTerm(input.value.trim());
    window._pendingQuantity = typed.quantity;
    const term = typed.term.trim().toLowerCase();
    showQuantityHint(typed.quantity);

    /*
     * Searching is a different screen, and the keyboard has already taken
     * half of it. Everything that is not a result steps aside while there is
     * something in the box - see .is-searching in products/style.css.
     */
    const wasSearching = document.body.classList.contains('is-searching');
    document.body.classList.toggle('is-searching', !!term);
    setSearchCount('');

    const clear = document.getElementById('product-search-clear');
    if (clear) clear.hidden = !input.value;

    /* The header and the rail come and go with this state, so the sticky
       offsets they sit at are no longer the ones that were measured. */
    MenuScreen.stick();

    // 🔁 Box empty → the whole menu back, at the top of it
    if (!term) {
        await loadProducts();
        /* At the top, and only when a search actually ended. Leaving a search
           returns you to the menu, and the top is the honest place to be put
           back down - but scrolling on every keystroke that happens to clear
           the box would fight somebody who is still typing. */
        if (wasSearching) window.scrollTo({ top: 0 });
        return;
    }

    /*
     * Ranked search, not a substring test.
     *
     * `name.includes(term)` finds Chicken Biryani from "biry" and from nothing
     * else: not from "chick biry", because two words are never one substring,
     * and not from "cb", which is what somebody selling two hundred a day
     * actually types. See assets/common/item-search.js for the ranking.
     */
    const allFlatProducts = [];
    for (const [categoryKey, itemsArr] of Object.entries(products || {})) {
        if (categoryKey === 'all') continue;
        itemsArr.forEach(p => {
            allFlatProducts.push({ ...p, _categoryKey: categoryKey });
        });
    }

    /* Indexed once per render of the menu, not once per keystroke. */
    if (!window._itemSearchIndex || window._itemSearchIndexSize !== allFlatProducts.length) {
        window._itemSearchIndex = ItemSearch.index(allFlatProducts);
        window._itemSearchIndexSize = allFlatProducts.length;
    }

    const filtered = ItemSearch.search(window._itemSearchIndex, term, {
        /* What the shop actually sells, from the frequent items already
           fetched for the shortcuts row. Breaks ties only. */
        popular: window._frequentItemIds instanceof Set ? window._frequentItemIds : new Set(),
    });

    // Load cart so qty / stock status stay correct
    const storedCart = await getCartData();
    const cartMap = new Map(storedCart.map(i => [i.id, i]));

    const seenIds = new Set();
    const hits = [];
    for (const product of filtered) {
        if (seenIds.has(product.id)) continue;
        seenIds.add(product.id);
        hits.push(product);
    }

    const listEl = document.getElementById('product-list');
    const options = {
        image: getLocalImageUrl,
        popular: window._frequentItemIds instanceof Set ? window._frequentItemIds : new Set(),
    };

    if (listEl) {
        /*
         * Results BEST FIRST, in one list, not regrouped by category.
         *
         * The menu is sectioned because a person browsing it is looking for a
         * kind of thing. Somebody who has typed four letters is looking for
         * one thing, and putting a heading above each result buries the best
         * match under the name of its category.
         */
        listEl.innerHTML = hits.length
            ? '<div class="menu-section-items">' +
              hits.map(p => MenuView.dish(p, (cartMap.get(p.id) || {}).quantity || 0, options)).join('') +
              '</div>'
            : MenuView.nothing(
                'Nothing matches "' + input.value.trim() + '"',
                'Try fewer letters, or the first letters of each word - "cb" finds Chicken Biryani.'
              );
    }

    /* Said quietly, and only while it is worth saying. */
    setSearchCount(
        seenIds.size === 0
            ? ''
            : seenIds.size === 1
                ? '1 item'
                : seenIds.size + ' items'
    );

    const loader = document.getElementById('page-loader');
    if (loader) loader.style.display = 'none';

    // Sync frequent cards (if function exists)
    if (typeof syncFrequentQtyFromMain === 'function') {
        hits.forEach(p => syncFrequentQtyFromMain(p.id));
    }
}

/*
 * What is left of a dish, kept honest after a change.
 *
 * The row shows a count only when it is nearly gone: "47 left" is not
 * information a waiter needs while taking an order, and "2 left" is the whole
 * order. MenuView.stock decides where that line falls, so this and the row's
 * first draw cannot disagree about it.
 */
function updateStockBadgeForProduct(id) {
    let product;
    outer: for (const [key, itemsArr] of Object.entries(products || {})) {
        if (key === 'all') continue;
        for (const p of itemsArr) {
            if (p.id === id) {
                product = p;
                break outer;
            }
        }
    }
    if (!product) return;

    const shown = document.getElementById('qty-' + id);
    const quantity = shown ? parseInt(shown.textContent || '0', 10) || 0 : 0;
    if (typeof MenuScreen !== 'undefined') MenuScreen.setRow(id, quantity, product);
}

async function changeBranch() {
    try {
        // Flag: next time index.html opens, go to branch select
        localStorage.setItem('kiosk_force_branch_select', '1');

        // DO NOT remove kiosk_selected_branch here –
        // index.js will ignore it when force flag is set

        // Clear IndexedDB branch + products + cart
        const db = await getDB();
        const tx = db.transaction(
            [BRANCH_STORE, STORE_NAME, CART_STORE],
            'readwrite'
        );

        tx.objectStore(BRANCH_STORE).clear();
        tx.objectStore(STORE_NAME).clear();
        tx.objectStore(CART_STORE).clear();

        // Optional: wait for transaction to finish
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });

        // Go back to branch selection page
        window.location.href = 'index.html';
    } catch (e) {
        console.error('Failed to change branch:', e);
        // fallback: still try to go back
        window.location.href = 'index.html';
    }
}
