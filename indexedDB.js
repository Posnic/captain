const DB_NAME = "KioskDB";
const DB_VERSION = 3;
const STORE_NAME = "products";
const BRANCH_STORE = "branch";
const CART_STORE = "cart";
const PHONEPE_STORE = "phonepe";
const IMAGE_STORE = "images";
const PAYMENT_STORE = "payment";

let db;
let cart = {}; // ✅ Cart stored in IndexedDB
let products = {};

function resolveLocalImageUrl(src) {
    if (!src || typeof src !== "string") return src;

    let localOrigin = "";
    try {
        /* Images come from whichever server is answering, so the origin they
           resolve against moves with it. */
        localOrigin = POSNIC.server.imageOrigin || "";
    } catch (e) {
        localOrigin = "";
    }

    let resolvedUrl = localOrigin
        ? src.replace(/^http:\/\/(localhost|127\.0\.0\.1):5555/i, localOrigin)
        : src;

    /*
     * A RELATIVE PATH IS RELATIVE TO THE SERVER, NOT TO THE APP.
     *
     * Items carry paths like `/uploads/demo/rtl-sta-002.jpg`. In a browser
     * served BY the shop's server that resolves correctly and always has. In
     * the packaged app the page is served from http://localhost - so the same
     * path resolved to http://localhost/uploads/..., which is inside the APK,
     * and every item on the menu drew a broken image.
     *
     * Nothing in a browser test could see it: there the app and the images
     * share an origin, which is exactly the assumption the WebView breaks.
     */
    if (/^\//.test(resolvedUrl) && localOrigin) {
        resolvedUrl = localOrigin.replace(/\/+$/, '') + resolvedUrl;
    }

    try {
        if (!/^https?:\/\//i.test(resolvedUrl)) return resolvedUrl;
        const cacheKey = localStorage.getItem("POSNIC_IMAGE_CACHE_BUST");
        if (!cacheKey) return resolvedUrl;
        const url = new URL(resolvedUrl);
        url.searchParams.set("_posnic_img", cacheKey);
        return url.toString();
    } catch (e) {
        return resolvedUrl;
    }
}

function clearKioskLocalCache(options = {}) {
    const redirectTo = options.redirectTo || "index.html";
    const keepServer = options.keepServer !== false;

    const savedApiUrl = keepServer ? localStorage.getItem("POSNIC_API_URL") : null;
    const savedImageOrigin = keepServer ? localStorage.getItem("POSNIC_IMAGE_ORIGIN") : null;
    const imageCacheBust = String(Date.now());

    [
        "kiosk_selected_branch",
        "kiosk_branch_list",
        "kiosk_force_branch_select",
        "branch_id",
        "kiosk_tableorders",
        "orderType",
        "lastActiveCategory",
        "kiosk_table_no",
        "kiosk_table_id",
        "kiosk_discount_percentage",
        "kiosk_discount_amount",
        "kiosk_discount_description"
    ].forEach(key => localStorage.removeItem(key));

    /* Changing servers outright also drops the sign-in credential: it names a
       user on the server being left behind. */
    if (!keepServer) localStorage.removeItem("POSNIC_TOKEN");

    if (keepServer && savedApiUrl) localStorage.setItem("POSNIC_API_URL", savedApiUrl);
    if (keepServer && savedImageOrigin) localStorage.setItem("POSNIC_IMAGE_ORIGIN", savedImageOrigin);
    localStorage.setItem("POSNIC_IMAGE_CACHE_BUST", imageCacheBust);

    return new Promise(resolve => {
        try {
            if (db) {
                db.close();
                db = null;
            }
        } catch (e) { /* ignore */ }

        try {
            const req = indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
        } catch (e) {
            resolve();
        }
    }).then(() => {
        window.location.href = redirectTo;
    });
}

async function refreshKioskData() {
    await clearKioskLocalCache({ keepServer: true, redirectTo: "index.html" });
}

// ✅ Open IndexedDB
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            let db = event.target.result;

            if (!db.objectStoreNames.contains("products")) {
                let productStore = db.createObjectStore("products", { keyPath: "id" });
                productStore.createIndex("category_name", "category_name", { unique: false });
            }

            if (!db.objectStoreNames.contains("branch")) {
                db.createObjectStore("branch", { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("cart")) {
                db.createObjectStore("cart", { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("images")) {
                db.createObjectStore("images", { keyPath: "id" }); // ✅ this is your missing one
            }

            if (!db.objectStoreNames.contains("phonepe")) {
                db.createObjectStore("phonepe", { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("payment")) {
                db.createObjectStore("payment", { keyPath: "id" });
            }

        };


        request.onsuccess = () => {
            db = request.result;
            console.log("✅ IndexedDB Opened Successfully");
            resolve(db);
        };

        request.onerror = (event) => {
            console.error("❌ IndexedDB Error:", event.target.error);
            reject(event.target.error);
        };
    });
}

async function saveKioskPaymentToIndexedDB(paymentData) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(PAYMENT_STORE, "readwrite");
        const store = tx.objectStore(PAYMENT_STORE);
        store.put({ id: "payment_type", ...paymentData });

        tx.oncomplete = () => {
            console.log("✅ Kiosk payment types saved to IndexedDB");
            resolve();
        };
        tx.onerror = (err) => {
            console.error("❌ Failed to save payment types:", err);
            reject(err);
        };
    });
}
async function getKioskPayment() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(PAYMENT_STORE, "readonly");
        const store = tx.objectStore(PAYMENT_STORE);
        const req = store.get("payment_type");

        req.onsuccess = () => resolve(req.result);
        req.onerror = (err) => reject(err);
    });
}

// ✅ Get IndexedDB instance
async function getDB() {
    if (!db) {
        db = await openDB();
    }
    return db;
}

// ✅ Fetch data from IndexedDB
async function getData(storeName) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readonly");
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = (error) => reject(error);
    });
}

// ✅ Save Data to IndexedDB (Now Removes Outdated Products)
async function saveData(storeName, newData) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);

        // ✅ Fetch existing records
        const getAllRequest = store.getAll();
        getAllRequest.onsuccess = async () => {
            const existingData = getAllRequest.result;
            const existingIds = existingData.map(item => item.id);
            const newIds = newData.map(item => item.id);

            // ✅ Remove outdated items that are no longer in API response
            existingIds.forEach(id => {
                if (!newIds.includes(id)) {
                    store.delete(id);
                    console.log(`🗑️ Removed outdated product: ${id}`);
                }
            });

            // ✅ Clear and insert new data
            store.clear();
            newData.forEach(item => store.put(item));

            transaction.oncomplete = () => {
                console.log(`✅ Updated ${storeName} in IndexedDB`);
                resolve();
            };
            transaction.onerror = (error) => {
                console.error("❌ Transaction Error:", error);
                reject(error);
            };
        };
        getAllRequest.onerror = reject;
    });
}

async function saveKioskImagesToIndexedDB(images) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IMAGE_STORE, "readwrite");
        const store = tx.objectStore(IMAGE_STORE);
        store.put({ id: "kiosk", ...images });

        tx.oncomplete = () => {
            console.log("✅ Kiosk images saved to IndexedDB");
            updateKioskImageUI(images);
            resolve();
        };
        tx.onerror = (err) => {
            console.error("❌ Failed to save kiosk images:", err);
            reject(err);
        };
    });
}

async function getKioskImages() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IMAGE_STORE, "readonly");
        const store = tx.objectStore(IMAGE_STORE);
        const req = store.get("kiosk");

        req.onsuccess = () => resolve(req.result);
        req.onerror = (err) => reject(err);
    });
}

function updateKioskImageUI(data = {}) {
    const getImagePath = (val, fallback) => {
        try {
            if (!val || typeof val !== "string" || val.trim() === "") return `images/${fallback}`;
            return val.startsWith("http") ? val : `images/${val}`;
        } catch (err) {
            console.warn("⚠️ Error in getImagePath fallback:", err);
            return `images/${fallback}`;
        }
    };

    // ✅ Company Logo
    const logoPath = getImagePath(data.logo, "logo.png");
    $('img[alt="Company Logo"]').attr("src", logoPath);

    // ✅ Advertisement
    const adPath = getImagePath(data.advertisement, "banner1.jpg");
    $('img[alt="Advertisement"]').attr("src", adPath);

    // ✅ Banner background (e.g. top section)
    const bannerPath = getImagePath(data.banner, "banner.jpg");
    $('.top-banner').css("background-image", `url("${bannerPath}")`);

    // ✅ Homepage background image
    if (document.body.classList.contains("home-page")) {
        // const homeBanner = getImagePath(data.homebanner, "home.webp");
        const homeBanner = "images/home.webp";
        document.body.style.background = `url('${homeBanner}') no-repeat center center fixed`;
        document.body.style.backgroundSize = "cover";
    }

    console.log("✅ Kiosk UI Images Updated", {
        logoPath, adPath, bannerPath, homebanner: data.homebanner
    });
}




// ✅ Fetch and Store Branch Data
async function fetchAndStoreBranch(branchId, redirect = true, refreshUI = true) {
    try {
        const db = await getDB();
        const existingBranches = await getData(BRANCH_STORE);

        if (existingBranches.some(b => b.id === branchId)) {
            console.log("🔹 Branch exists. Checking for product updates...");
        }

        // ✅ Fetch products from API
        const result = await POSNIC.api.post("/items/accessQr", { branch: branchId });

        if (!localStorage.getItem("POSNIC_IMAGE_CACHE_BUST")) {
            localStorage.setItem("POSNIC_IMAGE_CACHE_BUST", String(Date.now()));
        }
        console.log("🔄 API Response:", result);

        if (result.type === "success" && result.data) {
            let products = [];

            const categories = result.data.products;
            const kioskImages = result.data.kiosk_images;
            const tableorders = result.data.tableorders || [];
            localStorage.setItem('kiosk_tableorders', JSON.stringify(tableorders));

            /*
             * What this SHOP decided about voice ordering.
             *
             * Kept separately from what this DEVICE was told, because they are
             * different decisions and the device's own wins: a handset with a
             * broken microphone can be switched off without touching the shop.
             * See assets/common/speech.js for the order they are read in.
             *
             * Where the audio goes and in what language, never which vendor
             * transcribes it and never a key. The server derives it; a phone
             * that knew the vendor is a phone that would eventually be asked
             * to hold the key for it.
             */
            try {
                localStorage.setItem('posnic.voice.shop', JSON.stringify(result.data.voice || {}));
            } catch (e) {
                /* private mode: this session still runs on the default */
            }

            // 🔴 IF NO PRODUCTS → show error, then force Choose Branch AFTER OK
            if (!Array.isArray(categories) || categories.length === 0) {
                /*
                 * AN EMPTY MENU IS NOT A REASON TO FORGET WHICH SHOP THIS IS.
                 *
                 * This used to clear the branch and force the picker on the
                 * next load - so a waiter whose menu failed to load was asked
                 * to choose a branch, about a problem choosing cannot fix. For
                 * a shop with one branch it asked them to choose between one
                 * thing, which is not a question.
                 *
                 * Only offered where it could possibly help: more than one
                 * branch to move between. Otherwise the branch is kept and the
                 * waiter is told what is actually wrong.
                 */
                let branchCount = 1;
                try {
                    branchCount = (JSON.parse(localStorage.getItem("kiosk_branch_list") || "[]") || []).length;
                } catch (e) {
                    branchCount = 1;
                }

                if (branchCount > 1) {
                    localStorage.removeItem("kiosk_selected_branch");
                    localStorage.setItem("kiosk_force_branch_select", "1");
                }

                hideLoader();

                showErrorPopup(
                    branchCount > 1
                        ? "This branch has no items to sell yet. Try another branch, or ask your manager to add items."
                        : "This shop has no items to sell yet. Ask your manager to add them, then try again.",
                    function () {
                        // user OK button press pannina apram dhaan redirect / reload
                        if (!window.location.pathname.endsWith("index.html")) {
                            window.location.href = "index.html";
                        } else {
                            window.location.reload();
                        }
                    }
                );

                return;  // don't save / don't redirect
            }
            if (kioskImages) {
                const extractFilename = (url, fallback) => {
                    try {
                        if (url && typeof url === 'string' && url.trim() !== '') {
                            const file = url.split('/').pop().split('?')[0];
                            return file || fallback;
                        }
                    } catch (e) {
                        console.warn("❌ Invalid URL for kiosk image:", url);
                    }
                    return fallback;
                };

                await saveKioskImagesToIndexedDB({
                    homebanner: extractFilename(kioskImages.homebanner, "home.webp"),
                    logo: extractFilename(kioskImages.logo, "logo.png"),
                    banner: extractFilename(kioskImages.banner, "banner.jpg"),
                    advertisement: extractFilename(kioskImages.advertisement, "banner1.jpg")
                });
            }

            categories.forEach(category => {
                category.items.forEach(item => {
                    let imageSrc = (!item.img || item.img.trim() === "" || item.img === "item.svg") ? "images/default-product.webp" : resolveLocalImageUrl(item.img);
                    products.push({
                        id: item.id?.$oid || item.id?.toString() || Date.now(),
                        name: item.name || "Unknown",
                        available_quantity: item.available_quantity || 0,
                        negative_stock: !!item.negative_stock,
                        // ✅ use backend fields as-is
                        price: parseFloat(item.final_price) || 0,   // 201.60
                        discount_price: parseFloat(item.discount_price) || 0,  // 6.56
                        tax_price: parseFloat(item.tax_price) || 0,   // 44.10
                        subtotal: parseFloat(item.price) || 0,   // 164.06
                        final_price: parseFloat(item.final_price) || 0,   // 201.60
                        img: imageSrc,
                        category_name: category.category_name,
                        item_description: item.description || item.item_description || ""
                    });
                });
            });

            // ✅ Save branch & products in IndexedDB
            // also persist the MongoDB branch_id (may differ from storeId/branchId)
            const actualBranchId = localStorage.getItem('branch_id') || branchId;
            await saveData(BRANCH_STORE, [{ id: branchId, branch_id: actualBranchId, kioskPayment: result.data.kiosk_payment }]);
            await saveData(STORE_NAME, products);

            console.log("✅ Product data updated successfully!");

            const kioskPayment = result.data.kiosk_payment;
            if (kioskPayment) {
                await saveKioskPaymentToIndexedDB(kioskPayment);
            }

            // ✅ Only validate cart + reload UI when we are actually refreshing the screen
            // ✅ Update cart + UI based on mode
            if (refreshUI) {
                // normal flow (login / first load / manual refresh): clean cart + reload UI
                await validateCartWithProducts(products);
                await loadProducts();
            } else {
                // background flow: clean cart ONLY, UI stays as-is
                await syncCartSilently(products);
                console.log("✅ Products and cart updated silently in background");
            }

            if (redirect) {
                // set a default order type since home.html will be skipped
                if (!localStorage.getItem("orderType")) {
                    localStorage.setItem("orderType", "Dine-in"); // or "PARCEL"
                }
                hideLoader();
                window.location.href = "kot-management.html";
                return;
            }
        } else {
            console.warn("❌ No data received from API.");
        }
    } catch (error) {
        console.error("❌ Error updating product data:", error);
        throw error;
    }
}


async function validateCartWithProducts(updatedProducts) {
    const cartData = await getCartData();
    const productMap = new Map(updatedProducts.map(p => [p.id, p])); // 🔁 Map for quick access

    // 🔄 Update cart items with latest product info
    const syncedCart = cartData
        .map(item => {
            const updatedProduct = productMap.get(item.id);

            // product not found in latest list → remove from cart
            if (!updatedProduct) {
                return null;
            }

            const allowNegative = updatedProduct?.negative_stock === true;
            if (updatedProduct && (allowNegative || (updatedProduct.available_quantity || 0) > 0)) {
                return {
                    ...item,
                    name: updatedProduct.name,
                    img: updatedProduct.img,
                    price: Number(updatedProduct.price || item.price || 0),
                    discount_price: Number(updatedProduct.discount_price || item.discount_price || 0),
                    tax_price: Number(updatedProduct.tax_price || item.tax_price || 0),
                    subtotal: Number(updatedProduct.subtotal || item.subtotal || 0),
                    final_price: Number(updatedProduct.final_price || item.final_price || 0),
                };
            }
            return null; // Item no longer exists OR disabled for kiosk
        })
        .filter(Boolean);

    if (syncedCart.length !== cartData.length) {
        console.log("🗑️ Removed outdated cart items.");
    } else {
        console.log("🔄 Synced cart items with latest product data.");
    }

    await saveCartData(syncedCart);
    if (window.location.pathname.includes('cart.html')) {
        renderCart(syncedCart);
    }
}

async function syncCartSilently(updatedProducts) {
    const cartData = await getCartData();
    const productMap = new Map(updatedProducts.map(p => [p.id, p]));

    const syncedCart = cartData
        .map(item => {
            const updatedProduct = productMap.get(item.id);
            if (updatedProduct) {
                return {
                    ...item,
                    name: updatedProduct.name,
                    img: updatedProduct.img,
                    price: updatedProduct.price,
                    tax_price: updatedProduct.tax_price,
                };
            }
            // product not found in latest list → remove from cart
            return null;
        })
        .filter(Boolean);

    if (syncedCart.length !== cartData.length) {
        console.log("🗑️ [silent] Removed outdated cart items.");
    }

    await saveCartData(syncedCart);   // no renderCart, no redirect
}

// ✅ Optimized renderCart function
async function renderCart(cartData = null, skipRedirect = false) {
    try {
        if (!cartData) {
            cartData = await getCartData(); // ✅ Fetch only if not already available
        }

        // remember which extra panels are currently open
        const expandedIds = new Set(
            Array.from(document.querySelectorAll('.cart-item-extra'))
                .filter(el => el.style.display !== 'none')
                .map(el => el.id.replace('cart-item-extra-', ''))
        );

        let totalPrice = 0;
        let totalQty = 0;
        let html = "";

        if (cartData.length === 0) {
            $("#next-btn").prop("disabled", true);
            $("#cart-summary").html("<p class='text-center'>Cart is empty</p>");
            $("#cart-total,#cart-qty,#mobile-cart-count").text("0.00");
            $("#summary-display").text(`0 Items | ₹0.00`);

            if (!skipRedirect) {
                setTimeout(() => {
                    window.location.href = "kot-management.html";
                }, 2000);
            }
            return;
        }

        cartData.forEach(item => {
            const qty = item.quantity || 0;
            const subtotal = Number(item.subtotal || 0);
            const discountUnit = Number(item.discount_price || 0);
            const taxUnit = Number(item.tax_price || 0);
            const finalUnit = Number(item.final_price || 0);

            const lineSubtotal = subtotal * qty;
            const lineDiscount = discountUnit * qty;
            const lineTax = taxUnit * qty;
            const lineFinal = finalUnit
                ? finalUnit * qty
                : lineSubtotal - lineDiscount + lineTax;

            totalQty += qty;
            totalPrice += lineFinal;   // use final for footer total

            const item_name = item.name.length > 25 ? item.name.substring(0, 25) + '...' : item.name;
            const isExpanded = expandedIds.has(String(item.id));

            html += `
    <div class="cart-item" id="cart-item-${item.id}">
        <button class="expand-toggle ${isExpanded ? 'expanded' : ''}"
                onclick="toggleCartItemDetails('${item.id}', event)">
            <span class="expand-icon">${isExpanded ? '▴' : '▾'}</span>
        </button>
        <img src="${resolveLocalImageUrl(item.img)}" alt="${item_name}" class="item-image">
        <div class="item-content">
            <div class="item-details">
                <div class="item-name">${item_name}</div>
                ${item.notes ? `<div class="item-notes">${item.notes}</div>` : ""}
                <div class="item-prices">
                    <span class="unit-price">₹${finalUnit.toFixed(2)} per item</span>
                    <span class="total-price">₹${lineFinal.toFixed(2)}</span>
                </div>
            </div>

            <div class="quantity-control">
                <button class="qty-btn" onclick="updateCartQuantity('${item.id}', -1)">-</button>
                <span class="qty-value" id="qty-${item.id}">${qty}</span>
                <button class="qty-btn" onclick="updateCartQuantity('${item.id}', 1)">+</button>
            </div>
        </div>

        <!-- Hidden extra price details -->
        <div class="cart-item-extra" id="cart-item-extra-${item.id}" style="${isExpanded ? '' : 'display:none;'}">
            <div class="cart-item-extra-inner">
                <div class="cart-item-line">
                    <span class="cart-line-label">Subtotal</span>
                    <span class="cart-line-value">₹${lineSubtotal.toFixed(2)}</span>
                </div>
                <div class="cart-item-line">
                    <span class="cart-line-label">Discount</span>
                    <span class="cart-line-value">‑₹${lineDiscount.toFixed(2)}</span>
                </div>
                <div class="cart-item-line">
                    <span class="cart-line-label">Tax</span>
                    <span class="cart-line-value">₹${lineTax.toFixed(2)}</span>
                </div>
                <div class="cart-item-line cart-item-final">
                    <span class="cart-line-label">Total</span>
                    <span class="cart-line-value">
                        ₹${finalUnit.toFixed(2)} × ${qty} = ₹${lineFinal.toFixed(2)}
                    </span>
                </div>
            </div>
        </div>
    </div>`;
        });

        $("#cart-summary").html(html);
        $("#summary-display").text(`${totalQty} Items | ₹${totalPrice.toFixed(2)}`);
        $('#cart-qty,#mobile-cart-count').html(totalQty);
        $("#cart-total").text(totalPrice.toFixed(2));
        // Auto-adjust font size based on content length
        const cartTotalEl = document.getElementById('cart-total');
        const cartSummary = document.querySelector('.discount-cart-summary');
        if (cartTotalEl && cartSummary) {
            const totalText = cartTotalEl.textContent;
            cartSummary.classList.remove('long-content', 'very-long-content');

            if (totalText.length > 8) {
                cartSummary.classList.add('very-long-content');
            } else if (totalText.length > 6) {
                cartSummary.classList.add('long-content');
            }
        }
        const loader = document.getElementById('page-loader');
        loader.style.display = 'none';

    } catch (error) {
        console.error("❌ Error rendering cart:", error);
    }
}

function toggleCartItemDetails(id, evt) {
    if (evt) {
        evt.stopPropagation();
        evt.preventDefault();
    }
    const el = document.getElementById(`cart-item-extra-${id}`);
    if (!el) return;

    const willShow = (el.style.display === 'none' || el.style.display === '');
    el.style.display = willShow ? 'block' : 'none';

    // update arrow icon on the same row
    const row = document.getElementById(`cart-item-${id}`);
    if (!row) return;
    const btn = row.querySelector('.expand-toggle');
    const icon = btn ? btn.querySelector('.expand-icon') : null;
    if (btn && icon) {
        btn.classList.toggle('expanded', willShow);
        icon.textContent = willShow ? '▴' : '▾';
    }
}

// ✅ Optimized remove function: No redundant IndexedDB calls
async function removeCartItem(id) {
    let cartData = await getCartData();
    cartData = cartData.filter(i => i.id !== id); // 🔥 Remove from IndexedDB cart

    await saveCartData(cartData);

    // 🔥 Immediately remove from UI
    $(`#cart-item-${id}`).remove();

    // ✅ Pass updated cartData directly to renderCart
    renderCart(cartData);
}

// ✅ Optimized update function: Prevents multiple IndexedDB calls
async function updateCartQuantity(id, change) {
    const storedProducts = await getData("products");
    const storedProduct = storedProducts.find(item => item.id === id);
    let cartData = await getCartData();
    let totalQty = 0;
    let item = cartData.find(i => i.id === id);
    if (!item) return;

    const allowNegative = storedProduct?.negative_stock === true;
    const totalStock = storedProduct?.available_quantity || 0;

    // 🔒 Block increment if already reached available stock (only for non-negative-stock)
    if (!allowNegative && change > 0 && item.quantity >= totalStock) {
        return; // nothing to do
    }

    item.quantity += change;

    cartData.forEach(it => {
        totalQty += it.quantity;
    });

    $("#checkout-btn").prop("disabled", false);
    if (totalQty <= 0) {
        $("#checkout-btn").prop("disabled", true);
    }

    if (item.quantity <= 0) {
        cartData = cartData.filter(i => i.id !== id);
        $(`#cart-item-${id}`).remove();
    }

    await saveCartData(cartData);
    renderCart(cartData);
}

async function loadProducts() {
    console.log("🔄 Loading products from IndexedDB...");
    const storedProducts = await getData("products");

    if (storedProducts.length === 0) {
        console.error("❌ No products found in IndexedDB!");
        return;
    }

    products = {};
    let categories = new Set();

    storedProducts.forEach(product => {
        let categoryKey = product.category_name.toLowerCase().replace(/\s/g, "_");
        if (!products[categoryKey]) products[categoryKey] = [];
        products[categoryKey].push(product);
        categories.add(
            `<div class="category-item" data-category="${categoryKey}" onclick="showCategory('${categoryKey}', this)">${product.category_name}</div>`
        );
    });

    // ✅ Build "All" category = combination of all products
    const allProducts = [];
    Object.values(products).forEach(arr => allProducts.push(...arr));
    products["all"] = allProducts;

    // ✅ Build HTML with "All" first, then other categories
    const allChip = `<div class="category-item" data-category="all" onclick="showCategory('all', this)">All</div>`;
    const otherChips = [...categories].join("");
    $("#category-list").html(allChip + otherChips);

    // ✅ Retrieve last active category from localStorage
    let lastActiveCategory = localStorage.getItem("lastActiveCategory");

    // ✅ If we have a saved category, restore it
    if (lastActiveCategory && products[lastActiveCategory]) {
        const categoryElement = $(`.category-item[data-category='${lastActiveCategory}']`).first();
        if (categoryElement.length) {
            categoryElement.addClass("active");
            showCategory(lastActiveCategory, categoryElement[0]);
            return;
        }
    }

    // ✅ Otherwise, default to "All"
    const allElement = $(".category-item[data-category='all']").first();
    if (allElement.length) {
        allElement.addClass("active");
        showCategory("all", allElement[0]);
    }
}

async function showCategory(category, element) {
    $(".category-item").removeClass("active");
    $(element).addClass("active");

    // ✅ Update heading dynamically
    let categoryName = $(element).text();
    $("#category-heading").text(categoryName);

    // ✅ Store the last active category in localStorage
    localStorage.setItem("lastActiveCategory", category);

    let html = "";

    // make a sorted copy: in-stock first, then "Not available"
    const sortedProducts = [...products[category]].sort((a, b) => {
        const aAllowNeg = a.negative_stock === true;
        const bAllowNeg = b.negative_stock === true;

        const aOut = !aAllowNeg && (a.available_quantity || 0) <= 0;
        const bOut = !bAllowNeg && (b.available_quantity || 0) <= 0;

        if (aOut === bOut) return 0;   // both in-stock or both out-of-stock → keep order
        return aOut ? 1 : -1;          // out-of-stock goes AFTER in-stock
    });

    // ✅ read cart only once
    const storedCart = await getCartData();
    const cartMap = new Map(storedCart.map(i => [i.id, i]));

    for (let product of sortedProducts) {
        let cartItem = cartMap.get(product.id);
        let quantity = cartItem ? cartItem.quantity : 0;
        const hasQty = quantity > 0;
        const activeClass = quantity > 0 ? "active" : "";

        let product_name = product.name;

        const allowNegative = product.negative_stock === true;
        const outOfStock = !allowNegative && (product.available_quantity || 0) <= 0;
        const remaining = Math.max((product.available_quantity || 0) - quantity, 0);

        const stockLabel = allowNegative
            ? 'Stock: ∞'
            : `Stock: ${remaining}`;

        html += `
        <div class="product-card ${activeClass} ${outOfStock ? 'disabled' : ''}" data-id="${product.id}">
            <div class="stock-badge" id="stock-${product.id}">
                ${stockLabel}
            </div>
            <img src="${resolveLocalImageUrl(product.img)}" alt="${product_name}">
            <p class="product-title">${product_name}</p>
            <div class="product-price">
                ${outOfStock
                ? '<span class="out-of-stock">Not available</span>'
                : `₹${product.price.toFixed(2)}`
            }
            </div>

            <!-- When qty = 0 → show ADD -->
            <div class="cart-empty ${hasQty ? 'hidden' : ''}">
                <button class="btn-add" data-id="${product.id}" ${outOfStock ? 'disabled' : ''}>ADD</button>
            </div>

            <!-- When qty > 0 → show - 0 + -->
            <div class="cart-controls ${hasQty ? '' : 'hidden'}">
                <button class="btn-decrease" data-id="${product.id}" ${outOfStock || quantity <= 0 ? 'disabled' : ''}>-</button>
                <span id="qty-${product.id}" style="font-size: 18px; font-weight: bold;">${quantity}</span>
                <button class="btn-increase" data-id="${product.id}" ${outOfStock ? 'disabled' : ''}>+</button>
            </div>
        </div>`;
    }

    $("#product-list").html(html);
    updateCart();
    const loader = document.getElementById('page-loader');
    loader.style.display = 'none';
}

// ✅ Event Binding for `.product-card` Clicks
// $(document).on("click", ".product-card", async function () {
//     let productId = $(this).data("id");
//     await updateQuantity(productId, 1);
// });
// ✅ Event Binding for Quantity Buttons
// $(document).on("click", ".btn-increase", async function () {
//     let productId = $(this).data("id");
//     await updateQuantity(productId, 1);
// });

// ✅ Update Quantity and Save to IndexedDB
async function updateQuantity(id, change) {
    // ✅ only read needed product
    const storedProduct = await getProductById(id);

    let cartData = await getCartData();
    let item = cartData.find(i => i.id === id);
    if (!storedProduct) return;

    if (!item) {
        if (change < 0) return; // Prevent decreasing before item exists
        let product = storedProduct;
        if (!product) return;

        item = {
            id: product.id,
            name: product.name,
            img: product.img,
            price: Number(product.price || 0),
            discount_price: Number(product.discount_price || 0),
            tax_price: Number(product.tax_price || 0),
            subtotal: Number(product.subtotal || 0),
            final_price: Number(product.final_price || 0),
            quantity: 0
        };
    }

    const allowNegative = storedProduct?.negative_stock === true;
    const totalStock = storedProduct?.available_quantity || 0;

    // 🔒 Block increment if we already reached available stock (for non-negative-stock items)
    if (!allowNegative && change > 0 && item.quantity >= totalStock) {
        return; // do nothing – keep quantity and stock badge as is
    }

    item.quantity += change;

    // ✅ Prevent negative quantity
    if (item.quantity < 0) item.quantity = 0;

    // After modifying item.quantity...

    // Update remaining stock badge on product card (for non-negative-stock items)
    if (!allowNegative) {
        const totalStock = storedProduct.available_quantity || 0;
        const currentQty = item.quantity || 0;
        const remaining = Math.max(totalStock - currentQty, 0);
        const stockEl = document.getElementById(`stock-${id}`);
        if (stockEl) {
            stockEl.textContent = `Stock: ${remaining}`;
        }
    }

    // ✅ Update or remove from cart
    if (item.quantity === 0) {
        cartData = cartData.filter(i => i.id !== id);
    } else {
        const index = cartData.findIndex(i => i.id === id);
        if (index !== -1) {
            cartData[index] = item;
        } else {
            cartData.push(item);
        }
    }

    await saveCartData(cartData);
    updateCart();

    // ✅ Update UI quantity text
    $('#qty-' + id).text(item.quantity);
    // Toggle ADD vs - 0 + controls
    const hasQty = item.quantity > 0;
    const $card = $(`.product-card[data-id="${id}"]`);
    $card.find(".cart-empty").toggleClass("hidden", hasQty);
    $card.find(".cart-controls").toggleClass("hidden", !hasQty);

    // ✅ Disable or enable "-" button
    const $decreaseBtn = $(`.btn-decrease[data-id="${id}"]`);
    const $productCard = $(`.product-card[data-id="${id}"]`);
    if (item.quantity === 0) {
        $decreaseBtn.prop("disabled", true);
        $productCard.removeClass("active");
    } else {
        $decreaseBtn.prop("disabled", false);
        $productCard.addClass("active");
    }
}

async function updateCart() {
    let totalQty = 0;
    let totalPrice = 0;

    try {
        let storedCart = await getCartData();

        storedCart.forEach(item => {
            totalQty += item.quantity;
            totalPrice += item.quantity * item.price;

            // ✅ Update UI for each item
            $(`#qty-${item.id}`).text(item.quantity);
        });

        if (totalQty === 0) {
            $(".next-page")
                .addClass("disabled")
                .off("click.tableOrderCart"); // disables click handler
        } else {
            $(".next-page")
                .off("click.tableOrderCart")
                .on("click.tableOrderCart", () => window.location.href = 'cart.html');
            $(".next-page").removeClass("disabled");
        }


        $("#cart-qty,#mobile-cart-count").text(totalQty);
        $("#cart-total").text(totalPrice.toFixed(2));
        $("#summary-display").text(`${totalQty} Items | ₹${totalPrice.toFixed(2)}`);
        $("#next-btn").prop("disabled", totalQty === 0);
    } catch (error) {
        console.error("❌ Error updating cart:", error);
    }
}

// ✅ Check if IndexedDB has a branch and redirect
async function checkBranchAndRedirect() {
    const branches = await getData(BRANCH_STORE);
    if (branches.length > 0) {
        // Restore localStorage keys if missing (e.g. after page refresh or direct navigation)
        const branch = branches[0];
        if (!localStorage.getItem('branch_id')) {
            localStorage.setItem('branch_id', branch.branch_id || branch.id);
        }
        if (!localStorage.getItem('kiosk_selected_branch')) {
            localStorage.setItem('kiosk_selected_branch', branch.id);
        }
        // Re-fetch from API if table/product data is missing (e.g. after hard refresh)
        const hasTableorders = localStorage.getItem('kiosk_tableorders');
        if (!hasTableorders) {
            fetchAndStoreBranch(branch.id, false, true);
        }
        console.log("✅ Branch already exists, skipping redirect.");
        return;
    } else {
        const db = await getDB();
        const tx = db.transaction([BRANCH_STORE, STORE_NAME, CART_STORE, PHONEPE_STORE, IMAGE_STORE, PAYMENT_STORE], "readwrite");

        tx.objectStore(BRANCH_STORE).clear();
        tx.objectStore(STORE_NAME).clear();
        tx.objectStore(CART_STORE).clear();
        tx.objectStore(PHONEPE_STORE).clear();
        tx.objectStore(IMAGE_STORE).clear();
        tx.objectStore(PAYMENT_STORE).clear();
        console.log("🚀 First-time branch entry required.");
    }
}

// ✅ Refresh IndexedDB every 1 minute without redirect
(async () => {
    /* config.js chooses the server synchronously, so there is nothing to await
       before the first request. */
    await checkBranchAndRedirect();

    setInterval(async () => {
        console.log("🔄 Checking for product updates...");
        const branches = await getData(BRANCH_STORE);
        if (!branches.length) return;

        if (window.location.pathname.includes('products')) {
            const input = document.getElementById('product-search-input');
            if (input && input.value.trim() !== '') {
                console.log("⏸ Skipping product refresh because search is active");
                return;
            }
        }

        await fetchAndStoreBranch(branches[0].id, false, false);
    }, 20000); // 20,000 ms = 20 seconds
})();

// ✅ Run branch check on page load
//checkBranchAndRedirect();


async function getCartData() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("cart", "readonly");
        const store = transaction.objectStore("cart");
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = (error) => reject(error);
    });
}

async function getProductById(id) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("products", "readonly");
        const store = transaction.objectStore("products");
        const request = store.get(id);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (error) => reject(error);
    });
}

async function saveCartData(cart) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("cart", "readwrite");
        const store = transaction.objectStore("cart");

        store.clear();
        cart.forEach(item => store.put(item));

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

function onCancelClick() {
    document.getElementById("cancelModal").style.display = "flex";
}

async function confirmCancelOrder() {
    // Clear the cart
    await saveCartData([]); // Clear IndexedDB cart

    const cartSummary = document.getElementById("cart-summary");
    if (cartSummary) {
        cartSummary.innerHTML = ""; // Clear cart UI
    }

    // summary-display is not present on cart.html, so guard it
    const summaryEl = document.getElementById("summary-display");
    if (summaryEl) {
        summaryEl.textContent = "0 Items | ₹0.00";
    }

    closeCancelModal(); // Close the modal

    // Redirect to products page
    window.location.href = "kot-management.html";
}

function closeCancelModal() {
    document.getElementById("cancelModal").style.display = "none";
}

// ✅ Load cart from IndexedDB on page load
async function loadCart() {
    const cartItems = await getCartData();
    let cart = cartItems.reduce((acc, item) => {
        acc[item.id] = item;
        return acc;
    }, {});

    console.log("🛒 Loaded Cart from IndexedDB:", cart);
    return cart; // ✅ Return cart data
}

async function checkout(transactionId) {
    try {
        // 🔄 Get cart data from IndexedDB
        const cartItems = await getCartData();
        console.log('cartItems:', cartItems);

        if (!cartItems || cartItems.length === 0) {
            console.log("Cart is empty.");
            return;
        }

        // 🧾 Prepare payload: [{ id, quantity }]
        const payload = cartItems.map(item => {
            return {
                item_id: item.id,
                item_name: item.name || item.item_name || '',
                item_quantity: item.quantity,
                item_price: item.final_price || item.price || 0,
                item_subtotal: (item.final_price || item.price || 0) * item.quantity,
                gst: (item.tax_price || 0) * item.quantity,
                item_description: item.notes || ""
            };
        });

        // 🏪 Get branch ID (MongoDB ObjectId expected by backend)
        const branches = await getData(BRANCH_STORE);
        let branchId = null;

        if (branches && branches.length > 0) {
            const branch = branches[0];
            // Prefer persisted MongoDB branch_id, fall back to legacy id
            branchId = branch.branch_id || branch.id || null;
        }

        // Extra safety: fall back to localStorage if needed
        if (!branchId) {
            branchId = localStorage.getItem('branch_id') || null;
        }
        const orderType = localStorage.getItem("orderType");
        const note = localStorage.getItem('note');

        const discountPercentage = parseFloat(localStorage.getItem('kiosk_discount_percentage')) || 0;
        const discountAmount = parseFloat(localStorage.getItem('kiosk_discount_amount')) || 0;
        const discountDescription = localStorage.getItem('kiosk_discount_description') || '';
        const tableNo = localStorage.getItem('kiosk_table_no') || '';
        const tableId = localStorage.getItem('kiosk_table_id') || '';
        const personCount = parseInt(localStorage.getItem('kiosk_person_count') || '0', 10) || 0;
        //await fetchAndStoreBranch(branchId, false);

        if (!branchId) {
            console.log("Branch not found.");
            return;
        }
        //const savedNumber = localStorage.getItem("kiosk_mobile_number");

        /* Made once, before the first attempt, and reused on every retry:
           a key minted per attempt makes each resend look like a new order,
           which is the thing it exists to prevent. */
        const orderKey = OrderQueue.newKey();

        // 🚀 Send checkout request
        const orderBody = {
                idempotencyKey: orderKey,
                branch: branchId,
                items: payload,
                customerMobile: '+910000000000',
                transactionId: transactionId,
                tokenId: generateUniqueToken(),
                payment_status: "cash",
                /* Not renamed with the app. The POS stores this string on
                   every sale and reports on it, so changing it would split a
                   shop's history in two at the version boundary. */
                sale_method: 'Table-Order',
                order: orderType,
                note: note,
                kiosk_discount_percentage: discountPercentage,
                kiosk_discount_amount: discountAmount,
                kiosk_discount_description: discountDescription,
                kiosk_table_no: tableNo,
                kiosk_table_id: tableId,
                dine_type: orderType || 'Dine-in',
                person_count: (orderType === 'Dine-in') ? personCount : ''
        };

        /* Held so the catch below can keep exactly what was sent, rather than
           rebuilding it from state the failure may already have changed. */
        window._pendingOrder = { key: orderKey, branch: branchId, body: orderBody };

        const result = await POSNIC.api.post("/sales/qrOrder", orderBody);
        window._pendingOrder = null;

        if (result.type === "success") {
            const tokenId = result.data.tokenId; // 🔐 3-digit non-repeating token
            localStorage.setItem("kioskReceipt", JSON.stringify(result.data));

            /*
             * Keep what was just ordered, so it can be ordered again.
             *
             * "Same again" is a normal thing to say at a table and currently
             * means finding every item by hand a second time. Stored per
             * branch and kept small: this is a convenience, not a record, and
             * the sale itself is the record.
             */
            try {
                localStorage.setItem('posnic.last-order', JSON.stringify({
                    branch: branchId,
                    at: Date.now(),
                    items: (payload || []).map(i => ({
                        item_id: i.item_id,
                        item_name: i.item_name,
                        item_quantity: i.item_quantity,
                    })),
                }));
            } catch (e) { /* a convenience, never worth failing an order for */ }

            // 🔄 After order, refresh branch products so stock is updated immediately
            try {
                if (branchId && typeof fetchAndStoreBranch === 'function') {
                    await fetchAndStoreBranch(branchId, false, true);
                }
            } catch (e) {
                console.error('Failed to refresh products after order', e);
            }

            // 🧹 Clear cart in IndexedDB and UI (skip the auto-redirect to discount.html)
            await saveCartData([]);
            await renderCart([], true);

            // 🧹 Clear relevant localStorage items
            localStorage.removeItem("kiosk_mobile_number");
            localStorage.removeItem('kiosk_discount_percentage');
            localStorage.removeItem('kiosk_discount_amount');
            localStorage.removeItem('kiosk_discount_description');
            localStorage.removeItem('kiosk_table_no');
            localStorage.removeItem('kiosk_person_count');

            console.log("✅ Checkout successful! Token:", tokenId);

            // 🚀 Final navigation to Thank You page
            // Use explicit .html so it works in both browser server and Capacitor WebView
            window.location.href = `thankyou.html?token=${tokenId}`;
        } else {
            console.log("❌ Checkout failed:", result.message || result);
            showErrorPopup(result.message || "Order failed. Please try again.");
        }

    } catch (error) {
        console.log("❌ Error during checkout:", error);

        /*
         * An order that never reached a server is kept, not lost.
         *
         * Only when the request never got an answer. A server that REFUSED
         * the order refused it for a reason - an item gone, a branch not
         * configured - and queueing that would retry a rejection for ever.
         */
        const unreachable = error && (error.code === 'OFFLINE' || error.code === 'TIMEOUT');
        if (unreachable && typeof OrderQueue !== 'undefined' && window._pendingOrder) {
            OrderQueue.add(window._pendingOrder);
            window._pendingOrder = null;
            hideOrderProcessingScreen();
            showErrorPopup(
                "No connection to the shop, so this order is saved on the phone and " +
                "NOT yet with the kitchen. It will be sent when the connection is back."
            );
            await saveCartData([]);
            await renderCart([]);
            return false;
        }

        showErrorPopup("Order failed. Please try again.");
    }
}

function getTodayKey() {
    const today = new Date();
    return `kiosk_tokens_${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
}

function getStoredTokens() {
    const key = getTodayKey();
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
}

function saveToken(token) {
    const key = getTodayKey();
    const tokens = getStoredTokens();
    tokens.push(token);
    localStorage.setItem(key, JSON.stringify(tokens));
}

function getAllPossibleTokens() {
    const tokens = [];
    for (let i = 65; i <= 90; i++) { // a to z
        const prefix = String.fromCharCode(i);
        for (let j = 1; j <= 999; j++) {
            tokens.push(`${prefix}${j.toString().padStart(3, '0')}`);
        }
    }
    return tokens;
}

function generateUniqueToken() {
    const usedTokens = getStoredTokens();
    const allTokens = getAllPossibleTokens();
    const remaining = allTokens.filter(t => !usedTokens.includes(t));

    if (remaining.length === 0) {
        console.warn("🔁 All tokens used. Resetting for the next cycle.");
        localStorage.removeItem(getTodayKey());
        return generateUniqueToken(); // Retry after reset
    }

    const token = remaining[Math.floor(Math.random() * remaining.length)];
    saveToken(token);
    return token;
}

async function storePhonePeData(id) {
    try {
        await saveData(PHONEPE_STORE, [{ id: id }]);
    } catch (error) {
        console.error("❌ Error updating PhonePe data:", error);
    }
}

async function getFirstPhonePeId() {
    const phonepeData = await getData(PHONEPE_STORE);
    if (phonepeData.length > 0) {
        return phonepeData[0].id;
    }
    return null;
}

function showPopup() {
    const popup = document.getElementById('popup');

    // Reset the state
    popup.classList.remove('show');
    popup.style.display = 'block';
    void popup.offsetWidth; // force reflow

    // Show with animation
    popup.classList.add('show');

    // Auto-hide after 3 seconds
    setTimeout(() => {
        hidePopup();
    }, 3000);
}

function hidePopup() {
    const popup = document.getElementById('popup');
    popup.classList.remove('show');
    setTimeout(() => {
        popup.style.display = 'none';
    }, 300); // match transition
}

// Close on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        hidePopup();
    }
});

