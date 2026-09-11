/*
 * Turning a shop's menu into the rows a person reads.
 *
 * WHY THIS IS ITS OWN FILE. The old markup was built inside two different
 * functions in two different files - one for the ordinary list, one for search
 * results - and they had drifted. The search rows showed "Stock: 4" and the
 * ordinary rows showed "Stock: 4" minus what was already in the cart; one knew
 * about discounts and the other did not. Nobody decided that. It happened
 * because the same thing was written twice.
 *
 * So a dish is drawn in exactly one place, here, and both callers use it.
 *
 * It is also the only part of the screen that can be tested at a desk. Every
 * rule below - a struck-through price only when there is a discount, silence
 * rather than "0 min", an icon when there is no photograph - is a decision
 * somebody can get wrong later, and each one has a test because of that.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MenuView = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  /* globalThis inside here, never `root` - see assets/common/self-test.js for
     the emulator round that rule cost. */

  const escape = (value) =>
    String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  /**
   * A description as one line of plain text.
   *
   * Shops paste from Word, from WhatsApp, and from their own website, so a
   * description arrives with tags in it, sometimes escaped once and sometimes
   * twice. None of that belongs in a list being scanned - and a stray <div>
   * rendered as markup would break the row it sits in.
   */
  function plain(value) {
    let text = String(value == null ? '' : value);
    /* Escaped-once markup, which is how most of it arrives. */
    text = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    text = text.replace(/<[^>]*>/g, ' ');
    text = text.replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ');
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * The veg mark this dish carries, or none.
   *
   * Shops spell it every way there is, because the field has been free text
   * for years: "veg", "Vegetarian", "non-veg", "nonveg", "2", "egg". Guessing
   * wrong here is worse than showing nothing, so anything unrecognised shows
   * nothing at all.
   */
  function diet(value) {
    const said = String(value == null ? '' : value)
      .trim()
      .toLowerCase();
    if (!said) return '';
    if (/^(egg|eggetarian|contains[ _-]?egg)$/.test(said)) return 'egg';
    /* "non" first: "non-veg" contains "veg", and testing for veg first marks
       every chicken dish green. That is not a cosmetic bug. */
    if (/non|nv|2/.test(said)) return 'nonveg';
    if (/veg|v|1/.test(said)) return 'veg';
    return '';
  }

  /** What this dish costs now, what it cost before, and the saving. */
  function pricing(product) {
    const price = Number(product.price) || 0;
    const off = Number(product.discount_price) || 0;
    const now = Math.max(0, price - off);
    /* A struck-through price identical to the price is noise, and a "0% off"
       is worse than noise. */
    const discounted = off > 0 && now < price;
    return {
      now,
      was: discounted ? price : 0,
      percent: discounted ? Math.round((off / price) * 100) : 0,
    };
  }

  /** Whether it can be ordered, and what to say if not. */
  function stock(product, inCart) {
    const unlimited = product.negative_stock === true;
    const have = Number(product.available_quantity) || 0;
    if (unlimited) return { out: false, left: null };
    const left = Math.max(0, have - (inCart || 0));
    return {
      out: have <= 0,
      /* Said only when it is nearly gone. "47 left" is not information a
         waiter needs while taking an order; "2 left" is the whole order. */
      left: !left || left > 5 ? null : left,
    };
  }

  const money = (amount, symbol) => escape(symbol || '₹') + (Number(amount) || 0).toFixed(2);

  /**
   * One dish, one row.
   *
   * `quantity` is how many are already on the bill, which decides whether the
   * button is ADD or a stepper. Both occupy the same box so the row never
   * changes height - a list that reflows under a thumb is a list that gets the
   * wrong thing tapped.
   */
  function dish(product, quantity, options) {
    const opts = options || {};
    const qty = Number(quantity) || 0;
    const id = escape(product.id);
    const held = stock(product, qty);
    const cost = pricing(product);
    const mark = diet(product.diet);
    const note = plain(product.description);
    const prep = Number(product.prep_minutes) || 0;
    const popular = opts.popular instanceof Set && opts.popular.has(String(product.id));

    /*
     * Whether there IS a photograph is decided before it is resolved.
     *
     * The resolver substitutes a placeholder for an empty path, because the
     * cart and the frequent strip render a bare <img> and an empty `src` makes
     * a browser re-request the page itself. Asking it first would hand this
     * row a grey square and the icon below would never be reached.
     */
    const image = product.img ? (opts.image ? opts.image(product.img) : product.img) : '';

    const classes = ['dish'];
    if (held.out) classes.push('is-out');
    else if (qty > 0) classes.push('is-in');

    /*
     * The picture, or the dish's own icon.
     *
     * `onerror` matters more here than it looks: a shop's images live on the
     * till, and a handset that has walked out of Wi-Fi range gets a broken
     * image glyph in every row. Falling back to the icon keeps the menu
     * looking like a menu when the network does not cooperate.
     */
    const media = image
      ? '<img class="dish-photo" src="' +
        escape(image) +
        '" alt="" loading="lazy" ' +
        'onerror="MenuView.noPhoto(this)" data-icon="' +
        escape(product.icon || '') +
        '">'
      : '<div class="dish-icon" aria-hidden="true">' + escape(product.icon || '\u{1f37d}') + '</div>';

    let action;
    if (held.out) {
      action = '<div class="dish-outmark">Sold out</div>';
    } else if (qty > 0) {
      action =
        '<div class="dish-step">' +
        '<button type="button" class="btn-decrease" data-id="' +
        id +
        '" aria-label="One fewer">−</button>' +
        '<span class="dish-qty" id="qty-' +
        id +
        '">' +
        qty +
        '</span>' +
        '<button type="button" class="btn-increase" data-id="' +
        id +
        '" aria-label="One more">+</button>' +
        '</div>';
    } else {
      action = '<button type="button" class="dish-add btn-add" data-id="' + id + '">ADD</button>';
    }

    return (
      '<div class="' +
      classes.join(' ') +
      '" data-id="' +
      id +
      '" data-category="' +
      escape(product._categoryKey || '') +
      '">' +
      '<div class="dish-text">' +
      (mark ? '<span class="dish-diet is-' + mark + '" title="' + mark + '"></span>' : '') +
      (popular ? '<span class="dish-badge">Bestseller</span>' : '') +
      '<p class="dish-name">' +
      escape(product.name) +
      '</p>' +
      '<div class="dish-price">' +
      money(cost.now, opts.currency) +
      (cost.was
        ? '<span class="dish-was">' +
          money(cost.was, opts.currency) +
          '</span><span class="dish-off">' +
          cost.percent +
          '% off</span>'
        : '') +
      '</div>' +
      (note ? '<p class="dish-note">' + escape(note) + '</p>' : '') +
      (prep ? '<div class="dish-prep">⏱ ' + prep + ' min</div>' : '') +
      '</div>' +
      '<div class="dish-media">' +
      media +
      '<div class="dish-action">' +
      action +
      '</div>' +
      (held.left ? '<div class="dish-left">Only ' + held.left + ' left</div>' : '') +
      '</div>' +
      '</div>'
    );
  }

  /**
   * A photograph that did not load, replaced by the icon.
   *
   * Called from the img's own onerror. Swapping the element rather than hiding
   * it keeps the row's geometry, so a menu on a bad connection settles into
   * shape once instead of jittering as each image gives up.
   */
  function noPhoto(img) {
    if (!img || !img.parentNode) return;
    const icon = img.getAttribute('data-icon') || '\u{1f37d}';
    const tile = img.ownerDocument.createElement('div');
    tile.className = 'dish-icon';
    tile.setAttribute('aria-hidden', 'true');
    tile.textContent = icon;
    img.parentNode.replaceChild(tile, img);
  }

  /**
   * The menu, in the order a shop put it in.
   *
   * `products` is what loadProducts built: a category key to a list of dishes.
   * The "all" key it also builds is skipped - it is every dish over again, and
   * drawing it would double the menu.
   */
  function sections(products, options) {
    const opts = options || {};
    const out = [];
    for (const key of Object.keys(products || {})) {
      if (key === 'all') continue;
      const items = products[key] || [];
      if (!items.length) continue;
      out.push({
        key,
        name: items[0].category_name || key.replace(/_/g, ' '),
        /* Where the shop put this category on its card. Number.MAX_VALUE for
           an item stored before this was recorded, so an old cache sinks to
           the bottom rather than jumping to the front. */
        at: Math.min(...items.map((i) => num(i.category_sort))),
        items,
      });
    }

    /*
     * THE SHOP'S OWN ORDER.
     *
     * A menu is not alphabetical and it is not arbitrary: starters come before
     * mains and desserts come last, because that is the order somebody eats in
     * and the order the shop arranged its card in.
     *
     * These arrive keyed by category name out of IndexedDB, which hands rows
     * back sorted by id - so the sections came out in whatever order the items
     * happened to have been created in, which put Desserts second on a real
     * shop's menu. indexedDB.js records the position the server sent.
     */
    out.sort((a, b) => a.at - b.at);

    for (const section of out) {
      section.items = section.items.slice().sort((a, b) => {
        /*
         * Sold out sinks, within its section and never out of it.
         *
         * A dish that is off today belongs under its own heading, so a waiter
         * can say "the biryani is finished". Moved to the bottom of the whole
         * menu it would look as though it had been taken off the card.
         */
        if (opts.soldOutLast !== false) {
          const aOut = stock(a, 0).out ? 1 : 0;
          const bOut = stock(b, 0).out ? 1 : 0;
          if (aOut !== bOut) return aOut - bOut;
        }
        return num(a.item_sort) - num(b.item_sort);
      });
    }
    return out;
  }

  /** A sort position, or the back of the queue if there is not one. */
  const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : Number.MAX_SAFE_INTEGER);

  /** Every section, drawn. */
  function render(list, cart, options) {
    const cartMap = cart instanceof Map ? cart : new Map();
    let html = '';
    for (const section of list) {
      html +=
        '<section class="menu-section" id="sec-' +
        escape(section.key) +
        '" data-category="' +
        escape(section.key) +
        '">' +
        '<div class="menu-section-head">' +
        '<span class="menu-section-name">' +
        escape(section.name) +
        '</span>' +
        '<span class="menu-section-count">' +
        section.items.length +
        '</span>' +
        '</div>' +
        '<div class="menu-section-items">';
      for (const item of section.items) {
        const line = cartMap.get(item.id);
        html += dish(item, line ? line.quantity : 0, options);
      }
      html += '</div></section>';
    }
    return html;
  }

  /** The jump index across the top. */
  function rail(list, options) {
    const opts = options || {};
    let html = '';
    for (let i = 0; i < list.length; i += 1) {
      html +=
        '<button type="button" class="menu-chip' +
        (i === 0 && opts.markFirst !== false ? ' is-here' : '') +
        '" data-category="' +
        escape(list[i].key) +
        '">' +
        escape(list[i].name) +
        '</button>';
    }
    return html;
  }

  /** Nothing to show, said in words rather than left blank. */
  function nothing(said, why) {
    return (
      '<div class="menu-nothing">' +
      '<div class="menu-nothing-face">\u{1f50d}</div>' +
      '<div class="menu-nothing-said">' +
      escape(said) +
      '</div>' +
      (why ? '<div class="menu-nothing-why">' + escape(why) + '</div>' : '') +
      '</div>'
    );
  }

  return { dish, sections, render, rail, nothing, noPhoto, plain, diet, pricing, stock, escape };
});
