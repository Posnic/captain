/*
 * SOMETHING THE MENU DOES NOT HAVE.
 *
 * Owner: "able to add item and price on demand. thats important."
 *
 * A bottle of water somebody brought in, a birthday cake the kitchen agreed to
 * plate, a shop-made sweet that never got typed into the catalogue. A waiter
 * meets these at the table, and until now the only answer was to walk to the
 * till and ask somebody to add an item first.
 *
 * NOT A NEW KIND OF LINE. The till has done this for a long time: it creates a
 * real item marked INSTANT and sells it like any other. INSTANT is exactly why
 * those items never appear on anybody's menu - the storefront filters them out
 * by that status. So this asks the till for one and then adds it to the order
 * the ordinary way, which means pricing, tax, the kitchen ticket and the bill
 * all work without knowing anything special happened.
 *
 * THE PRICE IS ASKED THE SAME WAY a fish priced at the market is asked, with
 * the same sheet, because a waiter should not have to learn two ways to type a
 * number into this app.
 */
(function (root) {
  'use strict';

  /**
   * Create a one-off item on the till and hand back what the menu would hold.
   *
   * @param {string} name what the waiter called it
   * @param {number} price what they are charging
   * @returns {Promise<object>} the new dish, as a menu row
   */
  async function createOneOff(name, price) {
    const said = String(name || '').trim();
    const amount = Number(price);

    if (!said) throw new Error('What is it called?');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('What does it cost?');

    /*
     * The field names are the till's own. This is its endpoint and its shape;
     * renaming them here would only mean two vocabularies for one thing.
     */
    const data = await root.POSNIC.api.post('/items/instanceItemInsert', {
      items_name: said,
      items_selling_price: amount,
      /* One of them, which is what "add this to the order" means. A waiter who
         wants two taps the stepper, like any other dish. */
      items_quantity: 1,
      items_unit: 'qty',
      items_sku: '',
      items_category_id: '',
      items_category_name: '',
      items_discount_amount: 0,
      items_discount_percentage: 0,
      /*
       * NO TAX CHOSEN HERE, deliberately. The till's own quick sale offers the
       * shop's default tax because somebody at a counter can see what they
       * picked. A waiter mid-service cannot, and a wrong tax on a one-off line
       * is a wrong return that nobody notices. The shop's own default applies
       * where the till decides it.
       */
      items_tax_id: '',
      items_tax_name: '',
      items_tax: 0,
      items_tax_type: 'inclusive',
    });

    if (!data || data.type !== 'success' || !data.data || !data.data.id) {
      throw new Error((data && data.message) || 'The till would not add it');
    }

    const made = data.data;
    return {
      id: String(made.id),
      name: made.name || said,
      price: Number(made.selling_price) || amount,
      /*
       * OFF THE MENU ON PURPOSE, AND EVERYTHING DOWNSTREAM HAS TO KNOW.
       *
       * The till marks these INSTANT, which keeps them out of the menu it
       * serves. The app then refreshes that menu and deletes whatever is not
       * in it - the products store prunes, and the cart sync drops any line
       * whose dish it cannot find. So a one-off was added, reported added,
       * and quietly removed the moment anything reloaded the menu. Owner:
       * "after price enter it shows added to cart, when i go to cart its not
       * showing."
       *
       * This flag is what those two places check.
       */
      instant: true,
      /* A one-off is not counted stock: it exists because somebody sold it. */
      negative_stock: true,
      available_quantity: 0,
      description: '',
      icon: '',
      img: '',
      modifier_groups: [],
      category_name: made.category_name || 'Quick sale',
    };
  }

  root.POSNIC = root.POSNIC || {};
  root.POSNIC.quickSale = { createOneOff };

  if (typeof module === 'object' && module.exports) {
    module.exports = { createOneOff };
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
