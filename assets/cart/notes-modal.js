// Cart Notes Modal Functionality
let currentCartNotesProductId = null;

// Wait for DOM to be ready
$(document).ready(function () {
    console.log("✅ Cart notes modal script loaded");

    /*
     * Open the notes editor by tapping the line.
     *
     * THE SELECTORS FOLLOW THE BILL MARKUP, which was rewritten: .item-details
     * and .cart-item no longer exist, and a jQuery selector that matches
     * nothing does not error - it binds to nothing and the tap silently does
     * nothing at all. That is the whole hazard with delegated handlers, and it
     * is why these are pinned by a test.
     *
     * The row's id is deliberately unchanged: cart-item-<id> is what the write
     * back below looks up, and what every other screen expects.
     */
    $(document).on("click", ".bill-body", function (e) {
        e.stopPropagation();

        const $cartItem = $(this).closest('.bill-line');
        const itemId = $cartItem.attr('id'); // e.g., "cart-item-123"

        if (!itemId) {
            console.error("❌ Could not find cart item ID");
            return;
        }

        const productId = itemId.replace('cart-item-', '');
        const productName = $cartItem.find('.bill-name').text().trim();

        // Get current notes text (remove "Note:" prefix if exists)
        const $notesDiv = $cartItem.find('.bill-note');
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
            const $notesDiv = $cartItem.find('.bill-note');

            if (notes) {
                if ($notesDiv.length > 0) {
                    $notesDiv.text(notes);
                } else {
                    /* .text(), not an interpolated div: a note is typed by a
                       waiter or dictated to a recogniser, and it used to go
                       into the page as markup. */
                    $cartItem.find('.bill-name')
                        .after($('<div class="bill-note"></div>').text(notes));
                }
            } else {
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
