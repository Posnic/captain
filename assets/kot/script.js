function showLoader() {
    const loader = document.getElementById("loader");
    if (loader) loader.style.display = "flex";
}

function hideLoader() {
    const loader = document.getElementById("loader");
    if (loader) loader.style.display = "none";
}

function refreshPage() {
    window.location.reload();
}

function goToKotHistory() {
    window.location.href = 'order-history.html';
}

function goToAddKot() {
    window.location.href = 'discount.html';
}

/*
 * Offered only when there is somewhere to change TO.
 *
 * A shop with a single branch was shown this button, and it led to a list
 * with one card on it. Not a choice, and one more thing on a screen a waiter
 * reads at speed while standing at a table.
 */
function showChangeBranchIfUseful() {
    const button = document.getElementById('kot-change-branch');
    if (!button) return;
    let branches = [];
    try {
        branches = JSON.parse(localStorage.getItem('kiosk_branch_list') || '[]') || [];
    } catch (e) {
        branches = [];
    }
    button.hidden = branches.length < 2;
}
document.addEventListener('DOMContentLoaded', showChangeBranchIfUseful);

async function changeBranch() {
    try {
        localStorage.setItem('kiosk_force_branch_select', '1');
        window.location.href = 'index.html';
    } catch (e) {
        console.error('Failed to change branch', e);
    }
}

async function signOut() {
    localStorage.removeItem('kiosk_selected_branch');
    localStorage.removeItem('kiosk_branch_list');
    localStorage.removeItem('kiosk_force_branch_select');
    localStorage.removeItem('branch_id');
    localStorage.removeItem('user_id');
    localStorage.removeItem('orderType');
    localStorage.removeItem('lastActiveCategory');
    localStorage.removeItem('kiosk_table_no');
    localStorage.removeItem('kiosk_table_id');
    sessionStorage.clear();
    try {
        const db = await getDB();
        const tx = db.transaction([BRANCH_STORE, STORE_NAME, CART_STORE], 'readwrite');
        tx.objectStore(BRANCH_STORE).clear();
        tx.objectStore(STORE_NAME).clear();
        tx.objectStore(CART_STORE).clear();
    } catch (e) { /* ignore */ }
    window.location.href = 'index.html';
}


async function checkBranchCount() {
    try {
        const branchBtn = document.querySelector('.kot-btn-branch');
        if (!branchBtn) return;
        
        // Get branches from localStorage
        const branchesData = localStorage.getItem('kiosk_branch_list');
        let branches = [];
        
        if (branchesData) {
            try {
                branches = JSON.parse(branchesData);
            } catch (e) {
                console.error('Failed to parse kiosk_branch_list', e);
            }
        }
        
        // If only 1 branch, show Sign Out button instead
        if (branches.length === 1) {
            branchBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Sign Out';
            branchBtn.onclick = signOut;
        } else {
            branchBtn.innerHTML = '<i class="fas fa-store"></i> Change Branch';
            branchBtn.onclick = changeBranch;
        }
    } catch (e) {
        console.error('Failed to check branch count', e);
    }
}

function showSectionLoader(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    
    const loader = document.createElement('div');
    loader.className = 'section-loader';
    loader.innerHTML = '<div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div>';
    loader.style.cssText = 'position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(255,255,255,0.9); display: flex; align-items: center; justify-content: center; z-index: 10;';
    
    section.style.position = 'relative';
    section.appendChild(loader);
}

function hideSectionLoader(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    
    const loader = section.querySelector('.section-loader');
    if (loader) loader.remove();
}

function isServerConnectionError(error) {
    const message = error && error.message ? error.message : String(error || '');
    return error?.name === 'AbortError' ||
        /Failed to fetch|NetworkError|timeout|Load failed/i.test(message);
}

async function loadTables() {
    const container = document.getElementById('tables-list');
    const noOrdersMsg = document.getElementById('no-orders-message');
    
    if (!container) return;

    try {
        showSectionLoader('tables-list');
        // Get branch_id from localStorage
        // kiosk_selected_branch stores the store_id (MongoDB _id) as a plain string
        const branchId = localStorage.getItem('branch_id') || null;

        const data = await POSNIC.api.post('/sales/getTablesWithActiveOrders', {
            branch_id: branchId
        });
        
        if (data.type !== 'success' || !data.data) {
            if (noOrdersMsg) noOrdersMsg.style.display = 'flex';
            container.innerHTML = '';
            return;
        }

        const tables = data.data.tables || [];
        const hasTakeaway = data.data.has_takeaway || false;
        
        // Check if there are any orders (tables or takeaway)
        if (tables.length === 0 && !hasTakeaway) {
            if (noOrdersMsg) noOrdersMsg.style.display = 'flex';
            container.innerHTML = '';
            return;
        }

        if (noOrdersMsg) noOrdersMsg.style.display = 'none';

        let html = '';
        
        // Add table cards first
        tables.forEach(tableName => {
            html += `
                <a href="#/kot/${tableName}" class="kot-table-box" data-table-number="${tableName}" onclick="selectTable('${tableName}'); return false;">
                    <h2 class="mb-0">${tableName}</h2>
                </a>
            `;
        });
        
        // Add takeaway card at the end if there are takeaway orders
        if (hasTakeaway) {
            html += `
                <a href="#/kot/takeaway" class="kot-table-box kot-takeaway-box" data-table-number="Takeaway" onclick="selectTable('Takeaway'); return false;">
                    <h2 class="mb-0">TA</h2>
                    <span class="takeaway-label">Take Away</span>
                </a>
            `;
        }

        container.innerHTML = html;
    } catch (error) {
        console.error('Error loading tables:', error);
        /* Gated on IS_LOCAL before, so a cloud shop whose connection dropped
           sat on an empty tables list with no way back to the server screen.
           A connection failure is a connection failure wherever the server
           is; config.js has already tried the other address by the time this
           runs. */
        if (isServerConnectionError(error)) {
            sessionStorage.setItem('server_connection_failed', error.message || 'Server connection failed');
            stopKotTablePolling();
            window.location.href = 'index.html';
            return;
        }
        if (noOrdersMsg) noOrdersMsg.style.display = 'flex';
        container.innerHTML = '';
    } finally {
        hideSectionLoader('tables-list');
    }
}

// Open sliding panel
function openSlidingPanel() {
    const panel = document.getElementById('kot-sliding-panel');
    const overlay = document.getElementById('kot-panel-overlay');
    
    if (panel) panel.classList.add('open');
    if (overlay) overlay.classList.add('active');
}

// Close sliding panel
function closeSlidingPanel() {
    const panel = document.getElementById('kot-sliding-panel');
    const overlay = document.getElementById('kot-panel-overlay');
    
    if (panel) panel.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
    
    // Remove active class from all tables
    document.querySelectorAll('.kot-table-box').forEach(box => {
        box.classList.remove('active');
    });
}

async function selectTable(tableName) {
    const panelContent = document.getElementById('sliding-panel-content');
    const panelTitle = document.getElementById('panel-title');
    
    if (!panelContent || !panelTitle) return;

    // Remove active class from all tables
    document.querySelectorAll('.kot-table-box').forEach(box => {
        box.classList.remove('active');
    });

    // Add active class to selected table
    const selectedTable = document.querySelector(`.kot-table-box[data-table-number="${tableName}"]`);
    if (selectedTable) {
        selectedTable.classList.add('active');
    }

    // Update panel title
    panelTitle.textContent = tableName === 'Takeaway' ? 'Takeaway Orders' : `Table ${tableName}`;
    
    // Open the sliding panel
    openSlidingPanel();
    
    // Clear previous content
    panelContent.innerHTML = '';

    try {
        showSectionLoader('sliding-panel-content');
        let filters = {};
        const branchId = localStorage.getItem('branch_id') || null;
        if (tableName === 'Takeaway') {
            filters = {
                sale_process: 'KOT',
                dine_type: 'Take away'
            };
        } else {
            filters = {
                sale_process: 'KOT',
                table_number: tableName
            };
        }
        const data = await POSNIC.api.get(
            `/sales/getListKot?page=1&limit=100` +
            `&filters=${encodeURIComponent(JSON.stringify(filters))}&branchId=${branchId}`);
        
        if (data.type !== 'success' || !data.data || !data.data.list || data.data.list.length === 0) {
            panelContent.innerHTML = '<div class="empty-kot-message"><i class="fas fa-clipboard-list"></i><p>No active orders for this table</p></div>';
            currentKotOrders = []; // Clear orders
            return;
        }

        const kots = data.data.list;
        currentKotOrders = kots; // Store orders globally
        const kotCount = kots.length;

        // Header shown once
        let headerHtml = `
            <div class="kot-details-header">
                <span class="active-kot-badge">${kotCount} Active KOT${kotCount > 1 ? 's' : ''}</span>
            </div>
        `;

        let kotsCardsHtml = '';
        
        kots.forEach((kot, kotIndex) => {
            // Handle MongoDB date format
            let timestamp;
            if (kot.updated_date?.$date) {
                if (typeof kot.updated_date.$date === 'object' && kot.updated_date.$date.$numberLong) {
                    timestamp = parseInt(kot.updated_date.$date.$numberLong);
                } else {
                    timestamp = kot.updated_date.$date;
                }
            } else if (kot.created_date?.$date) {
                if (typeof kot.created_date.$date === 'object' && kot.created_date.$date.$numberLong) {
                    timestamp = parseInt(kot.created_date.$date.$numberLong);
                } else {
                    timestamp = kot.created_date.$date;
                }
            } else {
                timestamp = Date.now();
            }
            
            const kotDate = new Date(timestamp);
            const dateStr = kotDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const timeStr = kotDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
            const pax = kot.person_count || 0;
            const total = parseFloat(kot.sales_total || 0).toFixed(2);
            const items = kot.items || [];

            let itemsHtml = '';
            items.forEach((item, index) => {
                const itemName = item.sale_inline_item_name || item.item_name || 'Item';
                const itemQty = item.item_quantity || item.sale_inline_item_qty || item.quantity || 1;
                itemsHtml += `
                    <div class="kot-item">
                        <span class="item-index">${index + 1}.</span>
                        <span class="item-name">${itemName}</span>
                        <span class="item-qty">x${itemQty}</span>
                    </div>
                `;
            });

            kotsCardsHtml += `
                <div class="kot-card">
                    <div class="kot-meta">
                        <div class="kot-meta-item">
                            <i class="fas fa-calendar"></i> ${dateStr} ${timeStr}
                        </div>
                        <div class="kot-meta-item">
                            <i class="fas fa-users"></i> PAX: ${pax}
                        </div>
                    </div>
                    <div class="kot-items-list">
                        ${itemsHtml}
                    </div>
                    <div class="kot-total">
                        <span>Total:</span>
                        <span class="total-amount">₹${total}</span>
                    </div>
                    <div class="kot-actions">
                        <button class="kot-action-btn btn-modify" onclick="modifyKot('${kot._id}')">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                        <button class="kot-action-btn btn-cancel" onclick="cancelKot('${kot._id}')">
                            <i class="fas fa-times"></i> Cancel
                        </button>
                    </div>
                </div>
            `;
        });

        panelContent.innerHTML = headerHtml + `<div class="kot-cards-container">${kotsCardsHtml}</div>`;
    } catch (error) {
        console.error('Error loading KOT details:', error);
        panelContent.innerHTML = '<div class="empty-kot-message"><i class="fas fa-exclamation-circle"></i><p>Failed to load orders. Please try again.</p></div>';
    } finally {
        hideSectionLoader('sliding-panel-content');
    }
}

// Clear KOT details and remove active table selection
function clearKotSelection() {
    // Remove active class from all tables
    document.querySelectorAll('.kot-table-box').forEach(box => {
        box.classList.remove('active');
    });
    
    // Hide KOT details and show empty state
    const detailsSection = document.getElementById('kot-details');
    const emptyState = document.getElementById('empty-state');
    
    if (detailsSection) {
        detailsSection.style.display = 'none';
        detailsSection.innerHTML = '';
    }
    
    if (emptyState) {
        emptyState.style.display = 'flex';
    }
}

// Note: modifyKot function is now provided by order-history/script.js
// which is loaded after this script, so it will override this function
// and provide the Edit Order modal functionality

let cancelKotId = null;
let currentKotOrders = []; // Store current KOT orders

function cancelKot(kotId) {
    cancelKotId = kotId;
    const modalElement = document.getElementById('cancelOrderModal');
    if (modalElement && typeof bootstrap !== 'undefined') {
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
    }
}

// Handle cancel confirmation
document.addEventListener('DOMContentLoaded', function() {
    const confirmBtn = document.getElementById('confirm-cancel-order');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', async function() {
            if (!cancelKotId) return;
            
            try {
                showLoader();
                
                // Find the order from stored currentKotOrders
                const order = currentKotOrders.find(o => o._id === cancelKotId);
                
                if (!order) {
                    console.error('Order not found. cancelKotId:', cancelKotId);
                    console.error('Available orders:', currentKotOrders);
                    throw new Error('Order not found');
                }
                
                console.log('Cancelling order:', order);
                
                const result = await POSNIC.api.post('/sales/updateOrder', {
                    order_id: cancelKotId,
                    items: order.items,
                    total_amount: order.sales_total || order.total_amount,
                    status: 'cancelled'
                });
                console.log('Cancel response:', result);

                if (result.type !== 'success') {
                    throw new Error(result.message || 'Failed to cancel order');
                }
                
                // Close modal
                const modalElement = document.getElementById('cancelOrderModal');
                const modal = bootstrap.Modal.getInstance(modalElement);
                if (modal) modal.hide();
                
                // Close sliding panel
                closeSlidingPanel();
                
                // Clear KOT selection after successful cancellation
                clearKotSelection();
                
                // Show success message
                showToast('Order cancelled successfully', 'success');
                
                // Refresh only the tables list
                setTimeout(async () => {
                    await loadTables();
                }, 500);
                
            } catch (error) {
                console.error('Error cancelling order:', error);
                showToast('Failed to cancel order', 'error');
            } finally {
                hideLoader();
                cancelKotId = null;
            }
        });
    }
});

function showToast(message, type = 'success') {
    const toast = document.getElementById('order-toast');
    const toastMessage = document.getElementById('order-toast-message');
    
    if (!toast || !toastMessage) return;
    
    toastMessage.textContent = message;
    toast.className = `order-toast order-toast-${type}`;
    toast.style.display = 'block';
    
    setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

function applyDiscount(kotId) {
    window.location.href = `discount.html?kot=${kotId}`;
}

/*
 * Fetched, then handed to a window, rather than opened by URL.
 *
 * The print route needs the same credential as everything else, and a browser
 * sends no Authorization header on a plain window.open. The alternative the
 * server does support is a token in the query string, which puts a live
 * credential into history and into every proxy log it passes. Not worth it for
 * one receipt.
 */
async function printSale(kotId) {
    try {
        const response = await POSNIC.api.raw(`/sales/${kotId}/print`);
        const html = await response.text();
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            showToast('Allow pop-ups to print this receipt');
            return;
        }
        printWindow.document.write(html);
        printWindow.document.close();
    } catch (error) {
        console.error('Print failed:', error);
        showToast(error.message || 'Could not load the receipt');
    }
}

function printKot(kotId) {
    console.log('Print KOT:', kotId);
}

function settleKot(kotId) {
    window.location.href = `products.html?settle=${kotId}`;
}

function showTableDetails(tableValue) {
    const emptyState = document.getElementById('empty-state');
    const kotDetails = document.getElementById('kot-details');
    
    if (emptyState) emptyState.style.display = 'none';
    if (kotDetails) {
        kotDetails.style.display = 'block';
        kotDetails.innerHTML = `
            <div class="kot-section-title">Table ${tableValue}</div>
            <div style="flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; color: #9ca3af;">
                <div>
                    <i class="fas fa-clipboard-list" style="font-size: 48px; margin-bottom: 12px; color: #374151;"></i>
                    <p style="font-size: 14px;">No active orders for this table</p>
                    <p style="font-size: 13px; margin-top: 8px;">Click <strong style="color: #10b981;">+ Add KOT</strong> to create a new order</p>
                </div>
            </div>
        `;
    }
}

let _kotTablePollInterval = null;

function startKotTablePolling() {
    if (_kotTablePollInterval) return;
    _kotTablePollInterval = setInterval(async () => {
        const panel = document.getElementById('kot-sliding-panel');
        if (panel && panel.classList.contains('open')) return; // skip when panel is open
        await loadTables();
    }, 10000);
}

function stopKotTablePolling() {
    if (_kotTablePollInterval) {
        clearInterval(_kotTablePollInterval);
        _kotTablePollInterval = null;
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopKotTablePolling();
    } else {
        startKotTablePolling();
    }
});

window.addEventListener('beforeunload', stopKotTablePolling);

document.addEventListener('DOMContentLoaded', async () => {
    let activeBranch = localStorage.getItem('kiosk_selected_branch') || localStorage.getItem('branch_id');
    if (!activeBranch) {
        // checkBranchAndRedirect may not have finished yet — check IndexedDB directly
        try {
            const branches = await getData(BRANCH_STORE);
            if (branches && branches.length > 0) {
                activeBranch = branches[0].id;
                localStorage.setItem('kiosk_selected_branch', branches[0].id);
                if (branches[0].branch_id) localStorage.setItem('branch_id', branches[0].branch_id);
            }
        } catch (e) { /* ignore */ }
    }
    if (!activeBranch) {
        localStorage.removeItem('kiosk_selected_branch');
        localStorage.removeItem('branch_id');
        window.location.href = 'index.html';
        return;
    }

    // Check branch count and update button
    await checkBranchCount();

    showLoader();
    await loadTables();
    hideLoader();

    startKotTablePolling();
});
