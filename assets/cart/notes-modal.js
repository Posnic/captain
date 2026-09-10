// Cart Notes Modal Functionality
let currentCartNotesProductId = null;

// Wait for DOM to be ready
$(document).ready(function () {
    console.log("✅ Cart notes modal script loaded");

    // Open notes modal when clicking on item-details (product name area)
    $(document).on("click", ".item-details", function (e) {
        e.stopPropagation();
        console.log("📝 Product details clicked!");

        const $cartItem = $(this).closest('.cart-item');
        const itemId = $cartItem.attr('id'); // e.g., "cart-item-123"

        if (!itemId) {
            console.error("❌ Could not find cart item ID");
            return;
        }

        const productId = itemId.replace('cart-item-', '');
        const productName = $cartItem.find('.item-name').text().trim();

        // Get current notes text (remove "Note:" prefix if exists)
        const $notesDiv = $cartItem.find('.item-notes');
        let currentNotes = '';
        if ($notesDiv.length > 0) {
            currentNotes = $notesDiv.text().trim();
            if (currentNotes.startsWith('Note:')) {
                currentNotes = currentNotes.substring(5).trim();
            }
        }

        console.log("Product ID:", productId);
        console.log("Product Name:", productName);
        console.log("Current Notes:", currentNotes);

        currentCartNotesProductId = productId;

        // Set product name and existing notes
        $("#cart-notes-product-name").text(productName);
        $("#cart-notes-text").val(currentNotes);

        // Show modal
        $("#cart-notes-modal").css("display", "flex");
    });

    // Close modal - X button
    $("#cart-notes-close-btn").on("click", function () {
        console.log("❌ Close button clicked");
        $("#cart-notes-modal").hide();
        $("#cart-notes-text").val("");
        currentCartNotesProductId = null;
    });

    // Close modal - Cancel button
    $("#cart-notes-cancel-btn").on("click", function () {
        console.log("🚫 Cancel button clicked");
        $("#cart-notes-modal").hide();
        $("#cart-notes-text").val("");
        currentCartNotesProductId = null;
    });

    // Save notes
    $("#cart-notes-save-btn").on("click", async function () {
        console.log("💾 Save button clicked");

        if (!currentCartNotesProductId) {
            console.error("❌ No product ID set");
            $("#cart-notes-modal").hide();
            return;
        }

        const notes = $("#cart-notes-text").val().trim();
        console.log("Saving notes:", notes, "for product:", currentCartNotesProductId);

        try {
            // Update notes in IndexedDB
            await setCartItemNotes(currentCartNotesProductId, notes);
            console.log("✅ Notes saved to IndexedDB");

            // Update the UI immediately without reload
            const $cartItem = $(`#cart-item-${currentCartNotesProductId}`);
            const $notesDiv = $cartItem.find('.item-notes');

            if (notes) {
                // If notes exist, update or create the notes div
                if ($notesDiv.length > 0) {
                    // Update existing notes
                    $notesDiv.text(notes);
                } else {
                    // Create new notes div
                    const $itemName = $cartItem.find('.item-name');
                    $itemName.after(`<div class="item-notes">${notes}</div>`);
                }
            } else {
                // If notes are empty, remove the notes div
                $notesDiv.remove();
            }

            // Close modal
            $("#cart-notes-modal").hide();
            $("#cart-notes-text").val("");
            currentCartNotesProductId = null;

            console.log("✅ Notes updated in UI");
        } catch (error) {
            console.error("❌ Error saving notes:", error);
            showErrorPopup("Failed to save notes. Please try again.");
        }
    });

    // Close modal when clicking outside
    $("#cart-notes-modal").on("click", function (e) {
        if ($(e.target).is("#cart-notes-modal")) {
            console.log("🔙 Clicked outside modal");
            $("#cart-notes-modal").hide();
            $("#cart-notes-text").val("");
            currentCartNotesProductId = null;
        }
    });

    console.log("✅ All event listeners attached");
});
