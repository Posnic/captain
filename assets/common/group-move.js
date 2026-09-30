/* Durable group moves are scoped to the signed-in shop, staff and branch. */
(function(root){
  const active = new Map();
  function identity(){
    const s=root.POSNIC?.session, branch=localStorage.getItem('branch_id');
    if(!s?.shopKey || !s.user?.id || !branch)throw new Error(root.I18N?.t('Sign in with your account') || 'Sign in with your account');
    return JSON.stringify([s.shopKey,s.user.id,branch]);
  }
  const key=(owner,order)=>'posnic.group-move:'+owner+':'+order;
  function read(order){
    const owner=identity();
    const value=JSON.parse(localStorage.getItem(key(owner,order))||'null');
    if(value && (value.owner!==owner || value.body.orderId!==order))throw new Error(root.I18N?.t('Could not save. Please try again.') || 'Could not save. Please try again.');
    return value;
  }
  function save(order,selection){
    const existing=read(order);
    if(existing)return existing;
    const owner=identity();
    const entry={owner,body:{orderId:order,request_id:crypto.randomUUID(),tableIds:selection.tableIds,primaryId:selection.primaryId,guests:selection.guests}};
    localStorage.setItem(key(owner,order),JSON.stringify(entry));
    return entry;
  }
  async function run(entry){
    const storageKey=key(entry.owner,entry.body.orderId);
    if(active.has(storageKey))return active.get(storageKey);
    const same=()=>{if(identity()!==entry.owner)throw new Error(root.I18N?.t('Sign in with your account') || 'Sign in with your account');};
    const operation=(async()=>{
      same();
      let cancellationConflict;
      if (entry.cancel || entry.cancelReady) {
        let cancelled;
        try {
          cancelled=await root.POSNIC.api.post('/captain/v1/tables/move/cancel',{
            request_id:entry.body.request_id,orderId:entry.body.orderId
          });
        } catch (error) {
          if (error.status !== 409) throw error;
          cancellationConflict=error;
        }
        same();
        if (!cancellationConflict) {
          if(cancelled?.request_id!==entry.body.request_id || cancelled.state!=='cancelled')throw new Error(root.I18N?.t('Could not save. Please try again.') || 'Could not save. Please try again.');
          localStorage.removeItem(storageKey);
          return {type:'success',cancelled:true};
        }
      }
      const prepared=await root.POSNIC.api.post('/captain/v1/tables/move/prepare',entry.body);
      same();
      if(prepared.request_id!==entry.body.request_id || prepared.orderId!==entry.body.orderId)throw new Error(root.I18N?.t('Could not save. Please try again.') || 'Could not save. Please try again.');
      // A reservation conflict is not permission to finish a cancelled move.
      // Only reconcile a move the server confirms has already begun applying.
      if (cancellationConflict && !['applying','submitting'].includes(prepared.state))throw cancellationConflict;
      const result=await root.POSNIC.api.post('/captain/v1/tables/move/complete',{request_id:entry.body.request_id});
      same();
      if(result.request_id!==entry.body.request_id || result.orderId!==entry.body.orderId || result.state!=='submitting')throw new Error(root.I18N?.t('Could not save. Please try again.') || 'Could not save. Please try again.');
      localStorage.removeItem(storageKey);
      return {type:'success',tableIds:result.tableIds};
    })();
    active.set(storageKey,operation);
    try{return await operation;}finally{active.delete(storageKey);}
  }
  function cancel(order) {
    const entry=read(order);
    if (!entry) throw new Error(root.I18N?.t('Choose a table first.') || 'Choose a table first.');
    const storageKey=key(entry.owner,order);
    // Do not turn an in-flight completion into a concurrent cancellation.
    if(active.has(storageKey))return active.get(storageKey);
    entry.cancel=true;
    localStorage.setItem(storageKey,JSON.stringify(entry));
    return run(entry);
  }
  root.CaptainGroupMove={cancel,pending:read,move:(order,selection)=>run(save(order,selection)),resume:order=>{const entry=read(order);if(!entry)throw new Error(root.I18N?.t('Choose a table first.') || 'Choose a table first.');return run(entry);}};
})(globalThis);
