(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./index.js'));
  else root.PosnicConnectionSetupUI = factory(root.PosnicConnectionSetup);
})(typeof globalThis === 'object' ? globalThis : this, function (model) {
  'use strict';
  const svgNS='http://www.w3.org/2000/svg';
  function node(doc, tag, className, text) {
    const el=doc.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;
  }
  function image(doc, src, size) {
    // Assets may be relative, bundled file URLs or HTTPS. Never inject caller markup.
    if(typeof src!=='string'||!src.trim()||/^(?:javascript|data|vbscript):/i.test(src.trim()))throw new TypeError('Invalid logo URL');
    const img=node(doc,'img');img.src=src;img.width=size;img.height=size;img.alt='';return img;
  }
  function icon(doc, name) {
    if(!Object.prototype.hasOwnProperty.call(model.icons,name))throw new TypeError('Unknown icon: '+name);
    const svg=doc.createElementNS(svgNS,'svg');
    for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':name==='more'?'3':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);
    const path=doc.createElementNS(svgNS,'path');path.setAttribute('d',model.icons[name]);svg.append(path);return svg;
  }
  function decorateMethod(button, method, {posnicLogo}={}) {
    const doc=button.ownerDocument;
    if(method.description)button.setAttribute('aria-label',method.label);
    if(method.description)button.setAttribute('aria-description',method.description);else button.removeAttribute('aria-description');
    const tile=node(doc,'span','pc-method-icon'+(method.icon==='posnic'?' pc-posnic-icon':''));tile.setAttribute('aria-hidden','true');
    tile.append(method.icon==='posnic'?image(doc,posnicLogo,24):icon(doc,method.icon));
    const label=node(doc,'span','pc-method-label');label.append(node(doc,'span','',method.label));
    if(method.description)label.append(node(doc,'small','pc-method-description',method.description));
    const arrow=node(doc,'span','pc-method-arrow');arrow.setAttribute('aria-hidden','true');arrow.append(icon(doc,'arrow'));
    button.replaceChildren(tile,label,arrow);button.classList.add('pc-method');button.dataset.posnicConnection='method';
    // Existing click listeners and form semantics stay owned by the host app.
    return button;
  }
  function mountMethods(container,{onSelect,posnicLogo,...options}={}) {
    if(typeof onSelect!=='function')throw new TypeError('onSelect is required');
    const children=model.methods(options).map(method=>{
      const button=node(container.ownerDocument,'button');button.type='button';
      decorateMethod(button,method,{posnicLogo});button.onclick=()=>onSelect(method.id);return button;
    });
    container.append(...children);
    return ()=>children.forEach(button=>{button.onclick=null;button.remove();});
  }
  function renderWelcome(container,{logo,onContinue,...options}) {
    if(typeof onContinue!=='function')throw new TypeError('onContinue is required');
    const content=model.welcome(options),doc=container.ownerDocument;
    const wrapper=node(doc,'div','pc-welcome');wrapper.dataset.posnicConnection='welcome';
    const brand=node(doc,'div','pc-welcome-brand'),name=node(doc,'div');
    name.append(node(doc,'strong','',content.name),node(doc,'small','',content.subtitle));brand.append(image(doc,logo,42),name);
    const art=node(doc,'div','pc-welcome-art');art.setAttribute('aria-hidden','true');
    const phone=node(doc,'div','pc-art-phone');phone.append(image(doc,logo,26),node(doc,'b'),node(doc,'b'),node(doc,'b'));
    const till=node(doc,'div','pc-art-till');till.append(image(doc,logo,38));art.append(phone,node(doc,'span','pc-art-link','···'),till);
    wrapper.append(brand,art,node(doc,'h2','',content.title),node(doc,'p','',content.eyebrow),node(doc,'p','',content.description));
    content.steps.forEach((text,index)=>{
      const step=node(doc,'div','pc-welcome-step');step.style.animationDelay=(index*120)+'ms';step.append(node(doc,'span','pc-welcome-number',String(index+1)),node(doc,'span','',text));wrapper.append(step);
    });
    const button=node(doc,'button','pc-primary',content.continueLabel);button.type='button';button.onclick=onContinue;wrapper.append(button);container.append(wrapper);
    return ()=>{button.onclick=null;wrapper.remove();};
  }
  return Object.freeze({decorateMethod,mountMethods,renderWelcome});
});
