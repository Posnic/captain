// Function to update the sliding panel KOT card in real-time when editing
function updateSlidingPanelKotCard() {
    // Only update if we're on KOT management page and editing an order
    const isKotPage = window.location.pathname.includes('kot-management.html');
    if (!isKotPage || !editingOrder || !currentOrderId) return;
    
    // Find the KOT card in the sliding panel for this order
    const kotCards = document.querySelectorAll('.kot-card');
    if (!kotCards || kotCards.length === 0) return;
    
    // Find the card that matches the current order being edited
    // We need to match by checking the Edit button's onclick attribute
    let targetCard = null;
    kotCards.forEach(card => {
        const editBtn = card.querySelector('.btn-modify');
        if (editBtn && editBtn.getAttribute('onclick')?.includes(currentOrderId)) {
            targetCard = card;
        }
    });
    
    if (!targetCard) return;
    
    // Update the items list in the card
    const itemsList = targetCard.querySelector('.kot-items-list');
    if (!itemsList) return;
    
    let itemsHtml = '';
    editingOrder.items.forEach((item, index) => {
        const itemName = item.name || item.sale_inline_item_name || item.item_name || 'Item';
        const itemQty = item.quantity || 1;
        itemsHtml += `
            <div class="kot-item">
                <span class="item-index">${index + 1}.</span>
                <span class="item-name">${itemName}</span>
                <span class="item-qty">x${itemQty}</span>
            </div>
        `;
    });
    
    itemsList.innerHTML = itemsHtml;
    
    // Update the total
    const totalElement = targetCard.querySelector('.total-amount');
    if (totalElement && editingOrder.total_amount) {
        totalElement.textContent = `₹${parseFloat(editingOrder.total_amount).toFixed(2)}`;
    }
}
