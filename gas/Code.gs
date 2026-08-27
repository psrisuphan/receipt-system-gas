/** GAS - Code.gs : auth, sheet helpers, setup, router */
// ponytail: global script lock, per-year locks if throughput matters

const SHEETS = {
  customers: ['id','customer_code','name','line_id','x_account','notes','archived_at','created_at','updated_at','created_by'],
  game_categories: ['id','name','color','archived_at','created_at','updated_at','created_by'],
  services: ['id','category_id','name','description','default_price','archived_at','created_at','updated_at','created_by'],
  purchases: ['id','receipt_year','receipt_sequence','receipt_number','customer_id','purchase_at','status','subtotal','discount_rate','discount_amount','total_amount','points_used','points_earned','note','created_by','updated_by','cancelled_at','cancelled_by','cancellation_reason','created_at','updated_at'],
  purchase_items: ['id','purchase_id','service_id','category_name','service_name','service_description','sort_order','quantity','unit_price','line_total','created_at'],
  point_ledger: ['id','customer_id','purchase_id','entry_type','points_delta','reason','created_by','created_at'],
  payment_evidence: ['id','purchase_id','file_id','mime_type','byte_size','original_filename','uploaded_by','uploaded_at'],
  audit_logs: ['id','actor_email','actor_name','event_type','entity_type','entity_id','summary','before_data','after_data','metadata','created_at'],
};

const CATEGORY_COLORS = ['#e8f2ef','#fef6ef','#eef2ff','#f3eefc','#fdf0ef','#fff4e6','#e6f7f5','#f5f7e8'];
function nextCategoryColor_(){
  const cats = getAll_('game_categories').filter(c=>!c.archived_at);
  return CATEGORY_COLORS[cats.length % CATEGORY_COLORS.length];
}

function doGet() {
  const email = Session.getActiveUser().getEmail();
  const fallbackName = getConfig_('store_name') || 'Receipt System';
  if (!email) return HtmlService.createHtmlOutput('Please sign in with Google').setTitle(fallbackName);
  try { requireAdmin_(); } catch(e) {
    return HtmlService.createHtmlOutput('<h2 style="font-family:sans-serif;padding:40px">Access denied: '+email+' not in allowlist. Ask owner to add you to _config allowlist.</h2>').setTitle('Denied');
  }
  const t = HtmlService.createTemplateFromFile('Index');
  t.storeName = fallbackName;
  return t.evaluate().setTitle(fallbackName).addMetaTag('viewport','width=device-width,initial-scale=1').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include_(f){ return HtmlService.createHtmlOutputFromFile(f).getContent(); }

// --- spreadsheet ---
function getSpreadsheet_(){
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error('No spreadsheet: set SPREADSHEET_ID script property or run as bound script');
}
function getSheet_(name){
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(SHEETS[name]); }
  return sh;
}
function getConfigSheet_(){
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName('_config');
  if (!sh) { sh = ss.insertSheet('_config'); sh.getRange('A1:B1').setValues([['key','value']]); }
  return sh;
}
function getConfig_(key){
  const sh = getConfigSheet_();
  const vals = sh.getDataRange().getValues();
  for (let i=1;i<vals.length;i++) if (vals[i][0]===key) return vals[i][1];
  return null;
}
function setConfig_(key, val){
  const sh = getConfigSheet_();
  const vals = sh.getDataRange().getValues();
  for (let i=1;i<vals.length;i++) if (vals[i][0]===key){ sh.getRange(i+1,2).setValue(val); return; }
  sh.appendRow([key, val]);
}

// --- auth ---
function getActor_(){
  const email = Session.getActiveUser().getEmail() || '';
  return { email: email, name: email.split('@')[0] };
}
function getAllowlist_(){
  const sh = getConfigSheet_();
  const vals = sh.getDataRange().getValues();
  const list = [];
  let inAllow = false;
  for (let i=0;i<vals.length;i++){
    if (vals[i][0]==='admin_allowlist') { inAllow=true; continue; }
    if (inAllow) { if (vals[i][0]) list.push(String(vals[i][0]).trim().toLowerCase()); }
  }
  // also allow header row if user added emails in column A below label
  // fallback: if empty, treat executor as admin (bootstrap)
  return list;
}
function isActiveAdmin_(){
  const email = (Session.getActiveUser().getEmail()||'').trim().toLowerCase();
  if (!email) return false;
  const list = getAllowlist_();
  if (!list.length) return true; // bootstrap: first user is admin until allowlist populated
  return list.includes(email);
}
function requireAdmin_(){
  if (!isActiveAdmin_()) throw new Error('Not authorized: '+Session.getActiveUser().getEmail());
}

// --- utils ---
function nowIso_(){ return new Date().toISOString(); }
function bangkokIsoNow_(){ return Utilities.formatDate(new Date(), 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ss'+07:00'"); }
function bangkokYear_(d){ return Number(Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy')); }
function genId_(){ return Utilities.getUuid(); }
function toBangkokDisplay_(iso){ try{ return Utilities.formatDate(new Date(iso), 'Asia/Bangkok', 'dd/MM/yyyy HH:mm'); }catch(e){ return iso; } }
function normalizeX_(v){ return String(v||'').trim().replace(/^@+/,'').toLowerCase(); }
function roundMoney_(n){ return Math.round(Number(n)*100)/100; }

// --- sheet row helpers ---
function getAll_(name){
  const sh = getSheet_(name);
  const vals = sh.getDataRange().getValues();
  if (vals.length<2) return [];
  const header = vals[0];
  const out=[];
  for(let i=1;i<vals.length;i++){
    const o={}; for(let j=0;j<header.length;j++) o[header[j]]=vals[i][j];
    // normalize empty string -> null for easier checks, keep numbers as-is
    for(const k in o) if(o[k]==='') o[k]=null;
    o.__row = i+1;
    out.push(o);
  }
  return out;
}
function appendRow_(name, obj){
  const sh = getSheet_(name);
  const header = SHEETS[name];
  const row = header.map(h => obj[h]==null ? '' : obj[h]);
  sh.appendRow(row);
}
function updateRowById_(name, id, patch){
  const sh = getSheet_(name);
  const vals = sh.getDataRange().getValues();
  const header = vals[0];
  const idCol = header.indexOf('id');
  for(let i=1;i<vals.length;i++){
    if(String(vals[i][idCol])===String(id)){
      for(const k in patch){
        const col = header.indexOf(k);
        if(col>=0) sh.getRange(i+1, col+1).setValue(patch[k]==null?'':patch[k]);
      }
      return true;
    }
  }
  return false;
}
function findById_(name, id){
  return getAll_(name).find(r=>String(r.id)===String(id))||null;
}

// --- audit ---
function appendAudit_(event_type, entity_type, entity_id, summary, before_data, after_data, metadata){
  const actor = getActor_();
  appendRow_('audit_logs',{
    id: genId_(),
    actor_email: actor.email,
    actor_name: actor.name,
    event_type, entity_type, entity_id,
    summary,
    before_data: before_data? JSON.stringify(before_data):'',
    after_data: after_data? JSON.stringify(after_data):'',
    metadata: metadata? JSON.stringify(metadata):'{}',
    created_at: nowIso_(),
  });
}

// --- drive ---
function getDriveFolder_(){
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('DRIVE_FOLDER_ID');
  if(id){ try{ return DriveApp.getFolderById(id); }catch(e){} }
  const folders = DriveApp.getFoldersByName('payment-evidence');
  if(folders.hasNext()) return folders.next();
  const f = DriveApp.createFolder('payment-evidence');
  props.setProperty('DRIVE_FOLDER_ID', f.getId());
  return f;
}

// --- setup ---
function setup(){
  const ss = getSpreadsheet_();
  // create sheets
  Object.keys(SHEETS).forEach(n=> getSheet_(n));
  const cfg = getConfigSheet_();
  // seed config if empty
  if(!getConfig_('store_name')) setConfig_('store_name','STORE');
  if(!getConfig_('receipt_footer')) setConfig_('receipt_footer','ขอบคุณที่ใช้บริการครับ');
  // allowlist bootstrap
  const vals = cfg.getDataRange().getValues();
  const hasAllow = vals.some(r=>r[0]==='admin_allowlist');
  if(!hasAllow){
    cfg.appendRow(['admin_allowlist','']);
    const me = Session.getActiveUser().getEmail();
    if(me) cfg.appendRow([me,'allowlisted']);
  }
  // ensure header rows have correct columns (repair if mismatch)
  Object.keys(SHEETS).forEach(n=>{
    const sh = ss.getSheetByName(n);
    const header = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].filter(v=>v);
    if(header.join(',')!==SHEETS[n].join(',')) {
      if(sh.getLastRow()===1){
        sh.clear(); sh.appendRow(SHEETS[n]);
      } else if(n==='game_categories' && header.join(',')==='id,name,archived_at,created_at,updated_at,created_by'){
        const vals = sh.getDataRange().getValues();
        const newVals = vals.map((row, idx)=>{
          if(idx===0) return SHEETS[n];
          return [row[0], row[1], '', row[2], row[3], row[4], row[5]];
        });
        sh.clear();
        sh.getRange(1,1,newVals.length, SHEETS[n].length).setValues(newVals);
      } else {
        // migrate: keep data, just update header row
        sh.getRange(1,1,1,SHEETS[n].length).setValues([SHEETS[n]]);
      }
    }
  });
  // Drive folder
  getDriveFolder_();
  return 'Setup done: '+ss.getUrl();
}
function resetDemoData_(){ // dev helper
  requireAdmin_();
  Object.keys(SHEETS).forEach(n=>{
    const sh = getSheet_(n);
    if(sh.getLastRow()>1) sh.deleteRows(2, sh.getLastRow()-1);
  });
  PropertiesService.getScriptProperties().deleteProperty('customer_code_seq');
}

// --- API exposed to google.script.run ---
function apiGetInit(){
  requireAdmin_();
  const customers = getAll_('customers');
  const categories = getAll_('game_categories');
  const services = getAll_('services');
  const purchases = getAll_('purchases');
  const items = getAll_('purchase_items');
  const ledger = getAll_('point_ledger');
  const evidence = getAll_('payment_evidence');
  const audit = getAll_('audit_logs').slice(-200).reverse();
  // compute balances
  const balances={};
  ledger.forEach(e=>{ balances[e.customer_id]=(balances[e.customer_id]||0)+Number(e.points_delta||0); });
  const store_name = getConfig_('store_name')||'STORE';
  const receipt_footer = getConfig_('receipt_footer')||'';
  const logo_path = getConfig_('logo_file_id')||'';
  let logoUrl=''; if(logo_path){ try{ logoUrl='https://drive.google.com/uc?export=view&id='+logo_path; }catch(e){} }
  return { customers, categories, services, purchases, items, ledger, evidence, audit, balances, store_name, receipt_footer, logoUrl, actor:getActor_() };
}
function apiGetPurchases(filter){
  requireAdmin_();
  let purchases = getAll_('purchases');
  // filter.status, customer_id, q, from, to
  if(filter){
    if(filter.status) purchases = purchases.filter(p=>p.status===filter.status);
    if(filter.customer_id) purchases = purchases.filter(p=>String(p.customer_id)===String(filter.customer_id));
    if(filter.q){
      const q = String(filter.q).toLowerCase();
      const customers = getAll_('customers');
      const cmap={}; customers.forEach(c=> cmap[c.id]=c);
      purchases = purchases.filter(p=>{
        const c=cmap[p.customer_id]; const hay=[p.receipt_number, c?c.name:'', c?c.customer_code:'', c?c.line_id:'', c?c.x_account:''].join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    if(filter.from) { const from=new Date(filter.from+'T00:00:00+07:00'); purchases=purchases.filter(p=> new Date(p.purchase_at) >= from); }
    if(filter.to){ const to=new Date(filter.to+'T00:00:00+07:00'); to.setDate(to.getDate()+1); purchases=purchases.filter(p=> new Date(p.purchase_at) < to); }
  }
  purchases.sort((a,b)=> new Date(b.purchase_at)-new Date(a.purchase_at));
  return purchases.slice(0,200);
}
function apiCreateCustomer(payload){
  requireAdmin_();
  const name = String(payload.name||'').trim();
  const line_id = payload.line_id? String(payload.line_id).trim(): null;
  const x_account = payload.x_account? normalizeX_(payload.x_account): null;
  const notes = payload.notes? String(payload.notes).trim(): null;
  if(!name) throw new Error('กรุณาระบุชื่อลูกค้า');
  if(!line_id && !normalizeX_(x_account||'')) throw new Error('ต้องมี LINE หรือ X อย่างน้อยหนึ่งช่องทาง');
  const customers = getAll_('customers');
  if(line_id && customers.some(c=> !c.archived_at && String(c.line_id||'').trim().toLowerCase()===line_id.toLowerCase())) throw new Error('LINE นี้มีอยู่แล้ว');
  if(x_account && customers.some(c=> !c.archived_at && normalizeX_(c.x_account)===x_account)) throw new Error('X นี้มีอยู่แล้ว');
  const lock = LockService.getScriptLock(); lock.tryLock(10000);
  try{
    const props = PropertiesService.getScriptProperties();
    let seq = Number(props.getProperty('customer_code_seq')||'0')+1;
    props.setProperty('customer_code_seq', String(seq));
    const code = 'CUS-'+String(seq).padStart(6,'0');
    const id = genId_();
    const now = nowIso_(); const actor=getActor_().email;
    const row={ id, customer_code:code, name, line_id: line_id||'', x_account: x_account||'', notes: notes||'', archived_at:'', created_at:now, updated_at:now, created_by:actor };
    appendRow_('customers', row);
    appendAudit_('customer_created','customer',id,'Created customer '+name,null,row,{});
    return row;
  } finally { try{lock.releaseLock();}catch(e){} }
}
function apiUpdateCustomer(id, patch){
  requireAdmin_();
  const c = findById_('customers', id); if(!c) throw new Error('Customer not found');
  const before={...c};
  const name = patch.name!=null? String(patch.name).trim(): c.name;
  const line_id = patch.line_id!==undefined? (patch.line_id? String(patch.line_id).trim(): ''): (c.line_id||'');
  const x_account = patch.x_account!==undefined? (patch.x_account? normalizeX_(patch.x_account): ''): (c.x_account||'');
  const notes = patch.notes!==undefined? (patch.notes? String(patch.notes).trim(): ''): (c.notes||'');
  if(!name) throw new Error('ชื่อห้ามว่าง');
  if(!line_id && !x_account) throw new Error('ต้องมี LINE หรือ X');
  const customers=getAll_('customers').filter(x=> String(x.id)!==String(id) && !x.archived_at);
  if(line_id && customers.some(x=> String(x.line_id||'').trim().toLowerCase()===line_id.toLowerCase())) throw new Error('LINE ซ้ำ');
  if(x_account && customers.some(x=> normalizeX_(x.x_account)===x_account)) throw new Error('X ซ้ำ');
  updateRowById_('customers', id, { name, line_id, x_account, notes, updated_at: nowIso_() });
  const after=findById_('customers', id);
  appendAudit_('customer_updated','customer',id,'Updated customer '+name,before,after,{});
  return after;
}
function apiArchiveCustomer(id){
  requireAdmin_();
  const c=findById_('customers',id); if(!c) throw new Error('Not found');
  updateRowById_('customers',id,{archived_at: nowIso_(), updated_at: nowIso_()});
  appendAudit_('customer_archived','customer',id,'Archived customer '+c.name,c,{archived:true},{});
  return true;
}
function apiMergeCustomers(primaryId, duplicateId){
  requireAdmin_();
  if(String(primaryId)===String(duplicateId)) throw new Error('Cannot merge same customer');
  const p=findById_('customers',primaryId), d=findById_('customers',duplicateId);
  if(!p||!d) throw new Error('Customer not found');
  // move purchases
  const purchases=getAll_('purchases').filter(x=> String(x.customer_id)===String(duplicateId));
  purchases.forEach(pur=> updateRowById_('purchases', pur.id, {customer_id: primaryId, updated_at: nowIso_()}));
  // move ledger
  const ledger=getAll_('point_ledger').filter(x=> String(x.customer_id)===String(duplicateId));
  ledger.forEach(e=> updateRowById_('point_ledger', e.id, {customer_id: primaryId}));
  // archive duplicate
  updateRowById_('customers', duplicateId, {archived_at: nowIso_(), updated_at: nowIso_()});
  appendAudit_('customer_merged','customer',primaryId,'Merged '+d.customer_code+' into '+p.customer_code,{duplicate:d,primary:p},{duplicateId, primaryId},{});
  return true;
}
function apiUpsertCategory(payload){
  requireAdmin_();
  const name=String(payload.name||'').trim(); if(!name) throw new Error('Category name required');
  const cats=getAll_('game_categories');
  const color = payload.color ? String(payload.color).trim() : null;
  if(payload.id){
    const cat=findById_('game_categories', payload.id); if(!cat) throw new Error('Category not found');
    if(cats.some(c=> !c.archived_at && String(c.id)!==String(payload.id) && String(c.name).trim().toLowerCase()===name.toLowerCase())) throw new Error('Category name exists');
    const patch={name, updated_at: nowIso_()};
    if(color) patch.color = color;
    updateRowById_('game_categories', payload.id, patch);
    const after=findById_('game_categories', payload.id);
    appendAudit_('category_updated','category',payload.id,'Updated category '+name,cat,after,{});
    return after;
  } else {
    if(cats.some(c=> !c.archived_at && String(c.name).trim().toLowerCase()===name.toLowerCase())) throw new Error('Category name exists');
    const rowColor = color || nextCategoryColor_();
    const row={id:genId_(), name, color: rowColor, archived_at:'', created_at: nowIso_(), updated_at: nowIso_(), created_by:getActor_().email};
    appendRow_('game_categories', row); appendAudit_('category_created','category',row.id,'Created category '+name,null,row,{}); return row;
  }
}
function apiArchiveCategory(id){
  requireAdmin_();
  const cat=findById_('game_categories',id); if(!cat) throw new Error('Not found');
  updateRowById_('game_categories',id,{archived_at: nowIso_(), updated_at: nowIso_()});
  // archive services in category
  getAll_('services').filter(s=> String(s.category_id)===String(id) && !s.archived_at).forEach(s=> updateRowById_('services', s.id, {archived_at: nowIso_()}));
  appendAudit_('category_archived','category',id,'Archived category '+cat.name,cat,{archived:true},{});
  return true;
}
function apiUpsertService(payload){
  requireAdmin_();
  const name=String(payload.name||'').trim(); if(!name) throw new Error('Service name required');
  const category_id=String(payload.category_id||''); if(!category_id) throw new Error('Category required');
  const cat=findById_('game_categories', category_id); if(!cat||cat.archived_at) throw new Error('Category not found/archived');
  const price=roundMoney_(payload.default_price||0); if(price<0) throw new Error('Price negative');
  const description=payload.description? String(payload.description).trim(): '';
  const svcs=getAll_('services');
  if(payload.id){
    const svc=findById_('services', payload.id); if(!svc) throw new Error('Service not found');
    if(svcs.some(s=> !s.archived_at && String(s.id)!==String(payload.id) && String(s.category_id)===String(category_id) && String(s.name).trim().toLowerCase()===name.toLowerCase())) throw new Error('Service exists in category');
    updateRowById_('services', payload.id, {category_id, name, description, default_price: price, updated_at: nowIso_()});
    const after=findById_('services', payload.id); appendAudit_('service_updated','service',payload.id,'Updated service '+name,svc,after,{}); return after;
  } else {
    if(svcs.some(s=> !s.archived_at && String(s.category_id)===String(category_id) && String(s.name).trim().toLowerCase()===name.toLowerCase())) throw new Error('Service exists in category');
    const row={id:genId_(), category_id, name, description, default_price: price, archived_at:'', created_at: nowIso_(), updated_at: nowIso_(), created_by:getActor_().email};
    appendRow_('services', row); appendAudit_('service_created','service',row.id,'Created service '+name,null,row,{}); return row;
  }
}
function apiArchiveService(id){
  requireAdmin_();
  const s=findById_('services',id); if(!s) throw new Error('Not found');
  updateRowById_('services',id,{archived_at: nowIso_(), updated_at: nowIso_()});
  appendAudit_('service_archived','service',id,'Archived service '+s.name,s,{archived:true},{});
  return true;
}
function apiSaveSettings(payload){
  requireAdmin_();
  if(payload.store_name!=null) setConfig_('store_name', String(payload.store_name).trim());
  if(payload.receipt_footer!=null) setConfig_('receipt_footer', String(payload.receipt_footer).trim());
  // logo: payload.logoBase64 + logoName
  if(payload.logoBase64){
    const folder=getDriveFolder_();
    const blob=Utilities.newBlob(Utilities.base64Decode(payload.logoBase64.split(',').pop()), payload.logoMime||'image/png', 'store-logo');
    const file=folder.createFile(blob); file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    setConfig_('logo_file_id', file.getId());
  }
  appendAudit_('settings_updated','store_settings','1','Updated store settings',null,payload,{});
  return true;
}
function apiUploadEvidence(purchase_id, fileName, mime, base64){
  requireAdmin_();
  const pur=findById_('purchases', purchase_id); if(!pur) throw new Error('Purchase not found');
  const bytes = Utilities.base64Decode(base64.split(',').pop());
  if(bytes.length>10*1024*1024) throw new Error('File >10MB');
  if(!['image/jpeg','image/jpg','image/png'].includes((mime||'').toLowerCase())) throw new Error('Only JPG/PNG');
  const folder=getDriveFolder_();
  const blob=Utilities.newBlob(bytes, mime, fileName||'evidence');
  const file=folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  // upsert payment_evidence
  const existing=getAll_('payment_evidence').find(e=> String(e.purchase_id)===String(purchase_id));
  if(existing){
    // delete old file if possible
    try{ DriveApp.getFileById(existing.file_id).setTrashed(true);}catch(e){}
    updateRowById_('payment_evidence', existing.id, {file_id: file.getId(), mime_type:mime, byte_size: bytes.length, original_filename: fileName, uploaded_by:getActor_().email, uploaded_at: nowIso_()});
    appendAudit_('evidence_replaced','payment_evidence',existing.id,'Replaced evidence for '+pur.receipt_number,{old:existing.file_id},{new:file.getId()},{});
  } else {
    const row={id:genId_(), purchase_id, file_id: file.getId(), mime_type:mime, byte_size: bytes.length, original_filename: fileName, uploaded_by:getActor_().email, uploaded_at: nowIso_()};
    appendRow_('payment_evidence', row);
    appendAudit_('evidence_uploaded','payment_evidence',row.id,'Uploaded evidence for '+pur.receipt_number,null,row,{});
  }
  return file.getId();
}
function apiRemoveEvidence(purchase_id){
  requireAdmin_();
  const ev=getAll_('payment_evidence').find(e=> String(e.purchase_id)===String(purchase_id));
  if(!ev) return false;
  try{ DriveApp.getFileById(ev.file_id).setTrashed(true);}catch(e){}
  const sh=getSheet_('payment_evidence');
  const vals=sh.getDataRange().getValues(); const header=vals[0]; const idCol=header.indexOf('id');
  for(let i=1;i<vals.length;i++) if(String(vals[i][idCol])===String(ev.id)){ sh.deleteRow(i+1); break; }
  appendAudit_('evidence_removed','payment_evidence',ev.id,'Removed evidence',ev,null,{});
  return true;
}
function apiRecordExport(type, meta){
  requireAdmin_();
  appendAudit_('export_'+type,'export', genId_(), 'Export '+type, null, meta||{}, meta||{});
  return true;
}
