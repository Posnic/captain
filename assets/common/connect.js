/*
 * How a handset finds the shop it belongs to.
 *
 * The first screen of a device's life, and the one a waiter meets on their
 * first shift. It used to be a text box, which assumes the person holding the
 * phone knows the shop code. The owner knows it. The waiter, handed a phone
 * five minutes ago, does not, and had no way to find out.
 *
 * So the choice is made explicit, in the order a shop will actually use it:
 *
 *   Scan            point at the code by the till. Nothing to know, nothing
 *                   to type. This is the answer for a new member of staff.
 *   Search Wi-Fi    finds the till by itself when they are on the shop's
 *                   network. Nothing to know either, but needs the till on.
 *   Type it         a shop code or an address, for whoever does know one, and
 *                   for a phone that is nowhere near the shop.
 *
 * What a scanned code may contain is deliberately loose - a bare shop code, a
 * full address, or a link carrying either - because the code will be made by
 * whatever is to hand, printed and stuck by a till, and re-made by somebody in
 * a year who will not read this file.
 */

(function () {
  'use strict';

  /* jsQR is bundled rather than fetched: a shop with no internet still has to
     be able to set up a new handset, which is the whole point of scanning the
     till's own code. */
  const SCAN_INTERVAL_MS = 120;

  /**
   * Pull a server address out of whatever the code carried.
   *
   * Accepts, in order of how likely somebody is to have produced it:
   *   demo                                a bare shop code
   *   https://demo.posnic.io/api          the address itself
   *   http://192.168.1.5:5555             a till on the shop network
   *   https://anything/x?server=demo      a link carrying either
   *
   * @param {string} text whatever the camera read
   * @returns {string|null} a base URL, or null if it was some other QR code
   */
  function serverFromScan(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;

    /* A link with the address in a parameter. Checked first: the whole URL
       would otherwise normalize to the address of the page hosting it. */
    try {
      const url = new URL(raw);
      const carried = url.searchParams.get('server') || url.searchParams.get('shop');
      if (carried) return POSNIC.server.normalize(carried);
    } catch (e) {
      /* not a URL: fall through and treat it as a code or an address */
    }

    return POSNIC.server.normalize(raw);
  }

  let stream = null;
  let scanning = false;

  function stopScan() {
    scanning = false;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    const sheet = document.getElementById('scanSheet');
    if (sheet) sheet.hidden = true;
  }

  /**
   * Open the camera and watch for a code.
   *
   * @param {(base: string) => void} onFound
   */
  async function startScan(onFound) {
    const sheet = document.getElementById('scanSheet');
    const video = document.getElementById('scanVideo');
    const note = document.getElementById('scanNote');
    if (!sheet || !video) return;

    sheet.hidden = false;
    note.textContent = 'Point at the code by the till.';

    try {
      /* The back camera, where a phone has one. `exact` would refuse outright
         on a laptop or a tablet with only a front camera, which is where this
         gets tested. */
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
    } catch (e) {
      /* Refusing the camera is a decision, not a fault. Say what to do next
         rather than reporting a DOMException at somebody. */
      note.textContent =
        e && e.name === 'NotAllowedError'
          ? 'The camera is blocked for this app. Allow it in Settings, or use one of the other ways.'
          : 'No camera available on this device. Use one of the other ways.';
      return;
    }

    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    await video.play().catch(() => {});

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    scanning = true;

    const tick = () => {
      if (!scanning) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const found = window.jsQR
          ? window.jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })
          : null;
        if (found && found.data) {
          const base = serverFromScan(found.data);
          if (base) {
            stopScan();
            onFound(base);
            return;
          }
          /* A code that is not ours. Keep looking rather than closing the
             camera: the till's code is probably next to whatever this was. */
          note.textContent = 'That code is not a Posnic shop. Keep looking.';
        }
      }
      setTimeout(tick, SCAN_INTERVAL_MS);
    };
    tick();
  }

  window.POSNIC_CONNECT = { serverFromScan, startScan, stopScan };
})();
