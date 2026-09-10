// assets/order-history/script.js - Updated for Two-Screen Flow
let allOrders = [];
let filteredOrders = [];
let currentFilter = 'all';
let selectedTable = null; // Track selected table for screen 2
let currentTableFilter = localStorage.getItem('order_history_table_filter') || 'all';
// Set filters to collapsed by default
let tableFiltersExpanded = false;
let currentOrderId = null;
let editingOrder = null;
let pendingCancelOrderId = null;
let currentEditingItemIndex = null;

let _orderHistoryPollInterval = null;

function startOrderHistoryPolling() {
    if (_orderHistoryPollInterval) return;
    _orderHistoryPollInterval = setInterval(() => {
        const selScreen = document.getElementById('table-selection-screen');
        if (!selScreen || selScreen.style.display === 'none') return; // only on screen 1
        if (currentOrderId || editingOrder) return; // skip while editing
        loadOrderHistory();
    }, 10000);
}

function stopOrderHistoryPolling() {
    if (_orderHistoryPollInterval) {
        clearInterval(_orderHistoryPollInterval);
        _orderHistoryPollInterval = null;
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopOrderHistoryPolling();
    } else {
        startOrderHistoryPolling();
    }
});

window.addEventListener('beforeunload', stopOrderHistoryPolling);

// Initialize page
document.addEventListener('DOMContentLoaded', function () {
    /* The server is already chosen synchronously by config.js; there is
       nothing left to wait for before the first request. */
    loadOrderHistory();
    setupEventListeners();
    showTableSelectionScreen(); // Start with table selection
    restoreTableFilterState(); // Set filters to collapsed by default
    startOrderHistoryPolling();
});

// Screen Navigation Functions
function showTableSelectionScreen() {
    const sel = document.getElementById('table-selection-screen');
    const list = document.getElementById('order-list-screen');
    if (!sel || !list) return;
    sel.style.display = 'flex';
    list.style.display = 'none';
    const headerElement = document.getElementById('header-title');
    if (headerElement) {
        headerElement.textContent = 'Select Table';
    }
    document.getElementById('refresh-btn').style.display = 'none';
    selectedTable = null;
}

function showOrderListScreen(tableNumber) {
    selectedTable = tableNumber;
    document.getElementById('table-selection-screen').style.display = 'none';
    document.getElementById('order-list-screen').style.display = 'flex';
    
    // Set header title based on table type
    let headerTitle;
    if (tableNumber === 'all') {
        headerTitle = 'All Orders';
    } else if (tableNumber === 'TA') {
        headerTitle = 'Takeaway';
    } else {
        headerTitle = `Table ${tableNumber}`;
    }
    const headerElement = document.getElementById('header-title');
    if (headerElement) {
        headerElement.textContent = headerTitle;
    }
    
    document.getElementById('refresh-btn').style.display = 'block';
    filterOrdersBySelectedTable();
}

function handleBackButton() {
    if (selectedTable !== null) {
        // On order list screen - go back to table selection
        showTableSelectionScreen();
    } else {
        // On table selection screen - go back to previous page
        goBack();
    }
}

function goBack() {
    window.history.back();
}

// Generate Table Selection Cards
function generateTableCards() {
    const tableGrid = document.getElementById('table-grid');
    if (!tableGrid) return;

    // Get unique tables from orders
    const tableCounts = {};
    const pendingCounts = {};
    
    allOrders.forEach(order => {
        let table;
        // Check if it's a takeaway order
        if (order.dine_type === 'Take away' || order.dine_type === 'Takeaway') {
            table = 'TA';
        } else {
            table = order.table_number || 'Unknown';
        }
        tableCounts[table] = (tableCounts[table] || 0) + 1;
        if (order.status === 'pending') {
            pendingCounts[table] = (pendingCounts[table] || 0) + 1;
        }
    });

    // Sort tables: TA first, then numeric tables, then others
    const tables = Object.keys(tableCounts).sort((a, b) => {
        if (a === 'TA') return -1;
        if (b === 'TA') return 1;
        const numA = parseInt(a);
        const numB = parseInt(b);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return a.localeCompare(b);
    });

    let html = '';

    // All Tables Card
    const totalOrders = allOrders.length;
    const totalPending = allOrders.filter(o => o.status === 'pending').length;
    html += `
        <div class="table-card all-tables" onclick="showOrderListScreen('all')">
            <div class="table-icon">
                <i class="fas fa-th"></i>
            </div>
            <div class="table-name">All Tables</div>
            <div class="order-count ${totalPending > 0 ? 'has-pending' : ''}">
                ${totalOrders} order${totalOrders !== 1 ? 's' : ''}
            </div>
        </div>
    `;

    // Individual Table Cards
    tables.forEach(table => {
        const count = tableCounts[table];
        const pending = pendingCounts[table] || 0;
        const displayName = table === 'TA' ? 'Takeaway' : `Table ${table}`;
        const icon = table === 'TA' ? 'fa-shopping-bag' : 'fa-utensils';
        html += `
            <div class="table-card" onclick="showOrderListScreen('${table}')">
                <div class="table-icon">
                    <i class="fas ${icon}"></i>
                </div>
                <div class="table-name">${displayName}</div>
                <div class="order-count ${pending > 0 ? 'has-pending' : count === 0 ? 'no-orders' : ''}">
                    ${count} order${count !== 1 ? 's' : ''}
                </div>
            </div>
        `;
    });

    tableGrid.innerHTML = html;
}

// Filter orders by selected table
function filterOrdersBySelectedTable() {
    if (selectedTable === 'all') {
        filteredOrders = allOrders.filter(order => {
            const matchesStatus = currentFilter === 'all' || order.status === currentFilter;
            return matchesStatus;
        });
    } else if (selectedTable === 'TA') {
        // Filter for takeaway orders
        filteredOrders = allOrders.filter(order => {
            const isTakeaway = order.dine_type === 'Take away' || order.dine_type === 'Takeaway';
            const matchesStatus = currentFilter === 'all' || order.status === currentFilter;
            return isTakeaway && matchesStatus;
        });
    } else {
        filteredOrders = allOrders.filter(order => {
            const matchesTable = order.table_number == selectedTable;
            const matchesStatus = currentFilter === 'all' || order.status === currentFilter;
            return matchesTable && matchesStatus;
        });
    }
    renderOrders();
}

// Setup event listeners
function setupEventListeners() {
    const searchInput = document.getElementById('order-search');
    if (searchInput) {
        searchInput.addEventListener('input', filterOrders);
    }

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentFilter = this.dataset.status;
            if (selectedTable !== null) {
                // On order list screen - filter by selected table
                filterOrdersBySelectedTable();
            } else {
                loadOrderHistory();
            }
        });
    });

    const productSearch = document.getElementById('product-search');
    if (productSearch) {
        productSearch.addEventListener('input', function () {
            searchProducts(this.value);
        });
    }

    const saveBtn = document.getElementById('save-order-changes');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveOrderChanges);
    }

    const editBtn = document.getElementById('edit-order-btn');
    if (editBtn) {
        editBtn.addEventListener('click', openEditOrderModal);
    }

    const confirmCancelBtn = document.getElementById('confirm-cancel-order-btn');
    if (confirmCancelBtn) {
        confirmCancelBtn.addEventListener('click', async function () {
            if (!pendingCancelOrderId) return;
            const id = pendingCancelOrderId;
            pendingCancelOrderId = null;

            // call existing cancel API logic
            await performCancelOrder(id);
            // close modal
            const modalEl = document.getElementById('cancelConfirmModal');
            if (modalEl && typeof bootstrap !== 'undefined') {
                const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
                modal.hide();
            }
        });
    }

    const confirmRemoveBtn = document.getElementById('confirm-remove-item-btn');
    if (confirmRemoveBtn) {
        confirmRemoveBtn.addEventListener('click', function () {
            confirmRemoveItem();
        });
    }

    const removeItemModal = document.getElementById('removeItemConfirmModal');
    if (removeItemModal) {
        removeItemModal.addEventListener('hidden.bs.modal', function () {
            const editModal = document.getElementById('editOrderModal');
            if (editModal) {
                editModal.classList.remove('modal-behind');
            }
        });
    }

    const cancelBtn = document.getElementById('cancel-order-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
            if (currentOrderId) {
                cancelOrder(currentOrderId);
            }
        });
    }

    const tableFilterToggle = document.getElementById('table-filter-toggle');
    if (tableFilterToggle) {
        tableFilterToggle.addEventListener('click', toggleTableFilters);
    }
}

// Load order history from real API
async function loadOrderHistory() {
    showLoader();

    try {
        let branchId = localStorage.getItem('branch_id');
        if (!branchId) {
            // checkBranchAndRedirect may not have finished yet — read IndexedDB directly
            try {
                const branches = await getData(BRANCH_STORE);
                if (branches && branches.length > 0) {
                    branchId = branches[0].branch_id || branches[0].id;
                    localStorage.setItem('branch_id', branchId);
                }
            } catch (e) { /* ignore */ }
        }
        if (!branchId) {
            hideLoader();
            return; // no session yet — kot/script.js will redirect to index.html
        }
        const userId = localStorage.getItem('user_id');

        const data = await POSNIC.api.post('/sales/getOrderHistory', {
            branch_id: branchId,
            user_id: userId,
            limit: 50,
            page: 1,
            status: currentFilter === 'all' ? null : currentFilter
        });

        if (data.type === 'success') {
            allOrders = data.data.orders || [];
            generateTableCards(); // Generate table selection cards
            if (selectedTable !== null) {
                // If on order list screen, filter by selected table
                filterOrdersBySelectedTable();
            }
        } else {
            throw new Error(data.message || 'Failed to load orders');
        }
    } catch (error) {
        console.error('Error loading order history:', error);
        // Fallback to empty array if API fails
        allOrders = [];
        filterOrders();
        showToast('Failed to load order history: ' + error.message, 'error');
    } finally {
        hideLoader();
    }
}

// Search products from IndexedDB (no auth, no network, always available)
async function searchProducts(query) {
    const container = document.getElementById('product-suggestions');
    if (!container) return;

    if (!query || query.length < 2) {
        container.innerHTML = '';
        return;
    }

    try {
        const allProducts = await getData(STORE_NAME);
        const q = query.toLowerCase();
        const matched = allProducts
            .filter(p => p.name && p.name.toLowerCase().includes(q))
            .slice(0, 10)
            .map(p => ({
                _id: p.id,
                name: p.name,
                selling_price: p.final_price || p.price || 0,
                available_quantity: p.available_quantity || 0
            }));

        if (matched.length > 0) {
            renderProductSuggestions(matched);
        } else {
            container.innerHTML = '<div class="p-2 text-muted">No products found</div>';
        }
    } catch (error) {
        console.error('Error searching products:', error);
        container.innerHTML = '<div class="p-2 text-danger">Error searching products</div>';
    }
}

// Store products for reference when adding to order
let searchedProducts = {};

// Render product suggestions
function renderProductSuggestions(products) {
    const container = document.getElementById('product-suggestions');

    const suggestionsHtml = products.map(product => {
        // Store product data for later reference
        searchedProducts[product._id] = product;
        
        // Use selling_price for display and adding to order
        const sellingPrice = product.selling_price || product.price;

        return `
        <div class="product-suggestion" onclick="addProductToOrderById('${product._id}')">
            <div class="product-info">
                <h6>${product.name}</h6>
                <p class="product-price">₹${sellingPrice}</p>
                <small class="text-muted">Available: ${product.available_quantity}</small>
            </div>
            <button class="add-product-btn">
                <i class="fas fa-plus"></i>
            </button>
        </div>
    `;
    }).join('');

    container.innerHTML = suggestionsHtml;
}

// Add product to order by ID (retrieves from searchedProducts)
function addProductToOrderById(productId) {
    const product = searchedProducts[productId];
    if (!product) {
        console.error('Product not found:', productId);
        return;
    }
    
    const sellingPrice = product.selling_price || product.price;
    addProductToOrder(productId, product.name, sellingPrice);
}

// Save order changes to real API
async function saveOrderChanges() {
    if (!editingOrder || !currentOrderId) return;

    showLoader();
    const discountValue = parseFloat(
        document.getElementById('edit-discount-value').value || 0
    );
    const discountType = document.querySelector(
        'input[name="edit_discount_type"]:checked'
    )?.value || 'percent';

    const desc = document.getElementById('edit-discount-description').value.trim();

    let extraType = '';
    let extraVal = 0;

    if (discountValue > 0) {
        extraType = discountType;   // 'percent' or 'amount'
        extraVal = discountValue;
    }
    const order = allOrders.find(o => o._id === currentOrderId) || {};
    const dineTypeRadio = document.querySelector('input[name="edit_dine_type"]:checked');
    const dineType = dineTypeRadio ? dineTypeRadio.value : (order.dine_type || 'Dine-in');
    const tableRadio = document.querySelector('input[name="edit_table_no"]:checked');

    let newTableNo = order.table_number || order.kiosk_table_no || '';
    let newTableId = order.table_id || order.kiosk_table_id || '';

    if (tableRadio) {
        if (tableRadio.id === 'edit_table_manual_radio') {
            const manualInput = document.getElementById('edit_manual_table_input');
            const manualVal = manualInput ? manualInput.value.trim().toUpperCase() : '';

            // validation: required + only A–Z,0–9 + max 6
            const isValid = /^[A-Z0-9]{1,6}$/.test(manualVal);

            if (!isValid && dineType === 'Dine-in') {
                hideLoader();
                showToast('Table must be 1–6 letters/numbers (A–Z, 0–9).', 'error');
                if (manualInput) {
                    manualInput.focus();
                    manualInput.select();
                }
                return;
            }

            newTableNo = manualVal;
            newTableId = '';
        } else {
            newTableNo = tableRadio.value;
            newTableId = tableRadio.dataset.id || '';
        }
    } else {
        // Only validate table selection for Dine-in mode
        if (dineType === 'Dine-in' && !newTableNo) {
            hideLoader();
            showToast('Please select a table.', 'error');
            return;
        }
        // For Takeaway, clear table values if not selected
        if (dineType === 'Take away') {
            newTableNo = '';
            newTableId = '';
        }
    }
    try {
        const data = await POSNIC.api.post('/sales/updateOrder', {
                order_id: currentOrderId,
                items: editingOrder.items
                    .filter(item => parseFloat(item.quantity || item.item_quantity || 0) > 0)
                    .map(item => ({
                        ...item,
                        product_id: item.product_id || item.item_id || item.id || null,
                        quantity: parseFloat(item.quantity || item.item_quantity || 1),
                        price: parseFloat(item.price || item.unit_price || item.item_base_price || 0),
                    })),
                total_amount: editingOrder.total_amount,
                extra_discount_type: extraType,
                extra_discount: extraVal,
                discount_description: desc,
                table_number: newTableNo,
                table_id: newTableId,
                dine_type: dineType,
                person_count: dineType === 'Dine-in' ? (editingOrder.person_count || 1) : ''
        });

        if (data.type === 'success') {
            showToast(data.message || 'Order updated successfully!', 'success');
            
            // Close modal
            const modalElement = document.getElementById('editOrderModal');
            if (modalElement && typeof bootstrap !== 'undefined') {
                const modal = bootstrap.Modal.getInstance(modalElement);
                if (modal) modal.hide();
            }
            
            // Check if we're on KOT management page
            const isKotPage = window.location.pathname.includes('kot-management.html');
            
            if (isKotPage) {
                // Close sliding panel
                if (typeof closeSlidingPanel === 'function') {
                    closeSlidingPanel();
                }
                
                // Clear KOT selection after successful save
                if (typeof clearKotSelection === 'function') {
                    clearKotSelection();
                }
                
                // Refresh tables list on KOT page
                if (typeof loadTables === 'function') {
                    setTimeout(async () => {
                        await loadTables();
                    }, 500);
                }
                
                // Also reload order history so allOrders has fresh data
                await loadOrderHistory();
            } else {
                // Re-load from API for order history page
                await loadOrderHistory();
            }
        } else {
            throw new Error(data.message || 'Failed to update order');
        }
    } catch (error) {
        console.error('Error saving order changes:', error);
        showToast('Failed to update order: ' + error.message, 'error');
    } finally {
        hideLoader();
    }
}

// Filter orders
function filterOrders() {
    const searchInput = document.getElementById('order-search');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

    filteredOrders = allOrders.filter(order => {
        const matchesSearch = !searchTerm ||
            order.order_id.toLowerCase().includes(searchTerm) ||
            order.table_number.toString().includes(searchTerm) ||
            (order.customer_name && order.customer_name.toLowerCase().includes(searchTerm));

        const matchesStatus = currentFilter === 'all' || order.status === currentFilter;
        const matchesTable = currentTableFilter === 'all' || order.table_number.toString() === currentTableFilter;

        return matchesSearch && matchesStatus && matchesTable;
    });

    renderOrders();
}

// Generate dynamic table filter buttons
function generateTableFilterButtons() {
    const container = document.getElementById('table-filter-buttons');
    if (!container) return;

    // Collect unique table numbers
    const uniqueTables = {};
    allOrders.forEach(order => {
        const tableNum = order.table_number ? order.table_number.toString() : '';
        if (tableNum && tableNum !== '') {
            uniqueTables[tableNum] = true;
        }
    });

    // Keep the "All" button, remove other dynamic buttons
    const allBtn = container.querySelector('button[data-table="all"]');
    container.innerHTML = '';
    if (allBtn) {
        container.appendChild(allBtn);
    }

    // Sort table numbers
    const tableNumbers = Object.keys(uniqueTables).sort((a, b) => {
        const numA = parseInt(a) || 0;
        const numB = parseInt(b) || 0;
        return numA - numB;
    });

    // Add button for each table
    tableNumbers.forEach(tableNum => {
        const btn = document.createElement('button');
        btn.className = 'table-filter-btn';
        btn.setAttribute('data-table', tableNum);
        btn.textContent = 'Table ' + tableNum;
        btn.onclick = () => filterByTable(tableNum);
        container.appendChild(btn);
    });

    // Restore active state
    updateTableFilterButtonStates();
    
    // Restore collapse state
    restoreTableFilterState();
}

// Filter by table
function filterByTable(tableNumber) {
    currentTableFilter = tableNumber;
    localStorage.setItem('order_history_table_filter', tableNumber);
    updateTableFilterButtonStates();
    filterOrders();
}

// Update table filter button states
function updateTableFilterButtonStates() {
    const buttons = document.querySelectorAll('.table-filter-btn');
    buttons.forEach(btn => {
        if (btn.getAttribute('data-table') === currentTableFilter) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// Toggle table filters expand/collapse
function toggleTableFilters() {
    const container = document.getElementById('all-filters-container');
    const arrow = document.getElementById('table-filter-arrow');
    
    if (!container || !arrow) return;
    
    tableFiltersExpanded = !tableFiltersExpanded;
    
    if (tableFiltersExpanded) {
        container.classList.remove('collapsed');
        arrow.classList.remove('rotated');
    } else {
        container.classList.add('collapsed');
        arrow.classList.add('rotated');
    }
    
    // Save state to localStorage
    localStorage.setItem('table_filters_expanded', tableFiltersExpanded);
}

// Restore table filter collapse state
function restoreTableFilterState() {
    const container = document.getElementById('all-filters-container');
    const arrow = document.getElementById('table-filter-arrow');
    
    if (!container || !arrow) return;
    
    if (!tableFiltersExpanded) {
        container.classList.add('collapsed');
        arrow.classList.add('rotated');
    } else {
        container.classList.remove('collapsed');
        arrow.classList.remove('rotated');
    }
}

// Render orders
function renderOrders() {
    const container = document.getElementById('orders-list');
    const emptyState = document.getElementById('empty-state');

    if (!container) return;

    if (filteredOrders.length === 0) {
        container.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    const ordersHtml = filteredOrders.map(order => `
    <div class="order-card ${order.status === 'cancelled' ? 'order-card-cancelled' : ''}"
         onclick="viewOrderDetails('${order._id}')">
            <div class="order-header">
                <div class="order-info">
                    <h5>#${order.order_id}</h5>
                                        <span class="table-number">
                        Table ${order.table_number}
                        · ${order.dine_type || 'Dine-in'}
                        ${order.person_count ? ` · ${order.person_count} Pax` : ''}
                    </span>
                </div>
                <div class="order-status">
                    <span class="status-badge status-${order.status}">${order.status}</span>
                </div>
            </div>
            <div class="order-details">
                <div class="order-meta">
                    <span class="order-time">
                        <i class="fas fa-clock"></i>
                        ${formatDateTime(order.created_at)}
                    </span>
                    <span class="order-total">
                        ₹${order.total_amount.toFixed(2)}
                    </span>
                </div>
                <div class="order-items-preview">
                    ${order.items.slice(0, 2).map(item =>
        `<span class="item-preview">${item.quantity}x ${item.name}</span>`
    ).join(', ')}
                    ${order.items.length > 2 ? `... +${order.items.length - 2} more` : ''}
                </div>
            </div>
            ${order.status === 'cancelled' || order.status === 'completed' ? '' : `
        <div class="order-actions">
            <button class="action-btn edit-btn" onclick="event.stopPropagation(); editOrder('${order._id}')">
                <i class="fas fa-edit"></i> Edit
            </button>
            <button class="action-btn cancel-btn" onclick="event.stopPropagation(); cancelOrder('${order._id}')">
                <i class="fas fa-times"></i> Cancel Order
            </button>
        </div>
        `}
    </div>
`).join('');

    container.innerHTML = ordersHtml;
}

// View order details
function viewOrderDetails(orderId) {
    currentOrderId = orderId;
    const order = allOrders.find(o => o._id === orderId);

    if (!order) return;

    // Calculate totals
    const subtotal = order.subtotal || (order.items || []).reduce((sum, item) => sum + (parseFloat(item.price || 0) * parseInt(item.quantity || 0)), 0);

    // Sum up tax and discount from items if available
    const itemsTax = (order.items || []).reduce((sum, item) => sum + (parseFloat(item.tax_price || 0) * parseInt(item.quantity || 0)), 0);
    const itemsDiscount = (order.items || []).reduce((sum, item) => sum + (parseFloat(item.discount_price || 0) * parseInt(item.quantity || 0)), 0);

    let tax = order.tax || order.tax_amount || order.total_tax || itemsTax || 0;
    let discount = order.discount || order.discount_amount || order.total_discount || itemsDiscount || 0;

    // Fallback for extra_discount if discount is still 0
    if (!discount && order.extra_discount > 0) {
        if (order.extra_discount_type === 'amount') {
            discount = parseFloat(order.extra_discount);
        } else {
            discount = (subtotal * parseFloat(order.extra_discount)) / 100;
        }
    }

    const detailsHtml = `
        <div class="order-details-content p-2">
            <div class="row mb-3">
                <div class="col-md-6 mb-2 mb-md-0">
                    <div class="d-flex align-items-center">
                        <i class="fas fa-hashtag me-2 text-primary" style="width: 20px;"></i>
                        <span><strong>Order ID:</strong> #${order.order_id}</span>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="d-flex align-items-center">
                        <i class="fas fa-chair me-2 text-primary" style="width: 20px;"></i>
                        <span><strong>Table:</strong> ${order.table_number}</span>
                    </div>
                </div>
            </div>
            <div class="row mb-3">
                <div class="col-md-6 mb-2 mb-md-0">
                    <div class="d-flex align-items-center">
                        <i class="fas fa-info-circle me-2 text-primary" style="width: 20px;"></i>
                        <span><strong>Status:</strong> <span class="status-badge status-${order.status}">${order.status}</span></span>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="d-flex align-items-center">
                        <i class="fas fa-calendar-alt me-2 text-primary" style="width: 20px;"></i>
                        <span><strong>Date:</strong> ${formatDateTime(order.created_at)}</span>
                    </div>
                </div>
            </div>
            <div class="row mb-3">
                <div class="col-md-6 mb-2 mb-md-0">
                    <div class="d-flex align-items-center">
                        <i class="fas fa-utensils me-2 text-primary" style="width: 20px;"></i>
                        <span><strong>Order Type:</strong> ${order.dine_type || 'Dine-in'}</span>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="d-flex align-items-center">
                        <i class="fas fa-users me-2 text-primary" style="width: 20px;"></i>
                        <span><strong>Pax:</strong> ${order.person_count || 0}</span>
                    </div>
                </div>
            </div>
            <div class="row mb-3">
                <div class="col-12">
                    <div class="d-flex align-items-center">
                        <i class="fas fa-user me-2 text-primary" style="width: 20px;"></i>
                        <span><strong>Customer:</strong> ${order.customer_name || 'N/A'}</span>
                    </div>
                </div>
            </div>
            
            <h6>Order Items:</h6>
            <div class="order-items-table">
                <table class="table table-sm">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th style="text-align: center;">Qty</th>
                            <th style="text-align: right;">Price</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${order.items.map(item => `
                        <tr>
                            <td>
                                ${item.name}
                                ${item.item_description
            ? `<div class="order-item-notes">${item.item_description}</div>`
            : ''
        }
                            </td>
                            <td style="text-align: center;">${item.quantity}</td>
                            <td style="text-align: right;">₹${item.price.toFixed(2)}</td>
                        </tr>
                    `).join('')}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td></td>
                            <th style="text-align: right;">Subtotal:</th>
                            <td style="text-align: right;">₹${subtotal.toFixed(2)}</td>
                        </tr>
                        <tr>
                            <td></td>
                            <th style="text-align: right;">Discount:</th>
                            <td style="text-align: right;">-₹${discount.toFixed(2)}</td>
                        </tr>
                        <tr>
                            <td></td>
                            <th style="text-align: right;">Tax:</th>
                            <td style="text-align: right;">₹${tax.toFixed(2)}</td>
                        </tr>
                        <tr style="border-top: 2px solid #eee;">
                            <th></th>
                            <th style="text-align: right; font-size: 1.1rem;">Total Amount:</th>
                            <th style="text-align: right; font-size: 1.1rem;">₹${parseFloat(order.total_amount || 0).toFixed(2)}</th>
                        </tr>
                    </tfoot>
                </table>
            </div>

            ${order.discount_description ? `
            <div class="order-notes-section mt-3 p-3 bg-light rounded border">
                <div class="d-flex align-items-start">
                    <i class="fas fa-sticky-note me-2 text-primary mt-1"></i>
                    <div>
                        <h6 class="mb-1" style="font-size: 0.9rem;">Order Notes:</h6>
                        <div class="text-muted small">${order.discount_description}</div>
                    </div>
                </div>
            </div>
            ` : ''}
        </div>
    `;

    const detailsContent = document.getElementById('order-details-content');
    if (detailsContent) {
        detailsContent.innerHTML = detailsHtml;
    }

    // Show/hide action buttons based on order status
    const editBtn = document.getElementById('edit-order-btn');
    const cancelBtn = document.getElementById('cancel-order-btn');

    if (order.status === 'completed' || order.status === 'cancelled') {
        if (editBtn) editBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'none';
    } else {
        if (editBtn) editBtn.style.display = 'inline-block';
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
    }

    // Show modal
    const modalElement = document.getElementById('orderDetailsModal');
    if (modalElement && typeof bootstrap !== 'undefined') {
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
    }
}

// Edit order
function editOrder(orderId) {
    console.log('Edit order clicked:', orderId);
    currentOrderId = orderId;
    openEditOrderModal();
}

// Modify KOT - alias for editOrder to support external onclick handlers
function modifyKot(orderId) {
    console.log('Modify KOT clicked:', orderId);
    
    currentOrderId = orderId;
    
    // Load order data if not already loaded
    if (!allOrders || allOrders.length === 0) {
        loadOrderHistory().then(() => {
            openEditOrderModal();
        });
    } else {
        openEditOrderModal();
    }
}

// Make modifyKot globally accessible
window.modifyKot = modifyKot;

// Add items to order
// function addItemsToOrder(orderId) {
//     currentOrderId = orderId;
//     openAddItemsModal();
// }
function renderEditTables(tables, selectedTableNo) {
    const container = document.getElementById('edit-table-list');
    if (!container) return;

    if (!tables || tables.length === 0) {
        container.innerHTML = '<div class="text-muted">No tables configured</div>';
        return;
    }

    let html = '';

    tables.forEach(t => {
        const value = t.value;
        const radioId = `edit_table_${value}`;
        const tableId = t.id || '';

        html += `
            <div class="table-item">
                <input type="radio"
                    class="table-radio"
                    id="${radioId}"
                    name="edit_table_no"
                    value="${value}"
                    data-id="${tableId}"
                    ${value === selectedTableNo ? 'checked' : ''}>
                <label for="${radioId}" class="table-label">${value}</label>
            </div>
        `;
    });

    // 🔹 Manual table input – same idea as discount.html
    html += `
        <div class="table-item manual-table">
            <input type="radio" class="table-radio"
                id="edit_table_manual_radio"
                name="edit_table_no"
                value=""
                data-id="">
            <label for="edit_table_manual_radio" class="table-label manual-label">
                <input type="text"
                    id="edit_manual_table_input"
                    class="manual-table-input"
                    placeholder="Other"
                    autocomplete="off">
            </label>
        </div>
    `;

    container.innerHTML = html;
}
function clampPersonCount(n) {
    if (isNaN(n)) n = 1;
    if (n < 1) n = 1;
    if (n > 99) n = 99;
    return n;
}

function setEditPersonCount(n) {
    n = clampPersonCount(n);

    if (editingOrder) {
        editingOrder.person_count = n;
    }

    const buttons = document.querySelectorAll('.edit-person-btn');
    buttons.forEach(btn => {
        const val = parseInt(btn.dataset.person || '0', 10);
        btn.classList.toggle('active', val === n);
    });

    const input = document.getElementById('edit_person_input');
    if (input) {
        if (document.activeElement !== input) {
            // Only set when n > 6, otherwise keep whatever is already there
            if (n > 6) {
                input.value = n.toString();
            }
            // do NOT set input.value = '' for n <= 6
        }
        if (n > 6) input.classList.add('active');
        else input.classList.remove('active');
    }

    // --- HERO ICONS (max 4 icons, show +N for more) ---
    const hero = document.getElementById('edit_person_hero');
    if (hero) {
        hero.innerHTML = '';
        const displayCount = Math.min(n, 4); // max 4 icons
        const remaining = n > 4 ? n - 4 : 0;

        let sizePx;
        if (displayCount <= 3) sizePx = 52;      // 1–3 big
        else sizePx = 38;                        // 4 medium

        for (let i = 0; i < displayCount; i++) {
            const icon = document.createElement('i');
            icon.className = 'fas fa-user-alt person-hero-icon';
            icon.style.fontSize = sizePx + 'px';
            hero.appendChild(icon);
        }

        // Add +N indicator if more than 4
        if (remaining > 0) {
            const plusIndicator = document.createElement('span');
            plusIndicator.className = 'person-plus-indicator';
            plusIndicator.textContent = `+${remaining}`;
            // plusIndicator.style.fontSize = sizePx + 'px';
            plusIndicator.style.marginLeft = '8px';
            plusIndicator.style.fontWeight = 'bold';
            plusIndicator.style.color = '#5c2d1f';
            hero.appendChild(plusIndicator);
        }
    }
}

function initEditPersonControls(initial) {
    const buttons = document.querySelectorAll('.edit-person-btn');
    const input = document.getElementById('edit_person_input');

    buttons.forEach(btn => {
        btn.addEventListener('click', function () {
            const n = parseInt(this.dataset.person || '1', 10);
            setEditPersonCount(n);
        });
    });

    if (input) {
        // auto-select text on focus/click
        input.addEventListener('focus', function () {
            setTimeout(() => this.select(), 0);
        });
        input.addEventListener('click', function () {
            this.select();
        });

        input.addEventListener('input', function () {
            let v = this.value.replace(/\D/g, '');
            if (v.length > 2) v = v.slice(0, 2);
            let n = parseInt(v || '0', 10);
            n = clampPersonCount(n);
            this.value = n.toString();
            setEditPersonCount(n);
        });
        // NEW: focus -> always add active
        input.addEventListener('focus', function () {
            this.classList.add('active');

            // REMOVE active class from all person buttons
            document.querySelectorAll('.edit-person-btn')
                .forEach(btn => btn.classList.remove('active'));
        });

        // NEW: blur -> remove active only if value <= 6 or empty
        input.addEventListener('blur', function () {
            const n = parseInt(this.value || '0', 10);
            if (!n || n <= 6) {
                this.classList.remove('active');
            }
        });
    }

    setEditPersonCount(initial || 1);
}
// Manual table input: allow only A-Z and 0-9, max 6 chars, auto-uppercase
// Manual table input: allow only A-Z and 0-9, max 6 chars, auto-uppercase
$(document).on('input', '#edit_manual_table_input', function () {
    let v = this.value.toUpperCase();      // caps lock auto
    v = v.replace(/[^A-Z0-9]/g, '');       // remove non letters/numbers
    this.value = v.slice(0, 6);            // max 6 characters

    // typing in the box should select "manual table" option
    $('#edit_table_manual_radio').prop('checked', true);
});
// Focus / click on the textbox should also activate manual table radio
$(document).on('focus click', '#edit_manual_table_input', function () {
    $('#edit_table_manual_radio').prop('checked', true);
});
// Open edit order modal
function openEditOrderModal() {
    const order = allOrders.find(o => o._id === currentOrderId);
    console.log(order);
    if (!order) return;

    if (order.status === 'cancelled') {
        showToast('Cancelled order cannot be edited.', 'error');
        return;
    }

    const type = order.extra_discount_type || 'percent';
    const val = order.extra_discount || 0;

    document.getElementById('edit-discount-value').value = val;
    document.getElementById('edit-discount-description').value =
        order.discount_description || '';

    // set toggle
    const percentRadio = document.getElementById('edit-discount-percent');
    const amountRadio = document.getElementById('edit-discount-amount');

    if (type === 'amount') {
        amountRadio.checked = true;
        percentRadio.checked = false;
    } else {
        percentRadio.checked = true;
        amountRadio.checked = false;
    }

    // Set dine type radios
    const dineType = order.dine_type || 'Dine-in';
    const dineinRadio = document.getElementById('edit-dinein');
    const takeawayRadio = document.getElementById('edit-takeaway');

    if (dineType === 'Take away') {
        if (takeawayRadio) takeawayRadio.checked = true;
        if (dineinRadio) dineinRadio.checked = false;
    } else {
        if (dineinRadio) dineinRadio.checked = true;
        if (takeawayRadio) takeawayRadio.checked = false;
    }

    // Add event listeners for order type change
    document.querySelectorAll('input[name="edit_dine_type"]').forEach(radio => {
        radio.addEventListener('change', handleEditOrderTypeChange);
    });

    // Initial call to set visibility based on current order type
    handleEditOrderTypeChange();

    const currentTableNo = order.table_number || order.kiosk_table_no || '';
    const currentPersons = order.person_count || 1;
    const raw = localStorage.getItem('kiosk_tableorders');
    let tables = [];

    if (raw) {
        try {
            const tableorders = JSON.parse(raw) || [];
            tables = tableorders.map((t, index) => {
                const value = (t.tableorder_value ?? (index + 1)).toString();
                const tableId = t._id?.$oid || t.table_id || ''; // adjust based on actual data
                return {
                    value: value,
                    label: value,
                    id: tableId
                };
            });
        } catch (e) {
            console.error('Failed to parse kiosk_tableorders:', e);
        }
    }

    renderEditTables(tables, currentTableNo);
    // current table no listல் இல்லனா → manual input select & prefill
    if (currentTableNo) {
        const existsInList = tables.some(t => t.value === currentTableNo.toString());
        if (!existsInList) {
            const manualRadio = document.getElementById('edit_table_manual_radio');
            const manualInput = document.getElementById('edit_manual_table_input');
            if (manualRadio) manualRadio.checked = true;
            if (manualInput) manualInput.value = currentTableNo;
        }
    }

    editingOrder = JSON.parse(JSON.stringify(order)); // Deep copy  
    editingOrder.person_count = currentPersons || 1;
    if (!Array.isArray(editingOrder.items)) editingOrder.items = [];
    initEditPersonControls(editingOrder.person_count);

    // Normalize item fields — handle both legacy and KOT-inserted items
    editingOrder.items.forEach(item => {
        const unit = parseFloat(item.unit_price || item.item_base_price || item.price || 0);
        item.price = isNaN(unit) ? 0 : parseFloat(unit.toFixed(2));
        if (!item.selling_price) item.selling_price = item.price;
        if (!item.quantity && item.item_quantity) item.quantity = item.item_quantity;
        item.quantity = parseFloat(item.quantity || 1);
    });

    renderCurrentOrderItems();
    clearNewItems();

    const modalElement = document.getElementById('editOrderModal');
    if (modalElement && typeof bootstrap !== 'undefined') {
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
    }
}

// Handle edit order type change to show/hide table and pax sections
function handleEditOrderTypeChange() {
    const orderType = document.querySelector('input[name="edit_dine_type"]:checked')?.value || 'Dine-in';
    const tableSection = document.getElementById('edit-table-section');
    const paxSection = document.getElementById('edit-pax-section');

    if (orderType === 'Dine-in') {
        // Show table and pax sections
        if (tableSection) tableSection.style.display = '';
        if (paxSection) paxSection.style.display = '';
    } else {
        // Hide table and pax sections for Takeaway
        if (tableSection) tableSection.style.display = 'none';
        if (paxSection) paxSection.style.display = 'none';
    }
}

// Open add items modal
// function openAddItemsModal() {
//     openEditOrderModal();
//     setTimeout(() => {
//         const productSearch = document.getElementById('product-search');
//         if (productSearch) productSearch.focus();
//     }, 500);
// }

// Cancel order
function cancelOrder(orderId) {
    const order = allOrders.find(o => o._id === orderId);
    if (!order) return;

    if (order.status === 'cancelled') {
        showToast('Order already cancelled.', 'error');
        return;
    }
    if (order.status === 'completed') {
        showToast('Completed order cannot be cancelled.', 'error');
        return;
    }

    pendingCancelOrderId = orderId;

    const modalElement = document.getElementById('cancelConfirmModal');
    if (modalElement && typeof bootstrap !== 'undefined') {
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
    }
}

async function performCancelOrder(orderId) {
    const order = allOrders.find(o => o._id === orderId);
    if (!order) return;

    showLoader();
    try {
        const data = await POSNIC.api.post('/sales/updateOrder', {
            order_id: orderId,
            items: order.items,
            total_amount: order.total_amount,
            status: 'cancelled'
        });

        if (data.type === 'success') {
            const idx = allOrders.findIndex(o => o._id === orderId);
            if (idx !== -1) {
                allOrders[idx].status = 'cancelled';
            }

            // Refresh list
            filterOrders();

            // If details modal is open for this order, re-render it so buttons hide
            if (currentOrderId === orderId) {
                viewOrderDetails(orderId);
            }

            showToast(data.message || 'Order cancelled successfully.', 'success');
        } else {
            showToast(data.message || 'Failed to cancel order', 'error');
        }
    } catch (e) {
        console.error('Error cancelling order:', e);
        showToast('Failed to cancel order: ' + e.message, 'error');
    } finally {
        hideLoader();
    }
}

// Render current order items
function renderCurrentOrderItems() {
    const container = document.getElementById('current-order-items');
    if (!container || !editingOrder) return;

    const itemsHtml = editingOrder.items.map((item, index) => {
        const quantity = parseFloat(item.quantity || 1);
        
        // Per-unit values from backend
        const perUnitSellingPrice = parseFloat(item.selling_price || 0);
        const perUnitDiscount = parseFloat(item.discount || 0);
        const perUnitTax = parseFloat(item.tax_amount || 0);
        
        // Calculate total values based on quantity
        const totalSellingPrice = perUnitSellingPrice * quantity;
        const totalDiscount = perUnitDiscount * quantity;
        const totalTax = perUnitTax * quantity;
        
        return `
        <div class="order-item-card">
            <div class="item-info" data-index="${index}">
                <h6>${item.name}</h6>
                ${totalSellingPrice > 0 ? `<p class="item-selling-price"><strong>Final: ₹${totalSellingPrice.toFixed(2)}</strong></p>` : ''}
                ${item.item_description ? `<p class="item-notes small text-muted">${item.item_description}</p>` : ""}
            </div>
            <div class="item-controls">
                <button class="qty-btn" onclick="updateItemQuantity(${index}, -1)">-</button>
                <span class="qty-display">${item.quantity}</span>
                <button class="qty-btn" onclick="updateItemQuantity(${index}, 1)">+</button>
                <button class="remove-btn" onclick="removeItem(${index})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
        `;
    }).join('');

    container.innerHTML = itemsHtml;
}

// Click on item-info → open notes modal
$(document).on('click', '.item-info', function () {
    if (!editingOrder) return;

    const index = parseInt($(this).data('index'), 10);
    if (isNaN(index) || !editingOrder.items[index]) return;

    currentEditingItemIndex = index;
    const item = editingOrder.items[index];

    // Titleல item name
    $('#edit-notes-product-name').text(item.name || 'Item Notes');

    // Existing description/notes load
    const existing = item.item_description || item.notes || '';
    $('#edit-item-notes-text').val(existing);

    const modalEl = document.getElementById('editItemNotesModal');
    const bsModal = new bootstrap.Modal(modalEl);
    bsModal.show();
});

// Apply button → save notes back to editingOrder
$(document).on('click', '#edit-item-notes-apply', function () {
    if (!editingOrder || currentEditingItemIndex === null) return;

    const item = editingOrder.items[currentEditingItemIndex];
    if (!item) return;

    const notes = $('#edit-item-notes-text').val().trim();

    item.item_description = notes;
    // item.notes = notes;

    // UI refresh
    renderCurrentOrderItems();

    // Modal close
    const modalEl = document.getElementById('editItemNotesModal');
    const bsModal = bootstrap.Modal.getInstance(modalEl);
    if (bsModal) bsModal.hide();

    currentEditingItemIndex = null;
});
// Update item quantity
let pendingRemovalIndex = null;

function updateItemQuantity(index, change) {
    if (!editingOrder) return;

    const item = editingOrder.items[index];
    const newQty = item.quantity + change;

    if (newQty <= 0) {
        showRemoveItemConfirmation(index);
        return;
    }
    const total = editingOrder.items.reduce((sum, item) => {
        return sum + (item.quantity * item.price);
    }, 0);

    item.quantity = newQty;
    renderCurrentOrderItems();
    updateOrderTotal();
    
    // Update sliding panel KOT card in real-time
    if (typeof updateSlidingPanelKotCard === 'function') {
        updateSlidingPanelKotCard();
    }
}

function showRemoveItemConfirmation(index) {
    if (!editingOrder || !editingOrder.items[index]) return;
    
    pendingRemovalIndex = index;
    const item = editingOrder.items[index];
    
    document.getElementById('remove-item-name').textContent = item.name;
    
    const editModal = document.getElementById('editOrderModal');
    if (editModal) {
        editModal.classList.add('modal-behind');
    }
    
    const modalEl = document.getElementById('removeItemConfirmModal');
    const bsModal = new bootstrap.Modal(modalEl);
    bsModal.show();
}

function removeItem(index) {
    showRemoveItemConfirmation(index);
}

function confirmRemoveItem() {
    if (!editingOrder || pendingRemovalIndex === null) return;
    
    editingOrder.items.splice(pendingRemovalIndex, 1);
    pendingRemovalIndex = null;
    
    const modalEl = document.getElementById('removeItemConfirmModal');
    const bsModal = bootstrap.Modal.getInstance(modalEl);
    if (bsModal) {
        bsModal.hide();
    }
    
    renderCurrentOrderItems();
    updateOrderTotal();
    
    // Update sliding panel KOT card in real-time
    if (typeof updateSlidingPanelKotCard === 'function') {
        updateSlidingPanelKotCard();
    }
}

// Add product to order
function addProductToOrder(productId, productName, productPrice) {
    if (!editingOrder) return;

    const existingItem = editingOrder.items.find(item => item.product_id === productId);

    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        editingOrder.items.push({
            product_id: productId,
            name: productName,
            selling_price: productPrice,  // Use selling_price field for consistency
            price: productPrice,
            quantity: 1
        });
    }

    renderCurrentOrderItems();
    updateOrderTotal();
    
    // Update sliding panel KOT card in real-time
    if (typeof updateSlidingPanelKotCard === 'function') {
        updateSlidingPanelKotCard();
    }

    // Clear search
    const productSearch = document.getElementById('product-search');
    const suggestions = document.getElementById('product-suggestions');
    if (productSearch) productSearch.value = '';
    if (suggestions) suggestions.innerHTML = '';
}

// Update order total
function updateOrderTotal() {
    if (!editingOrder) return;

    const total = editingOrder.items.reduce((sum, item) => {
        return sum + (item.quantity * item.price);
    }, 0);

    editingOrder.total_amount = total.toFixed(2);
}

// Clear new items
function clearNewItems() {
    const productSearch = document.getElementById('product-search');
    const suggestions = document.getElementById('product-suggestions');
    if (productSearch) productSearch.value = '';
    if (suggestions) suggestions.innerHTML = '';
}

// Utility functions
function formatDateTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function goBack() {
    if (window.history.length > 1) {
        window.history.back();
    } else {
        // fallback if no history
        window.location.href = 'discount.html'; // or discount.html, as you prefer
    }
}

function refreshOrders() {
    loadOrderHistory();
}

function showLoader() {
    const loader = document.getElementById('page-loader');
    if (loader) loader.style.display = 'flex';
}

function hideLoader() {
    const loader = document.getElementById('page-loader');
    if (loader) loader.style.display = 'none';
}
let toastTimeout = null;

function showToast(message, type = 'success', duration = 3000) {
    const toast = document.getElementById('order-toast');
    const msgEl = document.getElementById('order-toast-message');
    if (!toast || !msgEl) return;

    msgEl.textContent = message || '';

    toast.classList.remove('order-toast-success', 'order-toast-error');
    if (type === 'error') {
        toast.classList.add('order-toast-error');
    } else {
        toast.classList.add('order-toast-success');
    }

    toast.style.display = 'block';

    if (toastTimeout) {
        clearTimeout(toastTimeout);
    }
    toastTimeout = setTimeout(() => {
        toast.style.display = 'none';
    }, duration);
}