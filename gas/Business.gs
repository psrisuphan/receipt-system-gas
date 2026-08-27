/** Business.gs : loyalty, receipt numbering, purchase CRUD */

function pointsForTotal_(total){
  total = Number(total)||0;
  if(total < 200) return 0;
  if(total < 500) return 2;
  if(total < 800) return 4;
  if(total < 1000) return 6;
  return 8;
}
function calculatePurchase_(lines, redeem){
  let subtotal=0;
  lines.forEach(l=> subtotal += Number(l.quantity||0)*Number(l.unit_price||0));
  subtotal = roundMoney_(subtotal);
  const discount = redeem? roundMoney_(subtotal*0.08):0;
  const total = roundMoney_(subtotal - discount);
  return { subtotal, discount, total, pointsEarned: pointsForTotal_(total) };
}
function getReceiptPrefix_(){
  // ponytail: store_name is the prefix, sanitized to A-Z0-9, fallback STORE
  const raw = String(getConfig_('store_name')||'STORE').trim();
  const clean = raw.toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9ก-๙]/g,'').slice(0,12);
  return clean || 'STORE';
}
function allocateReceiptNumber_(purchaseAtIso){
  const lock = LockService.getScriptLock(); lock.tryLock(10000);
  try{
    const d = purchaseAtIso? new Date(purchaseAtIso): new Date();
    const y = bangkokYear_(d);
    const prefix = getReceiptPrefix_();
    const props=PropertiesService.getScriptProperties();
    const key='receipt_counter_'+prefix+'_'+y; // per-prefix per-year
    let seq = Number(props.getProperty(key)||'1');
    if(seq>999999) throw new Error('Receipt sequence exhausted for '+y);
    const receipt_number=prefix+'-'+y+'-'+String(seq).padStart(6,'0');
    props.setProperty(key, String(seq+1));
    return { receipt_year: y, receipt_sequence: seq, receipt_number };
  } finally { try{lock.releaseLock();}catch(e){} }
}

function validatePurchaseItems_(items, allowArchived){
  if(!Array.isArray(items)||!items.length) throw new Error('ต้องมีอย่างน้อย 1 รายการ');
  const out=[];
  const cats={}; getAll_('game_categories').forEach(c=> cats[c.id]=c);
  const svcs={}; getAll_('services').forEach(s=> svcs[s.id]=s);
  items.forEach((it, idx)=>{
    const sid=String(it.service_id||''); if(!sid) throw new Error('รายการที่ '+(idx+1)+' ไม่มี service');
    const svc=svcs[sid]; if(!svc) throw new Error('Service not found: '+sid);
    const cat=cats[svc.category_id]; if(!cat) throw new Error('Category not found');
    if(!allowArchived && (svc.archived_at || cat.archived_at)) throw new Error('Service/archived: '+svc.name);
    const qty=Number(it.quantity); if(!Number.isInteger(qty)||qty<=0) throw new Error('จำนวนต้องเป็นจำนวนเต็มบวก');
    const price=roundMoney_(it.unit_price); if(price<0||!isFinite(price)) throw new Error('ราคาห้ามติดลบ');
    out.push({
      service_id: svc.id,
      category_name: cat.name,
      service_name: svc.name,
      service_description: svc.description||'',
      sort_order: idx,
      quantity: qty,
      unit_price: price,
      line_total: roundMoney_(qty*price),
    });
  });
  return out;
}

function getBalances_(){
  const m={}; getAll_('point_ledger').forEach(e=> m[e.customer_id]=(m[e.customer_id]||0)+Number(e.points_delta||0));
  return m;
}
function balanceFor_(customer_id){ return getBalances_()[customer_id]||0; }

function apiCreatePurchase(payload){
  requireAdmin_();
  const lock=LockService.getScriptLock(); lock.tryLock(15000);
  try{
    const customer_id=String(payload.customer_id||'');
    const cust=findById_('customers', customer_id); if(!cust||cust.archived_at) throw new Error('Customer not found/archived');
    let purchase_at = payload.purchase_at? String(payload.purchase_at) : bangkokIsoNow_();
    // normalize datetime-local input (no TZ) -> +07:00
    if(payload.purchase_at && !purchase_at.includes('+') && !purchase_at.endsWith('Z')) purchase_at = purchase_at+':00+07:00'.replace('::',':');
    // if payload.purchase_at is already ISO with +07:00 keep it
    if(payload.purchase_at && String(payload.purchase_at).includes('+07:00')) purchase_at = String(payload.purchase_at);
    if(new Date(purchase_at) > new Date()) throw new Error('Purchase time cannot be future');
    const snapshot = validatePurchaseItems_(payload.items, false);
    const balances=getBalances_();
    const beforeBal=balances[customer_id]||0;
    const redeem=!!payload.redeem_points;
    if(redeem && beforeBal<8) throw new Error('แต้มไม่พอ (ต้องมี 8)');
    const calc=calculatePurchase_(snapshot, redeem);
    const points_used = redeem?8:0;
    const points_earned = calc.pointsEarned;
    const receipt=allocateReceiptNumber_(purchase_at);
    const id=genId_(); const now=nowIso_(); const actor=getActor_().email;
    const row={
      id, receipt_year: receipt.receipt_year, receipt_sequence: receipt.receipt_sequence, receipt_number: receipt.receipt_number,
      customer_id, purchase_at, status:'completed',
      subtotal: calc.subtotal, discount_rate: redeem?0.08:0, discount_amount: calc.discount, total_amount: calc.total,
      points_used, points_earned, note: payload.note?String(payload.note).trim():'', created_by:actor, updated_by:actor,
      cancelled_at:'', cancelled_by:'', cancellation_reason:'', created_at:now, updated_at:now,
    };
    appendRow_('purchases', row);
    snapshot.forEach(s=>{
      appendRow_('purchase_items',{id:genId_(), purchase_id:id, service_id:s.service_id, category_name:s.category_name, service_name:s.service_name, service_description:s.service_description, sort_order:s.sort_order, quantity:s.quantity, unit_price:s.unit_price, line_total:s.line_total, created_at:now});
    });
    if(points_earned) appendRow_('point_ledger',{id:genId_(), customer_id, purchase_id:id, entry_type:'purchase_earned', points_delta:points_earned, reason:'Points earned from purchase', created_by:actor, created_at:now});
    if(points_used) appendRow_('point_ledger',{id:genId_(), customer_id, purchase_id:id, entry_type:'purchase_redeemed', points_delta:-points_used, reason:'Points redeemed for discount', created_by:actor, created_at:now});
    appendAudit_('purchase_created','purchase',id,'Created purchase '+receipt.receipt_number,null,row,{points_balance_before:beforeBal, points_balance_after:beforeBal - points_used + points_earned});
    return { purchase_id:id, receipt_number: receipt.receipt_number, purchase_at, subtotal: calc.subtotal, discount_amount: calc.discount, total_amount: calc.total, points_used, points_earned, points_balance: beforeBal - points_used + points_earned };
  } finally { try{lock.releaseLock();}catch(e){} }
}

function apiEditPurchase(purchase_id, payload){
  requireAdmin_();
  const lock=LockService.getScriptLock(); lock.tryLock(15000);
  try{
    const old=findById_('purchases', purchase_id); if(!old) throw new Error('Purchase not found');
    if(old.status!=='completed') throw new Error('Only completed can be edited');
    const new_customer_id=String(payload.customer_id||old.customer_id);
    const cust=findById_('customers', new_customer_id); if(!cust) throw new Error('Customer not found');
    // NOTE: spec allows editing to archived? original restricted new assignment to archived only on create; edit allowed archived via price_purchase_items allow_archived=true, but customer guard allowed archived only if same. We mirror: allow if same id even if archived, else must be active.
    if(cust.archived_at && String(new_customer_id)!==String(old.customer_id)) throw new Error('Cannot assign to archived customer');
    let purchase_at = payload.purchase_at!=null? String(payload.purchase_at): old.purchase_at;
    if(payload.purchase_at && !String(payload.purchase_at).includes('+') && String(payload.purchase_at).length===16) purchase_at = String(payload.purchase_at)+':00+07:00';
    if(new Date(purchase_at) > new Date()) throw new Error('Purchase time cannot be future');
    const snapshot = validatePurchaseItems_(payload.items, true);
    // reverse old ledger before checking balance
    const now=nowIso_(); const actor=getActor_().email;
    // compute balance after reversing old effects (simulate ledger without old entries for this purchase)
    let balances=getBalances_();
    // add back old: old.points_earned was + , old.points_used was - (so reverse)
    // Instead compute live: balances currently includes old. For new check we need balance as if old reversed.
    let simBalForNew = (balances[new_customer_id]||0);
    if(String(old.customer_id)===String(new_customer_id)){
      // old contributed net = earned - used ; reverse means subtract net
      simBalForNew = simBalForNew - Number(old.points_earned||0) + Number(old.points_used||0);
    } else {
      // for new customer, its balance currently doesn't include old; old customer's reversal handled via separate entries but doesn't affect new's redeem check
      // for old customer we will insert reversal entries; for new we just check its current balance
    }
    const redeem=!!payload.redeem_points;
    if(redeem && simBalForNew<8) throw new Error('แต้มไม่พอสำหรับส่วนลด');
    const calc=calculatePurchase_(snapshot, redeem);
    const points_used = redeem?8:0;
    const points_earned = calc.pointsEarned;
    // ledger reversals
    if(old.points_earned) appendRow_('point_ledger',{id:genId_(), customer_id: old.customer_id, purchase_id, entry_type:'purchase_edit', points_delta: -Number(old.points_earned), reason:'Purchase edit: reverse previous earned', created_by:actor, created_at:now});
    if(old.points_used) appendRow_('point_ledger',{id:genId_(), customer_id: old.customer_id, purchase_id, entry_type:'purchase_edit', points_delta: Number(old.points_used), reason:'Purchase edit: return previous redeemed', created_by:actor, created_at:now});
    // update purchase
    updateRowById_('purchases', purchase_id, {
      customer_id: new_customer_id, purchase_at, subtotal: calc.subtotal, discount_rate: redeem?0.08:0, discount_amount: calc.discount, total_amount: calc.total, points_used, points_earned, note: payload.note!=null? String(payload.note).trim(): old.note, updated_by: actor, updated_at: now
    });
    // replace items
    const sh=getSheet_('purchase_items'); const vals=sh.getDataRange().getValues(); if(vals.length>1){ const idCol=vals[0].indexOf('purchase_id'); const rowsToDel=[]; for(let i=vals.length-1;i>=1;i--) if(String(vals[i][idCol])===String(purchase_id)) rowsToDel.push(i+1); rowsToDel.forEach(r=> sh.deleteRow(r)); }
    snapshot.forEach(s=> appendRow_('purchase_items',{id:genId_(), purchase_id, service_id:s.service_id, category_name:s.category_name, service_name:s.service_name, service_description:s.service_description, sort_order:s.sort_order, quantity:s.quantity, unit_price:s.unit_price, line_total:s.line_total, created_at:now}));
    // new ledger
    if(points_earned) appendRow_('point_ledger',{id:genId_(), customer_id:new_customer_id, purchase_id, entry_type:'purchase_edit', points_delta: points_earned, reason:'Purchase edit: apply new earned', created_by:actor, created_at:now});
    if(points_used) appendRow_('point_ledger',{id:genId_(), customer_id:new_customer_id, purchase_id, entry_type:'purchase_edit', points_delta: -points_used, reason:'Purchase edit: apply new redeemed', created_by:actor, created_at:now});
    const after=findById_('purchases', purchase_id);
    const newBal = (getBalances_()[new_customer_id]||0);
    appendAudit_('purchase_edited','purchase',purchase_id,'Edited purchase '+old.receipt_number,old,after,{previous_points_earned:old.points_earned, new_points_earned:points_earned, previous_points_used:old.points_used, new_points_used:points_used});
    return { purchase_id, receipt_number: old.receipt_number, purchase_at, subtotal: calc.subtotal, discount_amount: calc.discount, total_amount: calc.total, points_used, points_earned, points_balance: newBal };
  } finally { try{lock.releaseLock();}catch(e){} }
}

function apiCancelPurchase(purchase_id, reason){
  requireAdmin_();
  const lock=LockService.getScriptLock(); lock.tryLock(15000);
  try{
    reason=String(reason||'').trim(); if(!reason) throw new Error('ต้องระบุเหตุผลยกเลิก');
    const old=findById_('purchases', purchase_id); if(!old) throw new Error('Purchase not found');
    if(old.status!=='completed') throw new Error('Already cancelled');
    const now=nowIso_(); const actor=getActor_().email;
    updateRowById_('purchases', purchase_id, {status:'cancelled', cancelled_at: now, cancelled_by: actor, cancellation_reason: reason, updated_by: actor, updated_at: now});
    if(old.points_earned) appendRow_('point_ledger',{id:genId_(), customer_id: old.customer_id, purchase_id, entry_type:'purchase_cancelled', points_delta: -Number(old.points_earned), reason:'Cancelled purchase: reverse earned', created_by:actor, created_at:now});
    if(old.points_used) appendRow_('point_ledger',{id:genId_(), customer_id: old.customer_id, purchase_id, entry_type:'purchase_cancelled', points_delta: Number(old.points_used), reason:'Cancelled purchase: return redeemed', created_by:actor, created_at:now});
    const after=findById_('purchases', purchase_id);
    appendAudit_('purchase_cancelled','purchase',purchase_id,'Cancelled purchase '+old.receipt_number,old,after,{reason});
    return true;
  } finally { try{lock.releaseLock();}catch(e){} }
}

function apiAdjustPoints(customer_id, delta, reason){
  requireAdmin_();
  delta=Number(delta); if(!delta) throw new Error('จำนวนแต้มต้องไม่เป็น 0');
  reason=String(reason||'').trim(); if(!reason) throw new Error('ต้องระบุเหตุผล');
  const cust=findById_('customers', customer_id); if(!cust) throw new Error('Customer not found');
  const before=balanceFor_(customer_id);
  appendRow_('point_ledger',{id:genId_(), customer_id, purchase_id:'', entry_type:'manual_adjustment', points_delta: delta, reason, created_by:getActor_().email, created_at: nowIso_()});
  const after=before+delta;
  appendAudit_(delta>0?'points_added':'points_deducted','customer',customer_id,'Adjusted customer points by '+delta,{points_balance:before},{points_balance:after},{points_delta:delta, reason});
  return { customer_id, points_delta:delta, points_balance:after };
}
