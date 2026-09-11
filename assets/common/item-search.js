/*
 * Finding an item while somebody is standing at a table waiting.
 *
 * The search was `name.includes(term)`. That finds "Chicken Biryani" from
 * "biry" and from nothing else. It does not find it from "chick biry", because
 * two words are one substring that never appears; and it does not find it from
 * "cb", which is what a waiter who sells it two hundred times a day actually
 * types.
 *
 * Every counter-facing till does the same four things, and they are the four
 * here, in the order they rank:
 *
 *   exact        the whole name, typed out
 *   prefix       the name starts with what was typed
 *   word start   any word in the name starts with it: "biry" finds Chicken
 *                Biryani, "masala dosa" finds Masala Dosa Paper Roast
 *   initials     the first letters of the words: "cb" finds Chicken Biryani,
 *                "mdp" finds Masala Dosa Paper
 *
 * Multi-token and AND-ed, so "chick 65" narrows rather than widens: every
 * token has to match something, which is how a long menu gets down to one row
 * in three or four keystrokes.
 *
 * Deliberately NOT fuzzy in the edit-distance sense. A waiter who types "birani"
 * would be helped by it, but so would every wrong row, and picking the wrong
 * item on a bill is worse than typing one more letter. Prefixes and initials
 * are predictable: the same keystrokes always produce the same order.
 *
 * Pure and exported, so the ranking is testable without a browser. The ranking
 * IS the feature; a change that quietly demotes the row somebody expects first
 * is invisible until a shop complains that the app "got slower to use".
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ItemSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  /* Ranks. Lower sorts first; the gaps leave room to insert a rank later
     without renumbering the ones around it. */
  const EXACT = 0;
  const PREFIX = 10;
  const WORD_START = 20;
  const INITIALS = 30;
  const CONTAINS = 40;

  /**
   * Fold a string down to what a comparison should actually see.
   *
   * Diacritics are stripped so "Crème Brûlée" is reachable from a keyboard
   * that has no accents, which is most of the ones in a kitchen. Punctuation
   * becomes space so "Chicken-65" and "Chicken 65" behave the same, and both
   * are findable by "65".
   */
  function fold(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  const tokensOf = (value) => fold(value).split(' ').filter(Boolean);

  /** First letter of each word: "Masala Dosa Paper" -> "mdp". */
  const initialsOf = (words) => words.map((w) => w[0]).join('');

  /**
   * How well one item matches one token, or null for no match.
   *
   * @param {{name: string, code?: string}} indexed  an item prepared by index()
   * @param {string} token  a single folded search token
   */
  function scoreToken(indexed, token) {
    if (!token) return null;
    if (indexed.name === token) return EXACT;
    if (indexed.name.startsWith(token)) return PREFIX;

    /* A code is matched whole, never partially: half a barcode is a
       coincidence, not an intent. */
    if (indexed.code && indexed.code === token) return EXACT;

    for (const word of indexed.words) {
      if (word.startsWith(token)) return WORD_START;
    }
    if (indexed.initials.startsWith(token) && token.length > 1) return INITIALS;
    if (indexed.name.includes(token)) return CONTAINS;
    return null;
  }

  /**
   * Prepare items once, so typing does not redo this per keystroke.
   *
   * The old search flattened every category and lowercased every name on every
   * input event. On a menu of a few hundred items that is work repeated for
   * each letter, on the device least able to spare it.
   */
  function index(items) {
    return (items || []).map((item) => {
      const name = fold(item.name);
      const words = name.split(' ').filter(Boolean);
      return {
        item,
        name,
        words,
        initials: initialsOf(words),
        code: fold(item.sku || item.code || item.barcode_id || '') || null,
      };
    });
  }

  /**
   * Search prepared items.
   *
   * @param {Array} indexed  from index()
   * @param {string} term    what was typed
   * @returns {Array} the original items, best match first
   */
  function search(indexed, term, options = {}) {
    const tokens = tokensOf(term);
    const popular = options.popular instanceof Set ? options.popular : new Set();
    if (!tokens.length) return (indexed || []).map((entry) => entry.item);

    const hits = [];
    for (const entry of indexed || []) {
      let total = 0;
      let matchedAll = true;

      for (const token of tokens) {
        const score = scoreToken(entry, token);
        if (score === null) {
          matchedAll = false;
          break;
        }
        /* The worst token decides the rank, so one weak match cannot be
           carried by a strong one: "chick zzz" must not rank above "chick". */
        total = Math.max(total, score);
      }
      if (matchedAll) hits.push({ entry, score: total });
    }

    /*
     * Within a rank, what the shop actually sells wins.
     *
     * "cb" matches Chicken Biryani and Creme Brulee equally well by initials,
     * and nothing in the text can separate them - but a shop that sells two
     * hundred biryanis a day and one dessert a week has already answered. The
     * popular set comes from the frequent-items the app fetches anyway, so
     * this costs no extra request.
     *
     * A tiebreak, deliberately, not a rank of its own: a popular item must
     * never outrank a better textual match, or typing more letters would move
     * the row somebody was aiming at.
     */
    const rankOf = (entry) => (popular.has(String(entry.item.id)) ? 0 : 1);

    hits.sort((a, b) =>
      a.score - b.score ||
      rankOf(a.entry) - rankOf(b.entry) ||
      a.entry.name.length - b.entry.name.length ||  // the shorter name is the likelier intent
      a.entry.name.localeCompare(b.entry.name)
    );
    return hits.map((hit) => hit.entry.item);
  }

  return { fold, index, search, scoreToken, RANK: { EXACT, PREFIX, WORD_START, INITIALS, CONTAINS } };
});
