/*
 * Turning "two chicken biryani and three coffee" into an order.
 *
 * The recogniser is the easy half to add and the hard half to trust. A
 * restaurant is loud, dish names are proper nouns, and generic speech
 * recognition mangles proper nouns more than anything else: "biryani" comes
 * back as "biriyani", "briyani", "bryani", sometimes "brianni".
 *
 * What saves it is that the answer is never open-ended. The words are matched
 * against THIS shop's menu, which is a few hundred items rather than a
 * language, so a mangled word usually has exactly one plausible neighbour.
 * That is also why voice matching is allowed to be tolerant where typing is
 * not: a waiter who types has seen what they typed, and a waiter who speaks
 * has not seen anything yet.
 *
 * Nothing here orders anything. It produces a list for a person to look at,
 * because the one thing worse than failing to hear an order is confidently
 * sending the wrong one to a kitchen.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VoiceOrder = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  /* Spoken numbers, up to what anybody says in one breath at a table. Above
     twenty people say the digits, which the digit branch already handles. */
  const WORDS = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19, twenty: 20,
    /* Recognisers hear these for small numbers more often than not. */
    to: 2, too: 2, for: 4, ate: 8,
  };

  const MAX = 99;

  /**
   * Split what was said into one phrase per dish.
   *
   * People separate items with commas, with "and", and with nothing at all.
   * The first two are reliable; the third is not, and is left alone rather
   * than guessed at - a wrong split invents an item that was never ordered.
   */
  function phrases(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/\band\b/g, ',')
      .replace(/\bplus\b/g, ',')
      .split(/[,;\n]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  /**
   * Pull the quantity off the front of one phrase.
   *
   * "two chicken biryani" -> 2, "chicken biryani"
   * "chicken biryani"     -> 1, "chicken biryani"
   *
   * Only the front. A number later in the phrase belongs to the dish -
   * "chicken 65" is a name, not sixty-five chickens - and that distinction is
   * the difference between an order and an incident.
   */
  function quantityOf(phrase) {
    const words = String(phrase || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return { quantity: 1, term: '' };

    const digits = words[0].match(/^(\d{1,2})$/);
    if (digits && words.length > 1) {
      return { quantity: clamp(Number(digits[1])), term: words.slice(1).join(' ') };
    }

    const spoken = WORDS[words[0]];
    if (spoken && words.length > 1) {
      return { quantity: clamp(spoken), term: words.slice(1).join(' ') };
    }

    return { quantity: 1, term: words.join(' ') };
  }

  const clamp = (n) => Math.min(Math.max(n, 1), MAX);

  /**
   * What was said, as a list of things to look up.
   *
   * @param {string} text  a transcript
   * @returns {Array<{quantity: number, term: string}>}
   */
  function parse(text) {
    return phrases(text)
      .map(quantityOf)
      .filter((line) => line.term.length > 1);
  }

  /**
   * How close two words are, as a count of single-character edits.
   *
   * Only used for speech, and capped: a word is either nearly right or it is a
   * different word, and allowing three or four edits turns "coffee" into
   * "toffee" into "taffy" and puts something nobody ordered on the bill.
   */
  function distance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;

    /*
     * Two swapped letters count as one edit, not two.
     *
     * Transposition is the commonest way both a recogniser and a thumb get a
     * word wrong - "briyani" for "biryani" is two adjacent letters exchanged.
     * Plain Levenshtein charges two for that, which put the correct dish out
     * of reach of a one-edit budget while leaving genuinely different words
     * just as far away. Counting it as one is what makes a tight budget
     * usable: it forgives the common mistake without widening the net.
     */
    const rows = [Array.from({ length: b.length + 1 }, (_, i) => i)];
    for (let i = 1; i <= a.length; i++) {
      const current = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let value = Math.min(rows[i - 1][j] + 1, current[j - 1] + 1, rows[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          value = Math.min(value, rows[i - 2][j - 2] + 1);
        }
        current[j] = value;
        best = Math.min(best, value);
      }
      if (best > limit) return limit + 1;
      rows.push(current);
    }
    return rows[a.length][b.length];
  }

  /**
   * Match one spoken phrase to a menu item.
   *
   * The exact search runs first and usually wins: constraining to one shop's
   * menu does most of the work, and a transcript is often right. Only when
   * nothing matches at all is the tolerant pass tried, and it reports how it
   * matched so the screen can show a near-miss differently from a certainty.
   *
   * @param {Array} indexed  from ItemSearch.index()
   * @param {string} term
   * @param {object} search  the ItemSearch module
   * @returns {{item: object, exact: boolean}|null}
   */
  function matchOne(indexed, term, search) {
    /*
     * CERTAIN FIRST, THEN LIKELY, THEN ROUGH - and the caller is told which.
     *
     * `numbers` rewrites spoken numerals to digits, so "chicken sixty five"
     * reaches Chicken 65, which is how every board in Tamil Nadu writes it.
     * That is a deterministic rewrite rather than a guess, so a hit is as
     * certain as a typed one.
     *
     * `heard` also allows a PHONETIC match, so "briyani", "panner" and
     * "thosai" reach the right dish. That one is a guess, and it is reported
     * as a near match so the screen shows it to be confirmed rather than
     * adding it silently. Running both in one call would have collapsed that
     * distinction and quietly turned every guess into a certainty.
     */
    const found = search.search(indexed, term, { numbers: true });
    if (found.length) return { item: found[0], exact: true };

    const heard = search.search(indexed, term, { heard: true });
    if (heard.length) return { item: heard[0], exact: false };

    /* One edit for a short word, two for a long one. A five-letter word three
       edits away is a different word. */
    const spoken = search.fold(term);
    const limit = spoken.length > 7 ? 2 : 1;

    let best = null;
    let bestScore = limit + 1;
    for (const entry of indexed) {
      /* Compared word by word: a transcript gets one word wrong, not the
         whole name, and comparing whole names would let a long name absorb
         the difference. */
      for (const word of entry.words) {
        for (const said of spoken.split(' ')) {
          if (said.length < 4) continue; // too short to correct safely
          const d = distance(said, word, limit);
          if (d < bestScore) {
            bestScore = d;
            best = entry.item;
          }
        }
      }
    }
    return best ? { item: best, exact: false } : null;
  }

  /**
   * Everything that was said, matched against the menu.
   *
   * @returns {Array<{quantity, term, item, exact, found}>} in the order spoken
   */
  function understand(text, indexed, search) {
    return parse(text).map((line) => {
      const match = matchOne(indexed, line.term, search);
      return {
        quantity: line.quantity,
        term: line.term,
        item: match ? match.item : null,
        exact: !!(match && match.exact),
        found: !!match,
      };
    });
  }

  return { parse, phrases, quantityOf, understand, matchOne, distance, WORDS };
});
