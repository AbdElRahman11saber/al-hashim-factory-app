/*************************************************
 * مخزن ورشة آل هاشم — Apps Script backend
 * هذا الملف هو الواجهة البرمجية (API) بين موقع/تطبيق المخزن
 * وبين شيت جوجل اللي شغال كقاعدة بيانات سحابية.
 * v2 (2026-11-19): صور الأصناف — الصور بتترفع إلى Google Drive
 * ورابط الصورة بيتخزن في عمود «صورة» (P) في تبويب الأصناف.
 *
 * طريقة التركيب: افتح الشيت > الإضافات Extensions > Apps Script
 * امسح الكود الافتراضي والصق هذا الملف كاملاً، ثم غيّر SECRET
 * تحت لكلمة سر قوية، ثم Deploy > New deployment > Web app
 * Execute as: Me — Who has access: Anyone — Deploy.
 *
 * ⚠ مهم جداً: لا تغيّر أسماء التبويبات ولا ترتيب الأعمدة في الشيت،
 * ولا تستخدم حذف صفوف (Delete row) من الشيت أبداً.
 *************************************************/

// ============================================================
// ⚠ غيّر كلمة السر دي قبل النشر! لازم تبقى كلمة سر قوية ومحدش
// يعرفها غيرك انت والشخص التاني. وهي دي اللي هتكتبها في التطبيق.
// CHANGE THE SECRET BEFORE DEPLOYING! This is the app password.
// ============================================================
var SECRET = 'CHANGE_ME';

// معرّف الشيت (قاعدة البيانات) — جاهز، لا تغيّره.
var SPREADSHEET_ID = '1hhgCEJTPBpobs6BGwaMjzRfqF2l3nlFQyqzNFiHVtgo';

// أسماء التبويبات — لازم تطابق الشيت بالظبط.
var SHEETS = {
  items: 'الأصناف',
  merchants: 'التجار',
  supplies: 'توريدات التجار',
  payments: 'مدفوعات التجار',
  vips: 'العملاء المميزين',
  orders: 'الأوردرات',
  lines: 'بنود الأوردرات',
  settings: 'الإعدادات'
};

// أقصى عدد صفوف بيانات في كل تبويب (الصفوف من 2 لحد الرقم + 1).
var MAXROWS = { items: 2000, merchants: 500, supplies: 5000, payments: 5000, vips: 500, orders: 5000, lines: 5000 };

// مجلد صور الأصناف في Drive — بيتعمل لوحده أول مرة ترفع صورة.
var PHOTO_FOLDER = 'صور أصناف ورشة آل هاشم';

var STATUSES = ['جديد', 'تم الشحن', 'تم الاستلام', 'تم الصرف', 'مرتجع', 'ملغي'];
var METHODS = ['كاش / نقدي', 'تحويل', 'محفظة إلكترونية', 'آجل'];

/* ===================== نقطة الدخول (JSONP) ===================== */

function doGet(e) {
  var cb = (e && e.parameter && e.parameter.callback) || '';
  try {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(cb)) cb = '';
    var p = (e && e.parameter) || {};
    if (p.secret !== SECRET) throw new Error('كلمة السر غير صحيحة. تأكد من السر المكتوب في التطبيق.');
    var action = String(p.action || '');
    var payload = {};
    if (p.payload) {
      try { payload = JSON.parse(p.payload); }
      catch (err) { throw new Error('بيانات الطلب مش مفهومة.'); }
    }
    var result = dispatch_(action, payload);
    return jsonp_(cb, result);
  } catch (err) {
    return jsonp_(cb, { ok: false, error: String((err && err.message) || err) });
  }
}

function jsonp_(cb, obj) {
  var body = JSON.stringify(obj);
  if (cb) body = cb + '(' + body + ');';
  return ContentService.createTextOutput(body)
    .setMimeType(cb ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

/* نقطة الدخول للـ POST (رفع الصور): التطبيق بيبعت POST نصي من غير preflight،
 * والرد JSON عادي. نفس فحص كلمة السر ونفس dispatch_ بتاع doGet. */
function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) throw new Error('كلمة السر غير صحيحة. تأكد من السر المكتوب في التطبيق.');
    var result = dispatch_(String(body.action || ''), body.payload || {});
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String((err && err.message) || err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function dispatch_(action, payload) {
  switch (action) {
    case 'ping': return { ok: true, message: 'متصل', time: new Date().toISOString() };
    case 'read': return readAll_();
    case 'addItem': return withLock_(function () { return addItem_(payload); });
    case 'updateItem': return withLock_(function () { return updateItem_(payload); });
    case 'deleteItem': return withLock_(function () { return deleteItem_(payload); });
    case 'addMerchant': return withLock_(function () { return addMerchant_(payload); });
    case 'updateMerchant': return withLock_(function () { return updateMerchant_(payload); });
    case 'deleteMerchant': return withLock_(function () { return deleteMerchant_(payload); });
    case 'addSupply': return withLock_(function () { return addSupply_(payload); });
    case 'deleteSupply': return withLock_(function () { return deleteSupply_(payload); });
    case 'addPayment': return withLock_(function () { return addPayment_(payload); });
    case 'deletePayment': return withLock_(function () { return deletePayment_(payload); });
    case 'addVip': return withLock_(function () { return addVip_(payload); });
    case 'updateVip': return withLock_(function () { return updateVip_(payload); });
    case 'deleteVip': return withLock_(function () { return deleteVip_(payload); });
    case 'createOrder': return withLock_(function () { return createOrder_(payload); });
    case 'updateOrder': return withLock_(function () { return updateOrder_(payload); });
    case 'setOrderStatus': return withLock_(function () { return setOrderStatus_(payload); });
    case 'addLine': return withLock_(function () { return addLine_(payload); });
    case 'deleteLine': return withLock_(function () { return deleteLine_(payload); });
    case 'updateSettings': return withLock_(function () { return updateSettings_(payload); });
    case 'uploadImage': return withLock_(function () { return uploadImage_(payload); });
    default: throw new Error('إجراء غير معروف: ' + action);
  }
}

/* ===================== أدوات مساعدة ===================== */

function ss_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function sh_(key) { return ss_().getSheetByName(SHEETS[key]); }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

function isBlank_(v) { return v === '' || v === null || v === undefined; }
function s_(v) { return isBlank_(v) ? '' : String(v).trim(); }
function n_(v, def) {
  if (isBlank_(v)) return (def === undefined ? 0 : def);
  var x = Number(String(v).replace(/,/g, ''));
  return isNaN(x) ? (def === undefined ? 0 : def) : x;
}
function req_(v, msg) { if (isBlank_(v) || String(v).trim() === '') throw new Error(msg); return String(v).trim(); }

function tz_() { return ss_().getSpreadsheetTimeZone() || 'Africa/Cairo'; }

function normDate_(v) {
  if (isBlank_(v)) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  }
  var t = String(v).trim();
  var m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  var d = new Date(t);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
  return t;
}

function parseDate_(str, fieldName) {
  var t = s_(str);
  if (!t) return null;
  var m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error('تاريخ غير صحيح في: ' + (fieldName || 'التاريخ'));
  // الساعة 12 ظهراً عشان فرق التوقيت ما يغيّرش اليوم.
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}

function todayStr_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }

/**
 * أول صف فاضي في عمود المفتاح (من الصف 2).
 * لا نستخدم getLastRow ولا appendRow أبداً لأن أعمدة المعادلات
 * فيها ARRAYFORMULA ولو اتحذف صف أو اتضاف في الآخر هيتكسر الحساب.
 */
function findEmptyRow_(sh, keyCol, maxRows) {
  var vals = sh.getRange(2, keyCol, maxRows, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (isBlank_(vals[i][0])) return i + 2;
  }
  throw new Error('مفيش صفوف فاضية في التبويب ده، كلم الدعم الفني.');
}

/** آخر صف فيه بيانات (حسب عمود المفتاح) — عشان القراءة تبقى على قد البيانات بس. */
function lastDataRow_(sh, keyCol, maxRows) {
  var vals = sh.getRange(2, keyCol, maxRows, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (!isBlank_(vals[i][0])) return i + 2;
  }
  return 1;
}

function validRow_(row, maxRows, label) {
  var r = Math.floor(n_(row, 0));
  if (r < 2 || r > maxRows + 1) throw new Error('رقم صف غير صحيح (' + (label || 'سجل') + ').');
  return r;
}

function vipNameSet_() {
  var sh = sh_('vips');
  var last = lastDataRow_(sh, 2, MAXROWS.vips);
  var set = {};
  if (last < 2) return set;
  var vals = sh.getRange(2, 2, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    var nm = s_(vals[i][0]);
    if (nm) set[nm] = true;
  }
  return set;
}

/* ===== معادلات الاسترجاع — مطابقة بالظبط للي في build.py (step_formulas_v2) ===== */

function orderPhoneFormula_(row, vipCol) {
  return '=IF($C' + row + '="","",IFERROR(VLOOKUP(TRIM($C' + row + '),\'العملاء المميزين\'!$B$2:$E$501,' + vipCol + ',FALSE),""))';
}
function orderFormulas_(row) {
  return { d: orderPhoneFormula_(row, 2), e: orderPhoneFormula_(row, 3), f: orderPhoneFormula_(row, 4) };
}
function linePriceFormula_(row) {
  return '=IF($B' + row + '="","",IFERROR(VLOOKUP($B' + row + ',\'الأصناف\'!$D$2:$E$2001,2,FALSE),""))';
}

/** استرجاع معادلات D/E/F للأوردر (لما العميل يبقى VIP). */
function restoreOrderContactFormulas_(sh, row) {
  var f = orderFormulas_(row);
  sh.getRange(row, 4).setFormula(f.d); // D هاتف 1
  sh.getRange(row, 5).setFormula(f.e); // E هاتف 2
  sh.getRange(row, 6).setFormula(f.f); // F العنوان
}

/* ===================== القراءة ===================== */

function readTab_(key, keyCol, ncols, mapFn) {
  var sh = sh_(key);
  var last = lastDataRow_(sh, keyCol, MAXROWS[key]);
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, ncols).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (isBlank_(r[keyCol - 1])) continue;
    var obj = mapFn(r);
    obj._row = i + 2;
    out.push(obj);
  }
  return out;
}

function readAll_() {
  var items = readTab_('items', 2, 16, function (r) {
    return { num: n_(r[0]), model: s_(r[1]), color: s_(r[2]), name: s_(r[3]),
      // price = سعر الزوج (col E, entered). pairPrice = سعر الدستة (col F = E×B9) since the 2026-11-18 price-model fix; field name kept for compatibility — do not rename without redeploying.
      price: n_(r[4]), pairPrice: n_(r[5]), openingDoz: n_(r[6]), openingPairs: n_(r[7]),
      supplied: n_(r[8]), out: n_(r[9]), stock: n_(r[10]), stockDoz: n_(r[11]),
      value: n_(r[12]), status: s_(r[13]), notes: s_(r[14]), photo: s_(r[15]) };
  });
  var merchants = readTab_('merchants', 2, 12, function (r) {
    return { num: n_(r[0]), name: s_(r[1]), phone1: s_(r[2]), phone2: s_(r[3]), address: s_(r[4]),
      supPairs: n_(r[5]), supDoz: n_(r[6]), supValue: n_(r[7]), paid: n_(r[8]),
      remaining: n_(r[9]), supCount: n_(r[10]), notes: s_(r[11]) };
  });
  var supplies = readTab_('supplies', 2, 8, function (r) {
    return { date: normDate_(r[0]), merchant: s_(r[1]), item: s_(r[2]), dozens: n_(r[3]),
      pairs: n_(r[4]), buyPrice: n_(r[5]), total: n_(r[6]), notes: s_(r[7]) };
  });
  var payments = readTab_('payments', 2, 5, function (r) {
    return { date: normDate_(r[0]), merchant: s_(r[1]), amount: n_(r[2]), method: s_(r[3]), notes: s_(r[4]) };
  });
  var vips = readTab_('vips', 2, 9, function (r) {
    return { num: n_(r[0]), name: s_(r[1]), phone1: s_(r[2]), phone2: s_(r[3]), address: s_(r[4]),
      notes: s_(r[5]), orderCount: n_(r[6]), totalPurchases: n_(r[7]), lastOrder: normDate_(r[8]) };
  });
  var orders = readTab_('orders', 3, 19, function (r) {
    return { no: n_(r[0]), date: normDate_(r[1]), customer: s_(r[2]), phone1: s_(r[3]),
      phone2: s_(r[4]), address: s_(r[5]), status: s_(r[6]), method: s_(r[7]),
      shipping: n_(r[8]), discount: n_(r[9]), deposit: n_(r[10]), subtotal: n_(r[11]),
      total: n_(r[12]), remaining: n_(r[13]), pairs: n_(r[14]), disbStatus: s_(r[15]),
      notes: s_(r[16]), counts: s_(r[17]), isVip: s_(r[18]) };
  });
  var lines = readTab_('lines', 1, 9, function (r) {
    return { orderNo: n_(r[0]), item: s_(r[1]), dozens: n_(r[2]), pairs: n_(r[3]),
      price: n_(r[4]), discount: n_(r[5]), total: n_(r[6]), deducts: s_(r[7]), notes: s_(r[8]) };
  });
  var setSh = sh_('settings');
  var bv = setSh.getRange('B2:B10').getValues();
  var settings = {
    factoryName: s_(bv[0][0]), address: s_(bv[1][0]), phone1: s_(bv[2][0]), phone2: s_(bv[3][0]),
    note1: s_(bv[4][0]), note2: s_(bv[5][0]), note3: s_(bv[6][0]),
    pairsPerDozen: n_(bv[7][0], 10), threshold: n_(bv[8][0], 20)
  };
  var pv = setSh.getRange('D2:D20').getValues();
  var presets = [];
  for (var i = 0; i < pv.length; i++) {
    var x = Number(pv[i][0]);
    if (!isBlank_(pv[i][0]) && !isNaN(x) && x > 0) presets.push(x);
  }
  if (!presets.length) presets = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12];
  return { ok: true, items: items, merchants: merchants, supplies: supplies, payments: payments,
    vips: vips, orders: orders, lines: lines, settings: settings, presets: presets, serverTime: new Date().toISOString() };
}

/* ===================== الأصناف ===================== */

function writeItemRow_(sh, row, p) {
  var model = req_(p.model, 'اكتب اسم الموديل.');
  var color = req_(p.color, 'اكتب اللون.');
  var price = n_(p.price, NaN);
  if (isNaN(price) || price < 0) throw new Error('سعر بيع الدستة غير صحيح.');
  var opening = p.openingDoz === '' || p.openingDoz === null || p.openingDoz === undefined ? '' : n_(p.openingDoz);
  sh.getRange(row, 2).setValue(model);                    // B الموديل
  sh.getRange(row, 3).setValue(color);                    // C اللون
  sh.getRange(row, 5).setValue(price);                    // E سعر بيع الدستة
  sh.getRange(row, 7).setValue(opening);                  // G رصيد افتتاحي (دستة)
  sh.getRange(row, 15).setValue(s_(p.notes));             // O ملاحظات
  return { row: row, name: (model + ' ' + color).trim() };
}

function addItem_(p) {
  var sh = sh_('items');
  var row = findEmptyRow_(sh, 2, MAXROWS.items);
  var r = writeItemRow_(sh, row, p);
  SpreadsheetApp.flush();
  return { ok: true, row: r.row, name: r.name };
}

function updateItem_(p) {
  var sh = sh_('items');
  var row = validRow_(p.row, MAXROWS.items, 'الصنف');
  var r = writeItemRow_(sh, row, p);
  SpreadsheetApp.flush();
  return { ok: true, row: r.row, name: r.name };
}

function deleteItem_(p) {
  var sh = sh_('items');
  var row = validRow_(p.row, MAXROWS.items, 'الصنف');
  trashPhoto_(sh.getRange(row, 16).getValue()); // امسح صورة الصنف من Drive لو موجودة
  // مسح خلايا الإدخال بس — أعمدة المعادلات (ARRAYFORMULA) محدش يلمسها.
  [2, 3, 5, 7, 15, 16].forEach(function (c) { sh.getRange(row, c).setValue(''); });
  SpreadsheetApp.flush();
  return { ok: true, row: row };
}

/* امسح ملف صورة من Drive (من رابط thumbnail اللي متخزن) — لو مش موجود أو اتمسح قبل كده، عدّي من غير ما توقف الحذف. */
function trashPhoto_(url) {
  try {
    var m = String(url || '').match(/id=([A-Za-z0-9_-]+)/);
    if (m) DriveApp.getFileById(m[1]).setTrashed(true);
  } catch (e) {}
}

/* رفع صورة صنف: التطبيق بيبعت الصورة (data URL بعد تصغيرها على الموبايل).
 * بتتحفظ في مجلد Drive «صور أصناف ورشة آل هاشم» بمشاركة «أي حد معاه اللينك»،
 * ورابط الصورة بيتخزن في عمود P (صورة) في صف الصنف. data فاضية = مسح الصورة. */
function uploadImage_(p) {
  var sh = sh_('items');
  var row = validRow_(p.row, MAXROWS.items, 'الصنف');
  var data = String(p.data || '');
  if (!data) {
    sh.getRange(row, 16).setValue('');
    SpreadsheetApp.flush();
    return { ok: true, row: row, url: '' };
  }
  var m = data.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
  if (!m) throw new Error('صيغة الصورة مش مدعومة.');
  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 300 * 1024) throw new Error('الصورة كبيرة أوي — جرّب صورة أصغر.');
  var folders = DriveApp.getFoldersByName(PHOTO_FOLDER);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(PHOTO_FOLDER);
  var blob = Utilities.newBlob(bytes, m[1], 'item-' + row + '-' + Date.now() + '.jpg');
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w400';
  sh.getRange(row, 16).setValue(url);
  SpreadsheetApp.flush();
  return { ok: true, row: row, url: url };
}

/* ===================== التجار ===================== */

function writeMerchantRow_(sh, row, p) {
  var name = req_(p.name, 'اكتب اسم التاجر.');
  sh.getRange(row, 2).setValue(name);                     // B الاسم
  sh.getRange(row, 3).setValue(s_(p.phone1));             // C هاتف 1 (نص — الصفر الأول محفوظ)
  sh.getRange(row, 4).setValue(s_(p.phone2));             // D هاتف 2
  sh.getRange(row, 5).setValue(s_(p.address));            // E العنوان
  sh.getRange(row, 12).setValue(s_(p.notes));             // L ملاحظات
  return name;
}

function addMerchant_(p) {
  var sh = sh_('merchants');
  var row = findEmptyRow_(sh, 2, MAXROWS.merchants);
  var name = writeMerchantRow_(sh, row, p);
  SpreadsheetApp.flush();
  return { ok: true, row: row, name: name };
}

function updateMerchant_(p) {
  var sh = sh_('merchants');
  var row = validRow_(p.row, MAXROWS.merchants, 'التاجر');
  var name = writeMerchantRow_(sh, row, p);
  SpreadsheetApp.flush();
  return { ok: true, row: row, name: name };
}

function deleteMerchant_(p) {
  var sh = sh_('merchants');
  var row = validRow_(p.row, MAXROWS.merchants, 'التاجر');
  [2, 3, 4, 5, 12].forEach(function (c) { sh.getRange(row, c).setValue(''); });
  SpreadsheetApp.flush();
  return { ok: true, row: row };
}

/* ===================== توريدات ومدفوعات التجار ===================== */

function addSupply_(p) {
  var sh = sh_('supplies');
  var merchant = req_(p.merchant, 'اختار التاجر.');
  var item = req_(p.item, 'اختار الصنف.');
  var dozens = n_(p.dozens, NaN);
  if (isNaN(dozens) || dozens <= 0) throw new Error('الكمية بالدستة لازم تكون أكبر من صفر.');
  var buyPrice = n_(p.buyPrice, NaN);
  if (isNaN(buyPrice) || buyPrice < 0) throw new Error('سعر شراء الدستة غير صحيح.');
  var date = parseDate_(s_(p.date) || todayStr_(), 'التاريخ');
  var row = findEmptyRow_(sh, 2, MAXROWS.supplies);
  sh.getRange(row, 1).setValue(date);                     // A التاريخ
  sh.getRange(row, 2).setValue(merchant);                 // B التاجر
  sh.getRange(row, 3).setValue(item);                     // C الصنف
  sh.getRange(row, 4).setValue(dozens);                   // D الكمية (دستة)
  sh.getRange(row, 6).setValue(buyPrice);                 // F سعر شراء الدستة
  sh.getRange(row, 8).setValue(s_(p.notes));              // H ملاحظات
  SpreadsheetApp.flush();
  return { ok: true, row: row };
}

function deleteSupply_(p) {
  var sh = sh_('supplies');
  var row = validRow_(p.row, MAXROWS.supplies, 'التوريد');
  [1, 2, 3, 4, 6, 8].forEach(function (c) { sh.getRange(row, c).setValue(''); });
  SpreadsheetApp.flush();
  return { ok: true, row: row };
}

function addPayment_(p) {
  var sh = sh_('payments');
  var merchant = req_(p.merchant, 'اختار التاجر.');
  var amount = n_(p.amount, NaN);
  if (isNaN(amount) || amount <= 0) throw new Error('المبلغ لازم يكون أكبر من صفر.');
  var method = s_(p.method);
  if (method && METHODS.indexOf(method) === -1) throw new Error('طريقة دفع غير صحيحة.');
  var date = parseDate_(s_(p.date) || todayStr_(), 'التاريخ');
  var row = findEmptyRow_(sh, 2, MAXROWS.payments);
  sh.getRange(row, 1).setValue(date);                     // A التاريخ
  sh.getRange(row, 2).setValue(merchant);                 // B التاجر
  sh.getRange(row, 3).setValue(amount);                   // C المبلغ
  sh.getRange(row, 4).setValue(method);                   // D طريقة الدفع
  sh.getRange(row, 5).setValue(s_(p.notes));              // E ملاحظات
  SpreadsheetApp.flush();
  return { ok: true, row: row };
}

function deletePayment_(p) {
  var sh = sh_('payments');
  var row = validRow_(p.row, MAXROWS.payments, 'الدفعة');
  [1, 2, 3, 4, 5].forEach(function (c) { sh.getRange(row, c).setValue(''); });
  SpreadsheetApp.flush();
  return { ok: true, row: row };
}

/* ===================== العملاء المميزين ===================== */

function writeVipRow_(sh, row, p) {
  var name = req_(p.name, 'اكتب اسم العميل.');
  sh.getRange(row, 2).setValue(name);                     // B الاسم
  sh.getRange(row, 3).setValue(s_(p.phone1));             // C هاتف 1
  sh.getRange(row, 4).setValue(s_(p.phone2));             // D هاتف 2
  sh.getRange(row, 5).setValue(s_(p.address));            // E العنوان
  sh.getRange(row, 6).setValue(s_(p.notes));              // F ملاحظات
  return name;
}

function addVip_(p) {
  var sh = sh_('vips');
  var row = findEmptyRow_(sh, 2, MAXROWS.vips);
  var name = writeVipRow_(sh, row, p);
  SpreadsheetApp.flush();
  return { ok: true, row: row, name: name };
}

function updateVip_(p) {
  var sh = sh_('vips');
  var row = validRow_(p.row, MAXROWS.vips, 'العميل المميز');
  var name = writeVipRow_(sh, row, p);
  SpreadsheetApp.flush();
  return { ok: true, row: row, name: name };
}

function deleteVip_(p) {
  var sh = sh_('vips');
  var row = validRow_(p.row, MAXROWS.vips, 'العميل المميز');
  [2, 3, 4, 5, 6].forEach(function (c) { sh.getRange(row, c).setValue(''); });
  SpreadsheetApp.flush();
  return { ok: true, row: row };
}

/* ===================== الأوردرات والبنود ===================== */

/**
 * كتابة بيانات الأوردر في صف.
 * قاعدة الـ VIP: لو العميل مميز، بنرجّع معادلات D/E/F الأصلية
 * (نفس المعادلات اللي في الشيت) فبياناته بتتملا لوحدها.
 * لو مش مميز، بنكتب التليفونات والعنوان اللي جايين من التطبيق.
 */
function writeOrderHeader_(sh, row, h, vipSet) {
  var customer = req_(h.customer, 'اكتب اسم العميل.');
  var status = s_(h.status) || 'جديد';
  if (STATUSES.indexOf(status) === -1) throw new Error('حالة أوردر غير صحيحة.');
  var method = s_(h.method);
  if (method && METHODS.indexOf(method) === -1) throw new Error('طريقة دفع غير صحيحة.');
  var date = parseDate_(s_(h.date) || todayStr_(), 'التاريخ');
  sh.getRange(row, 2).setValue(date);                     // B التاريخ
  sh.getRange(row, 3).setValue(customer);                 // C اسم العميل
  sh.getRange(row, 7).setValue(status);                   // G الحالة
  sh.getRange(row, 8).setValue(method);                   // H طريقة الدفع
  sh.getRange(row, 9).setValue(moneyOrBlank_(h.shipping));   // I الشحن
  sh.getRange(row, 10).setValue(moneyOrBlank_(h.discount));  // J الخصم العام
  sh.getRange(row, 11).setValue(moneyOrBlank_(h.deposit));   // K العربون
  sh.getRange(row, 17).setValue(s_(h.notes));             // Q ملاحظات
  var isVip = !!vipSet[customer];
  if (isVip) {
    restoreOrderContactFormulas_(sh, row);
  } else {
    if (h.phone1 !== undefined) sh.getRange(row, 4).setValue(s_(h.phone1)); // D
    if (h.phone2 !== undefined) sh.getRange(row, 5).setValue(s_(h.phone2)); // E
    if (h.address !== undefined) sh.getRange(row, 6).setValue(s_(h.address)); // F
  }
  return isVip;
}

function moneyOrBlank_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var x = n_(v, NaN);
  if (isNaN(x) || x < 0) throw new Error('مبلغ غير صحيح.');
  return x;
}

function validateLine_(ln) {
  var item = req_(ln.item, 'اختار الصنف في كل بند.');
  var dozens = n_(ln.dozens, NaN);
  if (isNaN(dozens) || dozens <= 0) throw new Error('كمية البند بالدستة لازم تكون أكبر من صفر.');
  var discount = n_(ln.discount, 0);
  if (discount < 0) throw new Error('خصم البند مينفعش يبقى سالب.');
  var customPrice = null;
  if (ln.customPrice !== '' && ln.customPrice !== null && ln.customPrice !== undefined) {
    customPrice = n_(ln.customPrice, NaN);
    if (isNaN(customPrice) || customPrice < 0) throw new Error('سعر البند غير صحيح.');
  }
  return { item: item, dozens: dozens, discount: discount, customPrice: customPrice, notes: s_(ln.notes) };
}

function writeLineRow_(sh, row, orderNo, ln) {
  sh.getRange(row, 1).setValue(orderNo);                  // A رقم الأوردر
  sh.getRange(row, 2).setValue(ln.item);                  // B الصنف
  sh.getRange(row, 3).setValue(ln.dozens);                // C الكمية (دستة)
  sh.getRange(row, 6).setValue(ln.discount ? ln.discount : ''); // F خصم البند
  sh.getRange(row, 9).setValue(ln.notes);                 // I ملاحظات
  // E: سعر الدستة — لو مفيش سعر مخصوص، بنرجّع المعادلة الأصلية
  // اللي بتجيب السعر من تبويب الأصناف لوحدها.
  if (ln.customPrice !== null) sh.getRange(row, 5).setValue(ln.customPrice);
  else sh.getRange(row, 5).setFormula(linePriceFormula_(row));
}

function createOrder_(p) {
  var h = p.header || {};
  var rawLines = p.lines || [];
  if (!rawLines.length) throw new Error('الأوردر لازم يكون فيه بند واحد على الأقل.');
  var lines = rawLines.map(validateLine_);
  var vipSet = vipNameSet_();
  var oSh = sh_('orders');
  var row = findEmptyRow_(oSh, 3, MAXROWS.orders);
  var isVip = writeOrderHeader_(oSh, row, h, vipSet);
  var orderNo = row - 1; // رقم الأوردر = رقم الصف - 1 (زي معادلة العمود A في الشيت)
  var lSh = sh_('lines');
  var lineRows = [];
  for (var i = 0; i < lines.length; i++) {
    var lrow = findEmptyRow_(lSh, 1, MAXROWS.lines);
    writeLineRow_(lSh, lrow, orderNo, lines[i]);
    lineRows.push(lrow);
  }
  SpreadsheetApp.flush();
  return { ok: true, orderNo: orderNo, row: row, lineRows: lineRows, isVip: isVip };
}

function updateOrder_(p) {
  var oSh = sh_('orders');
  var row = validRow_(p.row, MAXROWS.orders, 'الأوردر');
  var h = p.header || {};
  var vipSet = vipNameSet_();
  var isVip = writeOrderHeader_(oSh, row, h, vipSet);
  SpreadsheetApp.flush();
  return { ok: true, row: row, orderNo: row - 1, isVip: isVip };
}

function setOrderStatus_(p) {
  var oSh = sh_('orders');
  var row = validRow_(p.row, MAXROWS.orders, 'الأوردر');
  var status = s_(p.status);
  if (STATUSES.indexOf(status) === -1) throw new Error('حالة أوردر غير صحيحة.');
  oSh.getRange(row, 7).setValue(status);                  // G الحالة
  SpreadsheetApp.flush();
  return { ok: true, row: row, orderNo: row - 1, status: status };
}

function addLine_(p) {
  var orderNo = Math.floor(n_(p.orderNo, 0));
  if (orderNo < 1) throw new Error('رقم أوردر غير صحيح.');
  var oSh = sh_('orders');
  var cust = s_(oSh.getRange(orderNo + 1, 3).getValue());
  if (!cust) throw new Error('الأوردر ده مش موجود.');
  var ln = validateLine_(p);
  var lSh = sh_('lines');
  var row = findEmptyRow_(lSh, 1, MAXROWS.lines);
  writeLineRow_(lSh, row, orderNo, ln);
  SpreadsheetApp.flush();
  return { ok: true, row: row, orderNo: orderNo };
}

function deleteLine_(p) {
  var lSh = sh_('lines');
  var row = validRow_(p.row, MAXROWS.lines, 'البند');
  // مسح خلايا الإدخال بس + استرجاع معادلة السعر في E.
  [1, 2, 3, 6, 9].forEach(function (c) { lSh.getRange(row, c).setValue(''); });
  lSh.getRange(row, 5).setFormula(linePriceFormula_(row));
  SpreadsheetApp.flush();
  return { ok: true, row: row };
}

/* ===================== الإعدادات ===================== */

function updateSettings_(p) {
  var sh = sh_('settings');
  var name = req_(p.factoryName, 'اكتب اسم المصنع.');
  var threshold = n_(p.threshold, NaN);
  if (isNaN(threshold) || threshold < 0) throw new Error('حد تنبيه المخزون غير صحيح.');
  sh.getRange('B2').setValue(name);                       // B2 اسم المصنع
  sh.getRange('B3').setValue(s_(p.address));              // B3 العنوان
  sh.getRange('B4').setValue(s_(p.phone1));               // B4 هاتف 1
  sh.getRange('B5').setValue(s_(p.phone2));               // B5 هاتف 2
  sh.getRange('B6').setValue(s_(p.note1));                // B6 ملاحظة الفاتورة 1
  sh.getRange('B7').setValue(s_(p.note2));                // B7 ملاحظة الفاتورة 2
  sh.getRange('B8').setValue(s_(p.note3));                // B8 ملاحظة الفاتورة 3
  // B9 (عدد الأزواج في الدستة = 10) لا تتغيّر أبداً — لا نلمسها هنا.
  sh.getRange('B10').setValue(threshold);                 // B10 حد تنبيه المخزون
  SpreadsheetApp.flush();
  return { ok: true };
}

/* اختبار صلاحية Drive — شغّلها من المحرر مرة واحدة للموافقة على صلاحية Drive. */
function testDriveAuth() {
  return DriveApp.getFoldersByName(PHOTO_FOLDER).hasNext();
}

/* اختبار الكتابة على Drive — شغّلها من المحرر مرة واحدة للموافقة على صلاحية الكتابة على Drive. */
function testDriveWrite() {
  var f = DriveApp.getFoldersByName(PHOTO_FOLDER);
  var folder = f.hasNext() ? f.next() : DriveApp.createFolder(PHOTO_FOLDER);
  return folder.getId();
}
