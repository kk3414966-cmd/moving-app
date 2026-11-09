// 報價單分頁：開單、清單、收款帳號、作廢。資料存 Firestore quotes/{代碼}（見 store.js）。
export function mountQuotes(rootEl, api) {

var CUR = 15000;
var NOTICE = [
 '現場物品數量、樓層、電梯、搬運距離和報價不同時，我們會先跟您說明，您同意後才調整；沒有同意不會加價。',
 '日期與時間確認後，我們會保留這個時段。',
 '訂金為總金額的 10%，確認後支付；其餘在完工後以現金或轉帳付清。',
 '搬家日三天前取消，訂金全額退還；三天內取消，會扣除已安排的人力費用（金額會先跟您說明）。',
 '搬運中如有物品損壞，我們會當場跟您確認、說明並協商處理。',
 '易碎、貴重物品請自行收好或事先告知。',
 '電梯故障等無法預期的狀況，我們會當場說明並討論怎麼處理。',
 '行程如有變動，請在 LINE 通知我們。'
];
var DEFAULT_DEFS = [
 {id:'move',name:'搬運',type:'truck'},
 {id:'pack',name:'打包',type:'time',box:'pack'},
 {id:'place',name:'歸位',type:'time',box:'place'},
 {id:'furn',name:'家具拆裝',type:'lines'},
 {id:'junk',name:'清運',type:'lines'},
 {id:'clean',name:'清潔',type:'lines'},
 {id:'store',name:'倉儲',type:'lines'},
 {id:'other',name:'其他',type:'lines'}
];
var TYPES = {truck:'每車價格 × 車趟',time:'按時間（基本價／小時）',lines:'可輸入細項',flat:'單一金額'};
var defs = JSON.parse(JSON.stringify(DEFAULT_DEFS));
function loadDefs(){ var d=api.settings().quoteDefs; if(d&&d.length) defs=JSON.parse(JSON.stringify(d)); }
function saveDefs(){ api.saveSettings({quoteDefs:defs}); }
var screen='list', openId=null, draft=null, manage=false;
function $(id){return rootEl.querySelector('#'+id)}
function n(v){v=parseInt(String(v||'').replace(/[^0-9]/g,''),10);return isNaN(v)?0:v}
function fm(v){return 'NT$ '+Number(v).toLocaleString('en-US')}
function esc(t){return String(t==null?'':t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function defaultVal(d){
 if(d.type==='truck') return {truck:5000,trips:1};
 if(d.type==='time') return {price:3000,hrs:2,over:1500,est:2};
 if(d.type==='lines') return {lines:[{n:'',q:'1',p:0}]};
 return {amt:0};
}
function newDraft(){
 var d={raw:'',src:'',name:'',date:'',dateV:'',timeV:'待補',from:'',fromFloor:'',fromElev:'有',to:'',toFloor:'',toElev:'有',on:{},v:{},disc:0,note:''};
 defs.forEach(function(x){d.v[x.id]=defaultVal(x)});
 return d;
}
function ensureV(d){ defs.forEach(function(x){ if(!d.v[x.id]) d.v[x.id]=defaultVal(x); }); }
function addr(a,fl,el){ if(!a) return ''; return a+(fl?' '+fl+' 樓':'')+'（'+el+'電梯）'; }

var SLOTS=['待補','上午','下午','晚上'];
(function(){ for(var h=6;h<=21;h++){ SLOTS.push(String(h).padStart(2,'0')+':00'); SLOTS.push(String(h).padStart(2,'0')+':30'); } })();
function dateText(d){
 var tv=d.timeV||'待補', tt=tv==='待補'?'時間待補':tv;
 if(!d.dateV) return '日期待補'+(tv==='待補'?'':' '+tv);
 var p=d.dateV.split('-'), w='日一二三四五六'[new Date(+p[0],+p[1]-1,+p[2]).getDay()];
 return (+p[1])+'/'+(+p[2])+'（'+w+'） '+tt;
}
function readDateText(txt){
 var t=String(txt||'').replace(/：/g,':'), m=t.match(/(?:(\d{4})[\/\-年])?(\d{1,2})[\/月\-](\d{1,2})/), r={dateV:'',timeV:'待補'};
 if(m){ var now=new Date(), y=+m[1]||now.getFullYear(), mo=+m[2], dd=+m[3];
  if(mo>=1&&mo<=12&&dd>=1&&dd<=31){ if(!m[1]&&new Date(y,mo-1,dd+1)<now) y++; r.dateV=y+'-'+String(mo).padStart(2,'0')+'-'+String(dd).padStart(2,'0'); } }
 var rest=m?t.slice(m.index+m[0].length):t, hh=null, mm='00';
 var a=rest.match(/(\d{1,2}):(\d{2})/), b=rest.match(/(\d{1,2})\s*[點时時]\s*(半|\d{1,2})?/);
 if(a){hh=+a[1];mm=a[2];} else if(b){hh=+b[1]; mm=b[2]==='半'?'30':(b[2]?String(b[2]).padStart(2,'0'):'00');}
 if(hh!==null){ if(/下午|晚上|晚/.test(rest)&&hh<12) hh+=12; var lab=String(hh).padStart(2,'0')+':'+(mm==='00'||mm==='30'?mm:(+mm<15?'00':(+mm<45?'30':'00')));
  if(SLOTS.indexOf(lab)>=0) r.timeV=lab; }
 else if(/上午|早上/.test(rest)) r.timeV='上午'; else if(/下午/.test(rest)) r.timeV='下午'; else if(/晚上/.test(rest)) r.timeV='晚上';
 return r;
}

var SRC_DEF=['地','回','賴','粉'], srcManage=false;
function srcList(){ var l=api.settings().quoteSrc; return (l&&l.length)?l:SRC_DEF; }
function countyOf(a){ var m=String(a||'').replace(/臺/g,'台').match(/^\s*([一-龥]{2,3}[縣市])/); return m?m[1]:''; }
function areaOf(a){ var t=String(a||'').replace(/臺/g,'台').replace(/^\s*[一-龥]{2,3}[縣市]/,''), m=t.match(/([一-龥]{1,3}?)([區鄉鎮])/); if(!m) return ''; return m[1].length===1?m[1]+m[2]:m[1]; }
function buildTitle(d){
 var dg={}, texts=[], mv=null;
 defs.forEach(function(x){
  if(!d.on[x.id]) return;
  if(x.id==='move'){ dg['3']=1; mv=d.v[x.id]; if(!(mv.trips>0&&mv.trips<1)) dg['0']=1; }
  else if(x.id==='pack') dg['8']=1; else if(x.id==='place') dg['9']=1; else if(x.id==='junk') dg['7']=1;
  else texts.push({furn:'拆',clean:'清',store:'倉'}[x.id]||String(x.name||'').charAt(0)); // 沒代號的項目：拆／清／倉（自訂項目取第一個字），寫在代號後面、點之前
 });
 var ca=countyOf(d.from), cb=countyOf(d.to); if(ca&&cb&&ca!==cb) dg['6']=1;
 var a1=areaOf(d.from)||ca.replace(/[縣市]$/,''), a2=areaOf(d.to)||cb.replace(/[縣市]$/,'');
 var ff=d.fromElev==='有'?'0':String(d.fromFloor||''), tf=d.toElev==='有'?'0':String(d.toFloor||''); // 有電梯一律寫 0，沒電梯寫樓層
 var code=Object.keys(dg).sort().join('');
 var head='';
 var tx=texts.join(''); if(code||tx){ head=(mv&&mv.trips>1?mv.trips+'×':'')+code+tx+'.'+a1+a2+(ff!==''&&tf!==''?ff+'.'+tf:''); }
 var parts=[/^\d{2}:\d{2}$/.test(d.timeV||'')?'':'(待確)', head, d.name.trim()].concat([d.src||'']).filter(Boolean);
 return parts.join(' ');
}
function qty(l){ var t=String(l.q==null?'':l.q).trim(); return /^\d+$/.test(t)?parseInt(t,10):1; }
function calcItems(d){
 var out=[];
 defs.forEach(function(x){
  if(!d.on[x.id]) return;
  var v=d.v[x.id];
  if(x.type==='truck') out.push({id:x.id,name:x.name,sub:'每車 '+fm(v.truck)+' × 預估 '+v.trips+' 車（實際車趟數當天看現場確認）',amt:Math.round(v.truck*v.trips)});
  else if(x.type==='time'){
   var extra=v.est>v.hrs?Math.ceil(v.est-v.hrs)*v.over:0;
   out.push({id:x.id,name:x.name,sub:fm(v.price)+'／'+v.hrs+' 小時，超過每小時 '+fm(v.over).replace('NT$ ','')+(v.est>v.hrs?'；預估 '+v.est+' 小時，含超時 '+fm(extra):''),amt:v.price+extra});
  } else if(x.type==='lines'){
   var ls=v.lines.filter(function(l){return l.n.trim()||l.p}), sum=0;
   ls.forEach(function(l){sum+=qty(l)*l.p});
   out.push({id:x.id,name:x.name,sub:'',lines:ls.map(function(l){return {n:l.n||'（未命名）',q:l.q,p:l.p}}),amt:sum});
  } else out.push({id:x.id,name:x.name,sub:'',amt:v.amt});
 });
 return out;
}
function totals(d){
 var items=calcItems(d), sub=0; items.forEach(function(i){sub+=i.amt});
 var disc=Math.min(d.disc,sub), total=sub-disc;
 return {items:items,sub:sub,disc:disc,total:total,dep:Math.round(total*0.1)};
}
function boxesFor(d){
 var out=[];
 defs.forEach(function(x){
  if(!d.on[x.id]||!x.box) return; var v=d.v[x.id];
  var money=fm(v.price)+'／'+v.hrs+' 小時；超過時間每小時 '+fm(v.over)+'。';
  if(x.box==='pack') out.push({t:'代客包裝',h:money+'<br>・不用事先準備包材，我們自備包材到府<br>・到府後依物品狀況分類、包裝<br>・您只要告訴我們哪些東西要帶走<br>・物品較多可先傳照片，先評估大約需要的時間'});
  if(x.box==='place') out.push({t:'歸位',h:'搬到新家後，依您指定的位置協助擺放家具、拆箱，並把物品放回櫃子、衣櫃與廚房。<br>・費用：'+money+'做完為止<br>・請當天在現場告訴我們每樣東西要放哪裡<br>・不含組裝以外的裝潢、清潔、擦拭與接水電瓦斯'});
 });
 return out;
}

/* ---------- 貼上資料自動填入 ---------- */
function parsePaste(txt){
 var d=draft, got=[], miss=[], hints=[];
 var lines=txt.replace(/\r/g,'').split('\n').map(function(x){return x.trim()});
 function lab(res){
  for(var i=0;i<lines.length;i++){
   for(var r=0;r<res.length;r++){
    var m=lines[i].match(new RegExp('(?:^|[①②③④⑤⑥⑦⑧⑨\\d\\.\\s])\\s*(?:'+res[r]+')[^：:\\n]{0,12}[:：]\\s*(.*)$'));
    if(m){ var v=m[1].trim().replace(/^[（(][^）)]*[）)]\s*/,''); if(v) return v; for(var j=i+1;j<lines.length;j++){ if(lines[j]){ if(/[:：]\s*$/.test(lines[j])||/^[①②③④⑤⑥]/.test(lines[j])) return ''; return lines[j]; } } return ''; }
   }
  } return '';
 }
 function elev(t){ if(!t) return ''; if(/無電梯|沒電梯|沒有電梯/.test(t)) return '無'; if(/電梯|^有/.test(t)) return '有'; if(/^無|^沒/.test(t)) return '無'; return ''; }
 function floorOf(t){ var m=t.match(/(\d{1,2})\s*(?:樓|F|f)/); return m?m[1]:''; }
 function clean(t){ return t.replace(/[（(][^）)]*電梯[^）)]*[）)]/g,'').replace(/\s+/g,' ').trim(); }
 var name='',date='',from='',to='',fF='',tF='',fE='',tE='';
 var route=lab(['路線']);
 if(route){
  var parts=route.split(/→|->|＞|>/); var rf=(parts[0]||'').replace(/，?\s*約\s*[\d.]+\s*公里.*$/,''), rt=(parts[1]||'').replace(/，?\s*約\s*[\d.]+\s*公里.*$/,'');
  from=clean(rf); to=clean(rt); fE=elev(rf); tE=elev(rt); fF=floorOf(rf); tF=floorOf(rt);
 }
 if(!from){ var f1=lab(['舊家區域／地址','舊家區域/地址','舊址','舊家','舊居','搬出地址','搬出','現址','原址','出發地']); if(f1){from=clean(f1); fE=fE||elev(f1); fF=fF||floorOf(f1);} }
 if(!to){ var t1=lab(['新家區域／地址','新家區域/地址','新址','新家','新居','搬入地址','搬入','搬到','目的地']); if(t1){to=clean(t1); tE=tE||elev(t1); tF=tF||floorOf(t1);} }
 var f2=lab(['舊家樓層','舊址樓層']); if(f2){ fE=elev(f2)||fE; fF=floorOf(f2)||fF; }
 var t2=lab(['新家樓層','新址樓層']); if(t2){ tE=elev(t2)||tE; tF=floorOf(t2)||tF; }
 name=lab(['客人','客戶','姓名','聯絡人','稱呼','名字']);
 if(!name){ var m0=txt.match(/([一-龥]{1,3}(?:小姐|先生|太太|媽媽|老闆))/); if(m0) name=m0[1]; }
 if(!name){ for(var k=0;k<lines.length;k++){ var m1=lines[k].match(/^([^\s　：:【】]{1,6})[\s　]+\d{6,}/); if(m1){name=m1[1];break;} } }
 date=lab(['日期時間','搬家日期','搬家時間','搬家日','日期','時間']);
 if(!date){ var m2=txt.match(/(\d{1,2}[\/月]\d{1,2}[日號]?[^\n，,]{0,14})/); if(m2) date=m2[1].trim(); }
 if(name){d.name=name;got.push('客人')}else miss.push('客人');
 var rd=date?readDateText(date):null; if(rd&&rd.dateV){d.dateV=rd.dateV;d.timeV=rd.timeV;got.push('日期時間')}else miss.push('日期時間');
 if(from){d.from=from;got.push('舊址')}else miss.push('舊址');
 if(to){d.to=to;got.push('新址')}else miss.push('新址');
 if(fF) d.fromFloor=fF; if(tF) d.toFloor=tF; if(fE) d.fromElev=fE; if(tE) d.toElev=tE;
 if(fE||fF) got.push('舊址樓層／電梯'); else miss.push('舊址樓層／電梯');
 if(tE||tF) got.push('新址樓層／電梯'); else miss.push('新址樓層／電梯');
 var kw={move:/搬運|搬家|搬|路線|估價/,pack:/打包|包裝/,place:/歸位|整理上架|拆箱/,furn:/拆裝|拆床|組裝|拆卸/,junk:/清運|回收|丟棄|廢棄/,clean:/清潔|打掃|清掃/,store:/倉儲|寄放/};
 var hit=[];
 defs.forEach(function(x){ var re=kw[x.id]; if(re&&re.test(txt)){d.on[x.id]=true;hit.push(x.name)} else if(!re&&x.name&&x.type!=='lines'&&x.name!=='其他'&&txt.indexOf(x.name)>=0){d.on[x.id]=true;hit.push(x.name)} });
 if(hit.length) got.push('服務項目（'+hit.join('、')+'）'); else miss.push('服務項目');
 var est=txt.match(/估價[^\n$]*\$\s*([\d,]+)[^\n]*?客人看到[:：]\s*\$?\s*([\d,～~\-\s$]+)/);
 if(est) hints.push('官網估價：內部 $'+est[1]+'，客人看到 '+est[2].trim()+'（只供參考，沒有自動填）');
 var big=lab(['大型物品','家具／大型物品','家具/大型物品']); if(big&&!/[？?]|拍照給我/.test(big)) hints.push('大型物品：'+big);
 var things=lab(['東西','其他物品']); if(things&&!/[？?]/.test(things)) hints.push('東西：'+things);
 d.raw=txt;
 return '已幫你填：'+(got.join('、')||'（沒有）')+'。'+(miss.length?' 沒找到：'+miss.join('、')+'，請自己補。':'')+(hints.length?' 參考資料：'+hints.join('；')+'。':'')+' 請檢查一下再往下。金額不會自動填。';
}

/* ---------- APP side ---------- */
function renderApp(){
 if(screen==='list') return renderList();
 var d=draft; ensureV(d); var t=totals(d);
 var h='<section><h1>開報價單</h1><label>先把客人傳來的資料整段貼在這裡（LINE 對話、表單都可以）</label>'
 +'<textarea id="paste" rows="5" placeholder="例如：\n客人：王小姐\n日期：11/20 上午9點\n舊址：台中市北屯區○○路5樓無電梯\n新址：台中市西屯區○○路12樓有電梯\n要打包、清運">'+esc(d.raw)+'</textarea>'
 +'<button class="btn sec" id="doParse">自動幫我填</button><div class="box" id="pmsg" style="'+(d._pmsg?'':'display:none')+'">'+esc(d._pmsg||'')+'</div>'
 +'<div class="muted">這個功能是用關鍵字找（客人、日期、舊址、新址、服務項目），格式不一樣就會漏，漏掉的自己補。</div></section>';
 h+='<section class="tight"><h2>客人與搬家資料</h2>'
 +'<input id="f_name" placeholder="客人姓名" value="'+esc(d.name)+'">'
 +'<div class="row2"><input type="date" id="f_dateV" value="'+esc(d.dateV)+'" aria-label="搬家日期"><select id="f_timeV" aria-label="時間">'+SLOTS.map(function(x){return '<option value="'+x+'"'+((d.timeV||'待補')===x?' selected':'')+'>'+(x==='待補'?'時間待補':x)+'</option>'}).join('')+'</select></div>'
 +'<input id="f_from" placeholder="舊址（區域、路名）" value="'+esc(d.from)+'">'+elevRow('from',d)
 +'<input id="f_to" placeholder="新址（區域、路名）" value="'+esc(d.to)+'">'+elevRow('to',d)
 +'<div class="row" style="flex-wrap:wrap"><span class="muted">來源</span>'+srcList().map(function(k){return srcManage?'<button type="button" class="chip" data-srcdel="'+esc(k)+'" style="color:#B91C1C">'+esc(k)+' ✕</button>':'<button type="button" class="chip'+(d.src===k?' on':'')+'" data-src="'+esc(k)+'">'+esc(k)+'</button>'}).join('')+'<button type="button" class="chip" id="srcAdd">＋</button><button type="button" class="chip" id="srcMng">'+(srcManage?'完成':'管理')+'</button></div><div class="muted">來源客人看不到，只會寫在行事曆標題最後面。</div></section>';
 h+='<section><div class="sp"><h2>服務項目（點一下勾選）</h2><button class="btn sm sec" id="mng">'+(manage?'完成':'管理項目')+'</button></div>';
 if(manage){
  h+='<div class="box">在這裡可以改名稱、改計價方式、刪除，或新增自己的項目。</div>';
  defs.forEach(function(x,i){
   h+='<div class="card"><input data-dn="'+i+'" value="'+esc(x.name)+'"><select data-dt="'+i+'" style="min-height:44px;border:1px solid #CBD5E1;border-radius:10px;font:inherit;font-size:15px;padding:0 8px">'
   +Object.keys(TYPES).map(function(k){return '<option value="'+k+'"'+(x.type===k?' selected':'')+'>'+TYPES[k]+'</option>'}).join('')+'</select>'
   +'<button class="btn sm sec" data-dd="'+i+'">刪除這個項目</button></div>';
  });
  h+='<div class="card"><label>新增項目（每個新項目都能輸入細項、數量、金額）</label><input id="newName" placeholder="例如：鋼琴搬運"><button class="btn sm" id="addDef">＋ 新增</button></div>';
 } else {
  h+='<div class="chips">'+defs.map(function(x){return '<button type="button" class="chip'+(d.on[x.id]?' on':'')+'" data-chip="'+x.id+'">'+(d.on[x.id]?'✓ ':'')+esc(x.name)+'</button>'}).join('')+'</div>'
  +'<div class="muted">勾了「打包」或「歸位」，客人頁才會出現對應的說明。</div>';
 }
 h+='</section>';
 if(!manage){
  h+='<section><h2>金額（只有你看得到分項）</h2>';
  var any=false;
  defs.forEach(function(x){
   if(!d.on[x.id]) return; any=true; var v=d.v[x.id], k=x.id;
   h+='<div class="card"><b>'+esc(x.name)+'</b>';
   if(x.type==='truck') h+='<div class="row"><input id="t_'+k+'" data-f="truck" data-k="'+k+'" inputmode="numeric" value="'+v.truck+'" style="width:110px"><span class="muted">元／車 × 預估</span><input id="r_'+k+'" data-f="trips" data-k="'+k+'" inputmode="decimal" value="'+v.trips+'" style="width:56px"><span class="muted">車</span></div><div class="muted">車數可輸入 0.5（半車）、1.5（一車半）</div><div class="sp"><span class="muted">小計</span><b data-isub="'+k+'">'+fm(Math.round(v.truck*v.trips))+'</b></div>';
   else if(x.type==='time') h+='<div class="muted">基本價與時數、超時費可在這裡改</div><div class="row"><input id="p_'+k+'" data-f="price" data-k="'+k+'" inputmode="numeric" value="'+v.price+'" style="width:96px"><span class="muted">元／</span><input id="h_'+k+'" data-f="hrs" data-k="'+k+'" inputmode="numeric" value="'+v.hrs+'" style="width:56px"><span class="muted">小時</span></div>'
    +'<div class="row"><span class="muted">超時每小時</span><input id="o_'+k+'" data-f="over" data-k="'+k+'" inputmode="numeric" value="'+v.over+'" style="width:96px"><span class="muted">元</span></div>'
    +'<div class="row"><span class="muted">預估共</span><input id="e_'+k+'" data-f="est" data-k="'+k+'" inputmode="numeric" value="'+v.est+'" style="width:56px"><span class="muted">小時</span><span style="flex:1"></span><b data-isub="'+k+'">'+fm(v.price+(v.est>v.hrs?Math.ceil(v.est-v.hrs)*v.over:0))+'</b></div>';
   else if(x.type==='lines'){
    var sum=0;
    v.lines.forEach(function(l,i){ sum+=qty(l)*l.p;
     h+='<div class="row"><input data-ln="'+k+'|'+i+'" placeholder="細項，如：沙發" value="'+esc(l.n)+'" style="text-align:left;flex:1;min-width:0"><input id="q_'+k+'_'+i+'" data-lq="'+k+'|'+i+'" placeholder="數量" value="'+esc(l.q)+'" style="width:58px"><button type="button" class="btn sm sec" data-lw="'+k+'|'+i+'" style="width:40px;padding:0;min-height:44px" aria-label="一式">式</button><input id="lp_'+k+'_'+i+'" data-lp="'+k+'|'+i+'" inputmode="numeric" placeholder="0" value="'+(l.p||'')+'" style="width:84px"><button class="btn sm sec" data-ld="'+k+'|'+i+'" style="width:44px;padding:0" aria-label="刪除這一列">✕</button></div>';
    });
    h+='<div class="muted">每列：細項名稱／數量（可打「一式」，或按「式」）／單價</div><button class="btn sm sec" data-la="'+k+'">＋ 加一列細項</button><div class="sp"><span class="muted">小計</span><b data-isub="'+k+'">'+fm(sum)+'</b></div>';
   } else h+='<div class="sp"><label>金額</label><input id="m_'+k+'" data-f="amt" data-k="'+k+'" inputmode="numeric" placeholder="0" value="'+(v.amt||'')+'" style="width:120px"></div>';
   h+='</div>';
  });
  if(!any) h+='<div class="muted">請先在上面勾選服務項目。</div>';
  h+='<div style="height:1px;background:#E2E8F0"></div>'
  +'<div class="sp"><span class="muted">小計（自動加總）</span><b id="sSub">'+fm(t.sub)+'</b></div>'
  +'<div class="sp"><label for="f_disc" style="color:#B45309;font-weight:700;font-size:14px">折扣金額（沒有就留空）</label><input id="f_disc" inputmode="numeric" placeholder="0" value="'+(d.disc||'')+'" style="width:120px;text-align:right"></div>'
  +'<div class="sp"><span class="muted">客人看到的總價</span><span class="big" id="sTot">'+fm(t.total)+'</span></div>'
  +'<div class="sp"><span class="muted">訂金（總金額 10%，自動）</span><b id="sDep">'+fm(t.dep)+'</b></div>'
  +'<div class="box" style="background:#FEF9E7;color:#7A5B00">總價 15,000 以下：客人一鍵確認。超過會自動要求手寫簽名。</div></section>';
  h+='<section><label for="f_note">給客人的備註（選填）</label><textarea id="f_note" placeholder="例如：電梯已預約、搬完幫忙拆床架">'+esc(d.note)+'</textarea>'
  +'<button class="btn" id="gen">產生報價單連結</button></section>';
 }
 h+='<section><button class="btn sec" id="cancelNew">回清單</button></section>';
 rootEl.innerHTML=h; bindApp();
}
function elevRow(k,d){
 return '<div class="row"><input id="fl_'+k+'" data-fl="'+k+'" inputmode="numeric" placeholder="幾" class="fl" value="'+esc(d[k+'Floor'])+'"><span class="muted">樓</span>'
 +'<button type="button" class="chip'+(d[k+'Elev']==='有'?' on':'')+'" data-el="'+k+'|有">有電梯</button><button type="button" class="chip'+(d[k+'Elev']==='無'?' on':'')+'" data-el="'+k+'|無">無電梯</button></div>';
}
var noSel=false;
function bindApp(){
 var d=draft;
 function live(){ var t=totals(draft); t.items.forEach(function(i){ var e=rootEl.querySelector('[data-isub="'+i.id+'"]'); if(e) e.textContent=fm(i.amt); });
  if($('sSub'))$('sSub').textContent=fm(t.sub); if($('sTot'))$('sTot').textContent=fm(t.total); if($('sDep'))$('sDep').textContent=fm(t.dep); }
 function rk(id){ live(); }
 function rkOld(id){ var el=$(id), pos=el?el.selectionStart:0; renderApp(); var e2=$(id); if(e2){noSel=true; e2.focus(); noSel=false; try{e2.setSelectionRange(pos,pos)}catch(x){}} }
 [['f_name','name'],['f_from','from'],['f_to','to'],['f_note','note']].forEach(function(p){ var el=$(p[0]); if(el) el.oninput=function(){d[p[1]]=el.value}; });
 if($('f_dateV')) $('f_dateV').onchange=function(){d.dateV=this.value};
 if($('f_timeV')) $('f_timeV').onchange=function(){d.timeV=this.value};
 if($('paste')) $('paste').oninput=function(){d.raw=this.value};
 if($('doParse')) $('doParse').onclick=function(){ d._pmsg=parsePaste($('paste').value); renderApp(); };
 if($('f_disc')) $('f_disc').oninput=function(){d.disc=n(this.value); rk('f_disc')};
 rootEl.querySelectorAll('[data-f]').forEach(function(el){ el.oninput=function(){ var v=d.v[el.getAttribute('data-k')], f=el.getAttribute('data-f'); v[f]=(f==='trips')?(parseFloat(String(el.value).replace(/[^0-9.]/g,''))||0):n(el.value); if(f==='trips'&&!(v.trips>0))v.trips=0; if(f==='hrs'&&v.est<v.hrs)v.est=v.hrs; rk(el.id)}; });
  if($('srcAdd')) $('srcAdd').onclick=function(){ var v=prompt('新增來源（例如：社、AI）'); v=(v||'').trim(); if(!v) return; var l=srcList().slice(); if(l.indexOf(v)<0) l.push(v); api.saveSettings({quoteSrc:l}); d.src=v; renderApp(); };
 if($('srcMng')) $('srcMng').onclick=function(){ srcManage=!srcManage; renderApp(); };
 rootEl.querySelectorAll('[data-srcdel]').forEach(function(b){ b.onclick=function(){ var k=b.getAttribute('data-srcdel'); api.saveSettings({quoteSrc:srcList().filter(function(x){return x!==k})}); if(d.src===k) d.src=''; renderApp(); }; });
 rootEl.querySelectorAll('[data-src]').forEach(function(b){ b.onclick=function(){ var k=b.getAttribute('data-src'); d.src=(d.src===k?'':k); renderApp(); }; });
 rootEl.querySelectorAll('[data-chip]').forEach(function(b){ b.onclick=function(){var k=b.getAttribute('data-chip'); d.on[k]=!d.on[k]; renderApp()}; });
 rootEl.querySelectorAll('[data-ln]').forEach(function(el){ el.oninput=function(){var p=el.getAttribute('data-ln').split('|'); d.v[p[0]].lines[+p[1]].n=el.value}; });
 rootEl.querySelectorAll('[data-lq]').forEach(function(el){ el.oninput=function(){var p=el.getAttribute('data-lq').split('|'); d.v[p[0]].lines[+p[1]].q=el.value; rk(el.id)}; });
 rootEl.querySelectorAll('[data-lp]').forEach(function(el){ el.oninput=function(){var p=el.getAttribute('data-lp').split('|'); d.v[p[0]].lines[+p[1]].p=n(el.value); rk(el.id)}; });
 rootEl.querySelectorAll('[data-lw]').forEach(function(b){ b.onclick=function(){var p=b.getAttribute('data-lw').split('|'); var l=d.v[p[0]].lines[+p[1]]; l.q=(l.q==='一式'?'1':'一式'); renderApp()}; });
 rootEl.querySelectorAll('[data-ld]').forEach(function(b){ b.onclick=function(){var p=b.getAttribute('data-ld').split('|'); var ls=d.v[p[0]].lines; ls.splice(+p[1],1); if(!ls.length)ls.push({n:'',q:'1',p:0}); renderApp()}; });
 rootEl.querySelectorAll('[data-la]').forEach(function(b){ b.onclick=function(){d.v[b.getAttribute('data-la')].lines.push({n:'',q:'1',p:0}); renderApp()}; });
 rootEl.querySelectorAll('[data-fl]').forEach(function(el){ el.oninput=function(){ d[el.getAttribute('data-fl')+'Floor']=el.value.replace(/[^0-9]/g,''); }; });
 rootEl.querySelectorAll('[data-el]').forEach(function(b){ b.onclick=function(){ var p=b.getAttribute('data-el').split('|'); d[p[0]+'Elev']=p[1]; renderApp(); }; });
 rootEl.querySelectorAll('[data-f],[data-lq],[data-lp],#f_disc').forEach(function(el){ el.onchange=function(){ renderApp(); }; });
 rootEl.querySelectorAll('input[inputmode=numeric],input[inputmode=decimal]').forEach(function(el){ el.onfocus=function(){ if(noSel) return; var t=this; setTimeout(function(){ try{t.select()}catch(e){} },0); }; });
 if($('mng')) $('mng').onclick=function(){manage=!manage; renderApp()};
 rootEl.querySelectorAll('[data-dn]').forEach(function(el){ el.oninput=function(){defs[+el.getAttribute('data-dn')].name=el.value; saveDefs()}; });
 rootEl.querySelectorAll('[data-dt]').forEach(function(el){ el.onchange=function(){var x=defs[+el.getAttribute('data-dt')]; x.type=el.value; d.v[x.id]=defaultVal(x); saveDefs(); renderApp()}; });
 rootEl.querySelectorAll('[data-dd]').forEach(function(b){ b.onclick=function(){var i=+b.getAttribute('data-dd'); delete d.on[defs[i].id]; defs.splice(i,1); saveDefs(); renderApp()}; });
 if($('addDef')) $('addDef').onclick=function(){ var nm=$('newName').value.trim(); if(!nm){alert2('請先輸入項目名稱');return;} var x={id:'c'+Date.now(),name:nm,type:'lines'}; defs.push(x); d.v[x.id]=defaultVal(x); saveDefs(); renderApp(); };
 $('cancelNew').onclick=function(){screen='list';manage=false;renderApp()};
 if($('gen')) $('gen').onclick=function(){
  var t=totals(d);
  if(!d.name.trim()){ alert2('請先填客人姓名'); return; }
  if(!t.items.length){ alert2('請至少勾一個服務項目'); return; }
  var today=new Date(), ymd0=today.getFullYear()+String(today.getMonth()+1).padStart(2,'0')+String(today.getDate()).padStart(2,'0');
  var cnt=api.quotes().filter(function(x){return String(x.no||'').indexOf('Q-'+ymd0)===0}).length+1;
  var tok=randToken();
  var q={no:'Q-'+ymd0+'-'+String(cnt).padStart(2,'0'),id:tok,token:tok,
   name:d.name,date:dateText(d),from:addr(d.from,d.fromFloor,d.fromElev),to:addr(d.to,d.toFloor,d.toElev),pay:getPay(),items:t.items,sub:t.sub,disc:t.disc,total:t.total,dep:t.dep,note:d.note,
   status:'未確認',custNote:'',sig:null,at:null,boxes:boxesFor(d),src:d.src||'',calTitle:buildTitle(d)};
  Promise.resolve(api.saveQuote(q)).catch(function(e){ alert2('存到雲端失敗（'+((e&&e.code)||'錯誤')+'）：請確認 Firebase 規則已設定，客人才打得開連結'); }); screen='list'; openId=q.id; renderApp(); toast2('已產生報價單連結');
 };
}
function randToken(){ var a=new Uint8Array(16); (window.crypto||window.msCrypto).getRandomValues(a); return Array.prototype.map.call(a,function(x){return ('0'+x.toString(16)).slice(-2)}).join(''); }
function toast2(m){ alert2(m); }
var BASE='https://kk3414966-cmd.github.io/business-sites/moving/quote.html?t=';
function alert2(m){ var e=document.createElement('div'); e.className='banner'; e.style.cssText='position:fixed;top:60px;left:50%;transform:translateX(-50%);max-width:400px;z-index:20;border-radius:10px;font-size:14px'; e.textContent=m; document.body.appendChild(e); setTimeout(function(){e.remove()},2200); }
var openSet={}, showPay=false, showVoid=false;
function qCard(q){
 var pc=q.status==='未確認'?'p0':(q.status==='作廢'?'p2':'p1');
 var st=q.status==='已確認'&&q.sig?'已確認・已簽名':(q.status==='作廢'?'已作廢':q.status);
 var op=!!openSet[q.id];
 var h='<section class="card qrow" style="margin:8px 12px;padding:10px 12px;gap:6px"><div class="sp" data-tg="'+q.id+'" style="cursor:pointer"><div style="min-width:0"><b>'+esc(q.name)+'</b><div class="muted" style="line-height:1.4">'+esc(q.date)+'・'+fm(q.total)+'</div></div><span class="pill '+pc+'" style="white-space:nowrap">'+st+(op?' ▲':' ▼')+'</span></div>';
 if(op){
  h+='<div class="muted">'+esc(q.no||q.id)+(q.total>CUR?'・需簽名':'')+'</div>'
  +(q.calTitle?'<div class="box">行事曆標題：<b>'+esc(q.calTitle)+'</b></div>':'')
  +(q.custNote?'<div class="box">客人備註：'+esc(q.custNote)+'</div>':'')
  +'<div class="box" style="background:#EFF6FF;word-break:break-all"><span id="lk_'+q.id+'">'+BASE+q.token+'</span></div>'
  +'<div class="row" style="flex-wrap:wrap"><button class="btn sm" data-copy="'+q.id+'">複製連結</button><button class="btn sm sec" data-open="'+q.id+'">看客人頁</button>'
  +(q.status!=='作廢'?'<button class="btn sm sec" data-void="'+q.id+'">作廢</button>':'<button class="btn sm sec" data-del="'+q.id+'" style="color:#B91C1C;border-color:#B91C1C">刪除</button>')+'</div>';
 }
 return h+'</section>';
}
function renderList(){
 var pay=getPay();
 var h='<section><h1>報價單</h1><button class="btn" id="newQ">＋ 開新報價單</button></section>';
 h+='<section style="padding:12px 16px"><div class="sp" id="tgPay" style="cursor:pointer"><h2>收款帳號'+(pay.acct?'（已設定）':'（還沒設定）')+'</h2><span class="muted">'+(showPay?'收起 ▲':'修改 ▼')+'</span></div>'
 +(showPay?'<label>銀行（含代號）</label><input id="pay_bank" value="'+esc(pay.bank)+'" placeholder="例如：○○銀行（代號 000）"><label>帳號</label><input id="pay_acct" inputmode="numeric" value="'+esc(pay.acct)+'" placeholder="輸入你的收款帳號"><label>戶名</label><input id="pay_holder" value="'+esc(pay.holder)+'" placeholder="戶名"><div class="muted">客人按確認之後才看得到。</div>':'')+'</section>';
 var quotes=api.quotes();
 var g={w:[],c:[],v:[]};
 quotes.forEach(function(q){ (q.status==='未確認'?g.w:(q.status==='作廢'?g.v:g.c)).push(q); });
 if(!quotes.length) h+='<section><div class="muted">還沒有報價單。按上面「開新報價單」開始。</div></section>';
 function grp(t,list){ if(!list.length) return ''; return '<div class="muted" style="margin:14px 16px 0;font-weight:700;color:#1F3A5F">'+t+'（'+list.length+'）</div>'+list.map(qCard).join(''); }
 h+=grp('等客人確認',g.w)+grp('客人已確認',g.c);
 if(g.v.length){
  h+='<section style="padding:12px 16px"><div class="sp" id="tgVoid" style="cursor:pointer"><h2>已作廢（'+g.v.length+'）</h2><span class="muted">'+(showVoid?'收起 ▲':'展開 ▼')+'</span></div>'
  +(showVoid?'<button class="btn sm sec" id="delAllVoid" style="color:#B91C1C;border-color:#B91C1C">全部刪除（'+g.v.length+' 張）</button>':'')+'</section>';
  if(showVoid) h+=g.v.map(qCard).join('');
 }
 rootEl.innerHTML=h;
 if($('tgPay')) $('tgPay').onclick=function(){showPay=!showPay;renderList()};
 if($('tgVoid')) $('tgVoid').onclick=function(){showVoid=!showVoid;renderList()};
 ['bank','acct','holder'].forEach(function(k){ var el=$('pay_'+k); if(el) el.oninput=function(){ var p=getPay(); p=Object.assign({},p); p[k]=this.value; clearTimeout(payT); payT=setTimeout(function(){setPay(p)},700); }; });
 $('newQ').onclick=function(){draft=newDraft();screen='new';manage=false;openId=null;renderApp()};
 rootEl.querySelectorAll('[data-tg]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-tg'); openSet[id]=!openSet[id]; renderList()}});
 rootEl.querySelectorAll('[data-open]').forEach(function(b){b.onclick=function(){ try{ window.open(BASE+find(b.getAttribute('data-open')).token,'_blank'); }catch(e){} }});
 rootEl.querySelectorAll('[data-copy]').forEach(function(b){b.onclick=function(){ var q=find(b.getAttribute('data-copy')); var url=BASE+q.token; try{ navigator.clipboard.writeText(url).then(function(){toast2('已複製連結，貼到 LINE 給客人')},function(){toast2('複製失敗，請手動長按連結複製')}); }catch(e){ toast2('複製失敗，請手動長按連結複製'); } }});
 rootEl.querySelectorAll('[data-void]').forEach(function(b){b.onclick=function(){var q=find(b.getAttribute('data-void'));if(q&&confirm('確定作廢這張報價單？客人打開連結會看到「已作廢」。')){Promise.resolve(api.updateQuote(q.token,{status:'作廢'})).catch(function(e){ alert2('作廢失敗（'+((e&&e.code)||'錯誤')+'）'); });}}});
 function del(q){ return Promise.resolve(api.deleteQuote(q.id)).catch(function(e){ alert2('刪除失敗（'+((e&&e.code)||'錯誤')+'）'); }); }
 rootEl.querySelectorAll('[data-del]').forEach(function(b){b.onclick=function(){var q=find(b.getAttribute('data-del'));if(q&&confirm('確定刪除「'+q.name+'」這張作廢報價單？刪掉就找不回來。')) del(q);}});
 if($('delAllVoid')) $('delAllVoid').onclick=function(){ var vs=api.quotes().filter(function(q){return q.status==='作廢'}); if(vs.length&&confirm('確定刪除全部 '+vs.length+' 張作廢報價單？刪掉就找不回來。')) vs.reduce(function(p,q){return p.then(function(){return del(q)})},Promise.resolve()); };
}
var payT=null;
function getPay(){ return api.settings().quotePay||{bank:'',acct:'',holder:''}; }
function setPay(p){ api.saveSettings({quotePay:p}); }
function find(id){var qs=api.quotes();for(var i=0;i<qs.length;i++)if(qs[i].id===id)return qs[i];return null}


  loadDefs();
  var style=document.createElement('style'); style.textContent='#qroot{font-size:15px;color:#1E293B;background:#F5F7FA;margin:-12px;padding-bottom:30px} #qroot *{box-sizing:border-box} #qroot .banner{background:#FEF9E7;color:#7A5B00;font-size:12px;line-height:1.6;padding:8px 14px}#qroot section{background:#fff;border-radius:14px;margin:12px;padding:16px;display:flex;flex-direction:column;gap:10px}#qroot h1{margin:0;font-size:20px;color:#1F3A5F}#qroot h2{margin:0;font-size:15px;color:#1F3A5F}#qroot label{font-size:13px;color:#64748B}#qroot input,#qroot textarea{width:100%;min-height:44px;border:1px solid #CBD5E1;border-radius:10px;padding:0 12px;font:inherit;font-size:16px;background:#fff}#qroot textarea{padding:10px 12px;min-height:70px}#qroot .row{display:flex;gap:8px;align-items:center}#qroot .row input{text-align:right}#qroot .chips{display:flex;flex-wrap:wrap;gap:8px}#qroot .chip{min-height:44px;padding:0 14px;border-radius:22px;border:1px solid #CBD5E1;background:#fff;color:#334155;font:inherit;font-size:14px}#qroot .chip.on{background:#1F3A5F;border:2px solid #1F3A5F;color:#fff}#qroot .btn{min-height:50px;border:0;border-radius:12px;background:#1F3A5F;color:#fff;font:inherit;font-size:16px;font-weight:700;width:100%}#qroot .btn:disabled{background:#94A3B8}#qroot .btn.sec{background:#fff;color:#1F3A5F;border:2px solid #1F3A5F}#qroot .btn.sm{min-height:44px;font-size:14px;width:auto;padding:0 14px}#qroot .muted{color:#64748B;font-size:13px;line-height:1.6}#qroot .sp{display:flex;justify-content:space-between;align-items:baseline;gap:10px}#qroot .big{font-size:30px;font-weight:700;color:#1F3A5F}#qroot .box{background:#F8FAFC;border-radius:10px;padding:12px;font-size:13px;line-height:1.7;color:#334155}#qroot .scroll{max-height:200px;overflow:auto;border:1px solid #E2E8F0;border-radius:10px;padding:12px;font-size:13px;line-height:1.8;color:#334155}#qroot .pill{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700}#qroot .p0{background:#FEF3C7;color:#92400E}#qroot .p1{background:#DCFCE7;color:#166534}#qroot .p2{background:#E2E8F0;color:#475569}#qroot canvas{width:100%;height:150px;border:2px dashed #94A3B8;border-radius:10px;background:#fff;touch-action:none}#qroot .hint{font-size:12px;color:#B45309}#qroot .card{border:1px solid #E2E8F0;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px}#qroot .hide{display:none!important}#qroot .tight{gap:8px}#qroot input.fl{width:64px!important;flex:none;text-align:center}#qroot .row2{display:flex;gap:8px}#qroot .row2>*{flex:1;min-width:0}#qroot select{min-height:44px;border:1px solid #CBD5E1;border-radius:10px;font:inherit;font-size:16px;padding:0 8px;background:#fff}#qroot .tight .row{gap:6px}#qroot .tight .chip{min-height:38px;padding:0 12px}'; document.head.appendChild(style);
  renderApp();
  return { refresh: function(){ loadDefs(); if(screen==='list') renderApp(); } };
}
