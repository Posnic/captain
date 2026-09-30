/* Account details use the current restaurant identity; no local-only profile edits. */
(function () {
  "use strict";
  const t = text => window.I18N?.t(text) || text;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  let page, home, current = "", busy = false, profile;
  function back() {
    if (!current) return false;
    if (busy) return true;
    page.hidden = true; home.hidden = false; current = "";
    document.querySelector('.me-title').textContent = t('Me');
    return true;
  }
  function field(label,id,type,value="",autocomplete="off") {
    return `<label class="profile-field">${esc(t(label))}<input class="ui-field" id="${id}" name="${id}" type="${type}" value="${esc(value)}" autocomplete="${autocomplete}" required></label>`;
  }
  function show(view) {
    if (busy) return;
    current=view;home.hidden=true;page.hidden=false;
    document.querySelector('.me-title').textContent=t(view==='password'?'Change password':'Profile details');
    page.innerHTML=view==='password'
      ? `<form id="profile-form">${field('Current password','currentPassword','password','','current-password')}${field('New password','newPassword','password','','new-password')}${field('Confirm password','confirmPassword','password','','new-password')}<p class="me-note">${esc(t('Use at least 10 characters and repeat the new password.'))}</p><p class="me-note">${esc(t('After changing your password, sign in again. Saved orders stay on this phone.'))}</p>${actions()}</form>`
      : `<p role="status">${esc(t('Loading...'))}</p>`;
    if(view==='profile') void load();
  }
  function actions() { return `<p id="profile-message" role="status"></p><div class="profile-actions"><button type="button" data-profile-back class="profile-secondary">${esc(t('Cancel'))}</button><button class="profile-primary" type="submit">${esc(t('Save'))}</button></div>`; }
  async function load() {
    try {
      profile=await POSNIC.api.get('/captain/v1/profile');
      if(current!=='profile')return;
      page.innerHTML=`<form id="profile-form">${field('Name','profile-name','text',profile.name,'name')}<div class="profile-detail"><span>${esc(t('Email'))}</span><strong translate="no">${esc(profile.email || '—')}</strong></div><div class="profile-detail"><span>${esc(t('Phone number'))}</span><strong translate="no">${esc(profile.phone || '—')}</strong></div>${actions()}</form>`;
      page.querySelector('input').maxLength=100;
    } catch {
      if(current!=='profile')return;
      page.innerHTML=`<p role="status">${esc(t('Connection failed'))}</p><button type="button" class="profile-primary" data-profile-retry>${esc(t('Retry'))}</button>`;
    }
  }
  async function submit(event) {
    event.preventDefault();if(busy)return;
    const values=Object.fromEntries(new FormData(event.target));
    const message=page.querySelector('#profile-message');
    const password=current==='password';
    if(password&&new TextEncoder().encode(values.newPassword).length>54) {message.textContent=t('Choose a shorter password.');return;}
    if(password&&(values.newPassword.length<10 || values.newPassword!==values.confirmPassword)) {
      message.textContent=t('Use at least 10 characters and repeat the new password.');return;
    }
    busy=true;page.querySelectorAll('button,input').forEach(node=>node.disabled=true);
    message.textContent=t('Loading...');
    try {
      const result=await POSNIC.api.post(password?'/captain/v1/password':'/captain/v1/profile',password?values:{name:values['profile-name']});
      if(password) {
        if(result.saved!==true)throw new Error('Unconfirmed');
        await POSNIC.session.end();
        // Preserve the restaurant cache and durable orders for the same user to resume.
        location.href='index.html';
      } else {
        profile=result;
        document.getElementById('me-who').textContent=result.name;
        message.textContent=t('Saved');
      }
    } catch(error) {
      message.textContent=t(error.status===400?'The current password is incorrect.':'Connection failed');
    } finally {
      busy=false;page.querySelectorAll('button,input').forEach(node=>node.disabled=false);
    }
  }
  document.addEventListener('DOMContentLoaded',()=>{
    home=document.querySelector('.me-body');page=document.createElement('main');page.classList.add('me-body','profile-page');page.hidden=true;home.after(page);
    document.getElementById('me-profile').addEventListener('click',()=>show('profile'));
    document.getElementById('me-password').addEventListener('click',()=>show('password'));
    page.addEventListener('submit',submit);
    page.addEventListener('click',event=>{if(event.target.closest('[data-profile-back]'))back();if(event.target.closest('[data-profile-retry]'))void load();});
  });
  window.addEventListener('captain:back',event=>{if(current){event.preventDefault();back();}});
  window.CaptainProfile={back};
})();
