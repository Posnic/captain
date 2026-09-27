/* Confirmed kitchen rounds shared by the floor and order details. */
(function (root) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function time(value) {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '';
  }
  function render(order, editable = false) {
    if (!Array.isArray(order.kitchen_rounds)) return '';
    return order.kitchen_rounds.map(round => `<section class="service-round">
      <h3><span>Ordered at</span> <time translate="no">${escape(time(round.ordered_at))}</time></h3>
      ${round.items.map(line => `<div class="service-line${line.remaining ? '' : ' is-served'}">
        <div class="service-dish"><strong translate="no">${escape(line.name)}</strong>
        ${line.note ? `<p translate="no">${escape(line.note)}</p>` : ''}
        ${line.served ? `<small><span>Served</span> <span translate="no">${line.served} / ${line.quantity}${line.served_at ? ' · ' + escape(time(line.served_at)) : ''}</span></small>` : ''}</div>
        <span class="service-quantity" translate="no">×${line.quantity}</span>
        ${editable && line.remaining > 0 ? `<div class="service-action">
          ${line.remaining > 1 ? `<input type="number" aria-label="Quantity to serve" min="0.001" max="${line.remaining}" step="any" value="${line.remaining}">` : ''}
          <button type="button" data-serve-sale="${escape(order._id)}" data-serve-line="${escape(line.id)}" data-served="${line.served}" data-remaining="${line.remaining}">Mark served</button>
        </div>` : ''}
      </div>`).join('')}</section>`).join('');
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-serve-sale]');
    if (!button || button.disabled) return;
    const input = button.parentElement.querySelector('input');
    const quantity = input ? Number(input.value) : Number(button.dataset.remaining);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > Number(button.dataset.remaining)) {
      if (input) input.reportValidity();
      return;
    }
    button.disabled = true;
    if (input) input.disabled = true;
    const container = button.closest('.kot-card');
    let message = container.querySelector('.service-result');
    if (!message) { message = document.createElement('p'); message.className='service-result'; message.setAttribute('role','status'); container.append(message); }
    message.textContent = 'Saving…';
    try {
      const branchId = localStorage.getItem('kiosk_selected_branch') || localStorage.getItem('branch_id');
      const result = await POSNIC.api.post('/sales/serveKitchenItems', {branchId, saleId:button.dataset.serveSale,
        items:[{id:button.dataset.serveLine,quantity:Number(button.dataset.served)+quantity}]});
      if (result.type !== 'success' || !Array.isArray(result.data)) throw new Error(result.message || 'Could not save. Please try again.');
      container.querySelector('.kot-items-list').innerHTML = render({_id:button.dataset.serveSale,kitchen_rounds:result.data},true);
      message.textContent = 'Items marked served';
    } catch (error) {
      message.textContent = error.message || 'Could not save. Please try again.';
      button.disabled = false;
      if (input) input.disabled = false;
    }
  });
  root.ServiceRounds = {render};
})(window);
