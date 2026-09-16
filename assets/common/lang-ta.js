/*
 * TAMIL, KEYED BY THE ENGLISH IT REPLACES.
 *
 * Read by assets/common/i18n.js, which swaps a line only when the WHOLE
 * trimmed text matches a key here. That is what keeps dish names, table
 * numbers and prices out of it: they are not in this file, and a whole-text
 * match cannot half-translate a line.
 *
 * HOW THESE ARE WRITTEN. The words a waiter uses on the floor, not the words a
 * dictionary prefers. Half the restaurant vocabulary in Tamil Nadu is spoken
 * in English anyway - "order", "table", "bill", "menu" - and a waiter reading
 * a screen mid-service should meet the word they would say out loud. Where the
 * English word is the one in use, it stays in Tamil script rather than being
 * replaced by a formal coinage nobody says: பில், ஆர்டர், டேபிள்.
 *
 * A missing sentence shows English, so this file can grow a line at a time and
 * is never wrong, only incomplete.
 *
 * NEEDS A NATIVE READ before it goes near a floor. It is written by somebody
 * who can write Tamil, not by somebody who has waited tables in Chennai, and
 * the difference shows in exactly the places that matter: how short a button
 * has to be, and which English words are better left alone.
 */

(function (root) {
  'use strict';

  const TAMIL = {
    /* ---------------------------------------------------------- the basics */
    Close: 'மூடு',
    Cancel: 'ரத்து',
    Clear: 'அழி',
    Done: 'முடிந்தது',
    Apply: 'பயன்படுத்து',
    Refresh: 'புதுப்பி',
    Back: 'பின்செல்',
    Other: 'வேறு',
    'Other...': 'வேறு...',
    Dismiss: 'விலக்கு',
    Error: 'பிழை',
    'Loading...': 'ஏற்றுகிறது...',
    'Something went wrong.': 'ஏதோ தவறாகிவிட்டது.',
    Please: 'தயவுசெய்து',
    'contact your administrator': 'உங்கள் நிர்வாகியை தொடர்பு கொள்ளுங்கள்',

    /* ------------------------------------------------------------- the menu */
    Menu: 'மெனு',
    'Search the menu': 'மெனுவில் தேடு',
    'Back to the menu': 'மெனுவுக்கு திரும்பு',
    Notes: 'குறிப்பு',
    'Item Notes': 'உணவு குறிப்பு',
    'Product Notes': 'உணவு குறிப்பு',
    'Eg: Non sugar, half milk, extra hot...': 'எ.கா: சர்க்கரை இல்லை, பாதி பால், சூடாக...',
    'On this table': 'இந்த டேபிளில்',
    'You added lately': 'நீங்கள் சமீபத்தில் சேர்த்தவை',
    'Selling today': 'இன்று விற்பவை',
    Bestseller: 'அதிகம் விற்பது',
    'Sold out': 'தீர்ந்துவிட்டது',
    "Today's price": 'இன்றைய விலை',
    'Number card': 'எண் அட்டை',
    'The number to type in Add item.': 'உணவு சேர்க்கும்போது இந்த எண்ணை தட்டச்சு செய்யவும்.',

    /* ------------------------------------------------------------ the order */
    'New order': 'புதிய ஆர்டர்',
    'Order History': 'ஆர்டர் வரலாறு',
    'Order history': 'ஆர்டர் வரலாறு',
    'Order Type': 'ஆர்டர் வகை',
    'Modify order': 'ஆர்டரை மாற்று',
    'On this order': 'இந்த ஆர்டரில்',
    'Add something': 'ஏதாவது சேர்',
    'Add to the order': 'ஆர்டரில் சேர்',
    'Update the order': 'ஆர்டரை புதுப்பி',
    'Leave it as it was': 'இருந்தபடியே விடு',
    'Back to the order': 'ஆர்டருக்கு திரும்பு',
    'Place Order': 'ஆர்டர் செய்',
    'Send to kitchen': 'சமையலறைக்கு அனுப்பு',
    'Cancel Order': 'ஆர்டரை ரத்து செய்',
    'Cancel order': 'ஆர்டரை ரத்து செய்',
    'Yes, Cancel': 'ஆம், ரத்து செய்',
    'Are you sure you want to cancel the order?': 'ஆர்டரை ரத்து செய்ய வேண்டுமா?',
    'Remove Item': 'உணவை நீக்கு',
    'Yes, Remove': 'ஆம், நீக்கு',
    'Are you sure you want to remove this item from the order?':
      'இந்த உணவை ஆர்டரிலிருந்து நீக்க வேண்டுமா?',
    Modify: 'மாற்று',
    Added: 'சேர்க்கப்பட்டது',
    Only: 'மட்டும்',

    /* ------------------------------------------------------------ the floor */
    Table: 'டேபிள்',
    'Select Table': 'டேபிளை தேர்ந்தெடு',
    'Enter Table Number': 'டேபிள் எண்ணை உள்ளிடு',
    'Loading tables...': 'டேபிள்கள் ஏற்றப்படுகின்றன...',
    'No tables set up yet.': 'இன்னும் டேபிள்கள் அமைக்கப்படவில்லை.',
    'This table is full': 'இந்த டேபிள் நிரம்பியுள்ளது',
    'Restaurant is turned off for this shop.': 'இந்த கடைக்கு restaurant முறை அணைக்கப்பட்டுள்ளது.',
    'Dine-in': 'உள்ளே சாப்பிட',
    'Take away': 'பார்சல்',
    Pax: 'நபர்கள்',
    person: 'நபர்',
    'No. of persons': 'நபர்கள் எண்ணிக்கை',
    'One more': 'ஒன்று கூட்டு',
    'One fewer': 'ஒன்று குறை',

    /* ------------------------------------------- moving an order's table */
    'Move table': 'டேபிள் மாற்று',
    'Move to another table': 'வேறு டேபிளுக்கு மாற்று',
    'Choose a table': 'ஒரு டேபிளை தேர்ந்தெடு',
    'here now': 'இப்போது இங்கே',
    'has an order': 'ஆர்டர் உள்ளது',
    'Not on a table yet': 'இன்னும் டேபிளில் இல்லை',
    'No tables configured. Whoever set up the till adds them.':
      'டேபிள்கள் அமைக்கப்படவில்லை. பில்லிங் அமைத்தவர் சேர்க்க வேண்டும்.',

    /* ------------------------------------------------------------- the bill */
    Bill: 'பில்',
    'Bill Summary': 'பில் விவரம்',
    'Cart Summary': 'கார்ட் விவரம்',
    'Cart is empty': 'கார்ட் காலியாக உள்ளது',
    Discount: 'தள்ளுபடி',
    'Discount Description': 'தள்ளுபடி விவரம்',
    'Reason for discount (optional)': 'தள்ளுபடிக்கான காரணம் (விருப்பம்)',
    'Bill asked for': 'பில் கேட்கப்பட்டது',
    'Asking...': 'கேட்கிறது...',
    'Cancelling...': 'ரத்து செய்கிறது...',

    /* --------------------------------------------------- the shop and setup */
    Captain: 'Captain',
    Login: 'உள்நுழை',
    'Change shop server': 'கடை சர்வரை மாற்று',
    'Change branch': 'கிளையை மாற்று',
    'Connect to your shop': 'உங்கள் கடையுடன் இணை',
    'Not connected yet': 'இன்னும் இணைக்கப்படவில்லை',
    'How this phone should connect': 'இந்த போன் எப்படி இணைய வேண்டும்',
    Automatically: 'தானாக',
    'In the shop': 'கடையில்',
    'Only in the shop': 'கடையில் மட்டும்',
    'Only over the internet': 'இணையம் வழியாக மட்டும்',
    'Never uses the internet. Orders stop outside the shop Wi-Fi.':
      'இணையத்தை பயன்படுத்தாது. கடை Wi-Fi இல்லாதபோது ஆர்டர் நிற்கும்.',
    'Find the till on this Wi-Fi': 'இந்த Wi-Fi இல் பில்லிங் கணினியை கண்டுபிடி',
    'Point at the code by the till.': 'பில்லிங் அருகே உள்ள QR குறியீட்டை காட்டுங்கள்.',
    'That code is not a Posnic shop. Keep looking.':
      'அது Posnic கடையின் குறியீடு அல்ல. மீண்டும் முயலுங்கள்.',
    'Access Denied': 'அனுமதி இல்லை',
    'You are not authorized to view this page.': 'இந்த பக்கத்தை பார்க்க உங்களுக்கு அனுமதி இல்லை.',
    'Go to Home': 'முகப்புக்கு செல்',
    'Copies of a printed bill': 'அச்சிடும் பில் நகல்கள்',
    'As the shop is set': 'கடை அமைப்பின்படி',
    'Number card for the wall': 'சுவரில் ஒட்டும் எண் அட்டை',

    /* --------------------------------------------------- a table calling */
    'Table is calling': 'டேபிள் கூப்பிடுகிறது',
    'On my way': 'வருகிறேன்',
  };

  if (root.I18N && typeof root.I18N.register === 'function') {
    root.I18N.register('ta', TAMIL);
  } else {
    /* The pack loaded first. The runtime picks this up when it starts. */
    root.POSNIC_LANG_TA = TAMIL;
  }
})(typeof window !== 'undefined' ? window : globalThis);
