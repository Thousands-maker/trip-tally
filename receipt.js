/* Trip Tally — reading receipts on the device.
   - OCR: tesseract.js, downloaded once from a CDN then cached for offline use. Images never leave the phone.
   - Parsing: total, currency, date/time, merchant, line items, category.
   - Photo metadata: GPS position and time taken (EXIF). */
'use strict';

const OCR_LANGS = { eng: 'English', jpn: 'Japanese', chi_sim: 'Chinese (Simplified)', chi_tra: 'Chinese (Traditional)', kor: 'Korean', tha: 'Thai', vie: 'Vietnamese', ind: 'Malay / Indonesian' };
const OCR_LIB = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

/* ---------- currency / language hints from the phone's time zone ---------- */
const TZ_CUR = {
  'Asia/Singapore': 'SGD', 'Asia/Tokyo': 'JPY', 'Asia/Seoul': 'KRW', 'Asia/Bangkok': 'THB', 'Asia/Kuala_Lumpur': 'MYR', 'Asia/Kuching': 'MYR',
  'Asia/Jakarta': 'IDR', 'Asia/Makassar': 'IDR', 'Asia/Jayapura': 'IDR', 'Asia/Manila': 'PHP', 'Asia/Ho_Chi_Minh': 'VND', 'Asia/Saigon': 'VND',
  'Asia/Hong_Kong': 'HKD', 'Asia/Macau': 'MOP', 'Asia/Taipei': 'TWD', 'Asia/Shanghai': 'CNY', 'Asia/Chongqing': 'CNY', 'Asia/Urumqi': 'CNY',
  'Asia/Kolkata': 'INR', 'Asia/Calcutta': 'INR', 'Asia/Dubai': 'AED', 'Asia/Phnom_Penh': 'KHR', 'Asia/Yangon': 'MMK', 'Asia/Colombo': 'LKR',
  'Asia/Kathmandu': 'NPR', 'Asia/Brunei': 'BND', 'Australia/Sydney': 'AUD', 'Australia/Melbourne': 'AUD', 'Australia/Brisbane': 'AUD',
  'Australia/Perth': 'AUD', 'Australia/Adelaide': 'AUD', 'Pacific/Auckland': 'NZD', 'Europe/London': 'GBP', 'Europe/Zurich': 'CHF',
  'Europe/Istanbul': 'TRY', 'Europe/Prague': 'CZK', 'Europe/Budapest': 'HUF', 'Europe/Warsaw': 'PLN', 'Europe/Copenhagen': 'DKK',
  'Europe/Stockholm': 'SEK', 'Europe/Oslo': 'NOK', 'America/Toronto': 'CAD', 'America/Vancouver': 'CAD', 'America/Mexico_City': 'MXN'
};
const EURO_TZ = /^Europe\/(Paris|Berlin|Madrid|Rome|Amsterdam|Brussels|Vienna|Lisbon|Dublin|Athens|Helsinki|Luxembourg|Monaco|Vatican|San_Marino|Ljubljana|Bratislava|Tallinn|Riga|Vilnius|Valletta|Zagreb|Andorra)$/;
function tzCurrency(tz = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (TZ_CUR[tz]) return TZ_CUR[tz];
  if (EURO_TZ.test(tz)) return 'EUR';
  if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit)|^Pacific\/Honolulu/.test(tz)) return 'USD';
  return null;
}
const CUR_LANG = { JPY: 'jpn', CNY: 'chi_sim', TWD: 'chi_tra', HKD: 'chi_tra', MOP: 'chi_tra', KRW: 'kor', THB: 'tha', VND: 'vie', IDR: 'ind', MYR: 'ind' };
function ocrLangsFor(currencies) {
  const set = ['eng'];
  for (const c of currencies) { const l = CUR_LANG[c]; if (l && !set.includes(l)) set.push(l); }
  return set.slice(0, 3);
}

/* ---------- OCR engine (lazy) ---------- */
let ocrLib = null, ocrWorker = null, ocrWorkerKey = '', ocrProgress = null;
function loadOcrLib() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return ocrLib || (ocrLib = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = OCR_LIB; s.async = true;
    s.onload = () => (window.Tesseract ? res(window.Tesseract) : rej(new Error('Receipt reader failed to load')));
    s.onerror = () => { ocrLib = null; s.remove(); rej(new Error('Receipt reader not downloaded yet — connect to the internet once to get it')); };
    document.head.appendChild(s);
  }));
}
async function ocrEngine(langs) {
  const key = langs.join('+');
  if (ocrWorker && ocrWorkerKey === key) return ocrWorker;
  const T = await loadOcrLib();
  if (ocrWorker) { try { await ocrWorker.terminate(); } catch (e) { /* ignore */ } ocrWorker = null; }
  ocrWorker = await T.createWorker(langs, 1, { logger: m => ocrProgress && ocrProgress(m), errorHandler: () => {} });
  // receipts are one column of "label ..... price" rows; block mode keeps each price on its own row
  await ocrWorker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  ocrWorkerKey = key;
  return ocrWorker;
}
async function prepForOcr(file) { // grayscale, sensible size; better accuracy and speed than the raw photo
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const long = Math.max(bmp.width, bmp.height), k = long > 2200 ? 2200 / long : long < 1000 ? 1000 / long : 1;
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const x = c.getContext('2d'); x.filter = 'grayscale(1) contrast(1.25)'; x.drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  } catch (e) { return file; }
}
async function ocrImage(file, langs, onProgress) {
  ocrProgress = onProgress;
  try {
    const w = await ocrEngine(langs);
    const { data } = await w.recognize(await prepForOcr(file));
    return data.text || '';
  } finally { ocrProgress = null; }
}

/* ---------- photo metadata (EXIF) ---------- */
async function readExif(file) {
  try {
    const v = new DataView(await file.slice(0, 512 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return null; // JPEG only
    let off = 2;
    while (off + 10 < v.byteLength) {
      const marker = v.getUint16(off), len = v.getUint16(off + 2);
      if ((marker & 0xFF00) !== 0xFF00) break;
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
      off += 2 + len;
    }
  } catch (e) { /* not readable */ }
  return null;
}
function parseTiff(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = o => v.getUint16(t + o, le), u32 = o => v.getUint32(t + o, le);
  const ifd = o => { const n = u16(o), out = {}; for (let i = 0; i < n; i++) { const e = o + 2 + i * 12; out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), off: e + 8 }; } return out; };
  const val = en => {
    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[en.type] || 1;
    const p = en.count * size > 4 ? u32(en.off) : en.off;
    if (en.type === 2) { let s = ''; for (let i = 0; i < en.count; i++) { const ch = v.getUint8(t + p + i); if (!ch) break; s += String.fromCharCode(ch); } return s; }
    if (en.type === 5) return Array.from({ length: en.count }, (_, i) => u32(p + i * 8) / (u32(p + i * 8 + 4) || 1));
    if (en.type === 3) return u16(p);
    if (en.type === 4) return u32(p);
    return null;
  };
  const out = {}, ifd0 = ifd(u32(4));
  let taken = null;
  if (ifd0[0x8769]) { const ex = ifd(val(ifd0[0x8769])); if (ex[0x9003]) taken = val(ex[0x9003]); }
  if (!taken && ifd0[0x0132]) taken = val(ifd0[0x0132]);
  const m = taken && taken.match(/(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/);
  if (m) { out.date = `${m[1]}-${m[2]}-${m[3]}`; out.time = `${m[4]}:${m[5]}`; }
  if (ifd0[0x8825]) {
    const gp = ifd(val(ifd0[0x8825]));
    if (gp[2] && gp[4]) {
      const dms = a => a[0] + (a[1] || 0) / 60 + (a[2] || 0) / 3600;
      let lat = dms(val(gp[2])), lon = dms(val(gp[4]));
      if (gp[1] && val(gp[1]) === 'S') lat = -lat;
      if (gp[3] && val(gp[3]) === 'W') lon = -lon;
      if (Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.gps = { lat, lon };
    }
  }
  return out;
}

/* ---------- parsing ---------- */
const ZERO_DEC = new Set(['JPY', 'KRW', 'VND', 'IDR', 'CLP', 'ISK', 'HUF', 'TWD', 'KHR', 'MMK']); // receipts rarely show decimals for these
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const RX = {
  sub: /sub\s*-?\s*tot|小\s*計|小\s*计|소\s*계|ยอด\s*ก่อน/i,
  excl: /chang|cash|tender|amount\s*paid|\bpaid\b|card|visa|master|amex|\bnets\b|paynow|grab\s*pay|alipay|wechat|apple\s*pay|google\s*pay|お\s*釣|釣\s*銭|お\s*預|預\s*り|現\s*金|クレジット|電子マネー|거스름|받은|เงินทอน|เงินสด|\bqty\b|quantity|no\.?\s*of\s*item|items?\s*:|points?|saving|you\s*saved|loyalty|\bbal(ance)?\b(?!\s*due)/i,
  adj: /\bgst\b|\bvat\b|\btax|service|\bsvc\b|s\/c|serv\.?\s*ch|\btip|gratuity|rounding|discount|\bdisc\b|\bsst\b|\bppn\b|消\s*費\s*税|内\s*税|外\s*税|税|サービス料|봉사료|부가세|ภาษี|ค่าบริการ|thuế|phí\s*dịch\s*vụ/i,
  meta: /\btel\b|phone\s*(no)?\.?\s*:?\s*[+(\d]|fax|www\.|http|\S+@\S+\.\w|receipt|invoice|\btable\b|\bpax\b|guest|cashier|server|\border\b|bill\s*no|\bchk\b|check\s*#|\bdate\b|\btime\b|reg\s*no|\buen\b|\babn\b|vat\s*no|gst\s*no|thank|welcome|terminal|\bauth|approval|\bref\b|trans|batch|\bpos\b|\bstaff\b|電\s*話|領\s*収|レシート|登録番号|伝票|担当|ありがとう|영수증|사업자|전화|ใบเสร็จ|โทร/i,
  total: [/grand\s*tot/i, /tot(al)?\s*(amount\s*)?(due|payable)/i, /amount\s*(due|payable)/i, /balance\s*due/i, /net+\s*tot/i, /tot(al)?\s*amount/i,
    /合\s*計/, /合\s*计/, /総\s*計/, /お\s*会\s*計/, /お\s*買\s*上/, /ご\s*請\s*求/, /합\s*계/, /총\s*액/, /결제\s*금액/, /ยอด\s*รวม\s*สุทธิ/, /ยอด\s*รวม/, /รวม\s*ทั้ง\s*สิ้น/,
    /jumlah/i, /t[oổ]ng\s*c[oộ]ng/i, /t[oổ]ng\s*ti[eề]n/i, /\btot(al|l)?\b/i, /รวม/, /\bamount\b/i]
};
// money at the end of a line: optional symbol/code, number, optional local suffix and US-style tax flag
const CODES = 'SGD|USD|EUR|GBP|JPY|CNY|RMB|HKD|MYR|THB|IDR|PHP|VND|KRW|TWD|NTD|AUD|NZD|INR|CHF|CAD|AED|MOP|KHR|BND';
const AMT = new RegExp(String.raw`(\(|-|−)?\s*(?:(?:${CODES})\s?|[$€£¥₩฿₫₱\\]|RM\s?|S\$|HK\$|NT\$|A\$|US\$|Rp\.?\s?)?\s*(\d{1,3}(?:[,.' ]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*\)?\s*(?:円|元|원|บาท|đ|₫)?\s*(?:${CODES})?\s*[A-Z*]{0,2}\s*$`);

function toNum(s, zeroDec) {
  s = s.replace(/[' ]/g, '');
  if (zeroDec) return +s.replace(/[.,]/g, '');
  const m = s.match(/[.,](\d{1,2})$/);
  if (m) return +(s.slice(0, -m[0].length).replace(/[.,]/g, '') + '.' + m[1]);
  return +s.replace(/[.,]/g, '');
}

function detectCurrency(text, hint) {
  const T = text;
  const has = re => re.test(T);
  if (has(/S\$|\bSGD\b/)) return 'SGD';
  if (has(/HK\$|\bHKD\b/)) return 'HKD';
  if (has(/NT\$|\bTWD\b|\bNTD\b/)) return 'TWD';
  if (has(/A\$|\bAUD\b/)) return 'AUD';
  if (has(/US\$|\bUSD\b/)) return 'USD';
  if (has(/\bRM\s?\d|\bMYR\b/)) return 'MYR';
  if (has(/\bRp\.?\s?\d|\bIDR\b/)) return 'IDR';
  if (has(/₩|\d\s*원|\bKRW\b/)) return 'KRW';
  if (has(/฿|บาท|\bTHB\b/)) return 'THB';
  if (has(/₫|\bVND\b|đồng/)) return 'VND';
  if (has(/₱|\bPHP\b/)) return 'PHP';
  if (has(/€|\bEUR\b/)) return 'EUR';
  if (has(/£|\bGBP\b/)) return 'GBP';
  if (has(/円|\bJPY\b/)) return 'JPY';
  if (has(/\bRMB\b|\bCNY\b|元/)) return 'CNY';
  if (has(/¥/)) return hint === 'CNY' ? 'CNY' : 'JPY';
  if (has(/[぀-ヿ]/)) return 'JPY';   // kana
  if (has(/[가-힯]/)) return 'KRW';   // hangul
  if (has(/[฀-๿]/)) return 'THB';   // thai
  if (has(/\$/)) return ['USD', 'SGD', 'AUD', 'HKD', 'TWD', 'NZD', 'CAD', 'BND', 'MXN'].includes(hint) ? hint : null;
  return null;
}

function parseDate(text, today = new Date()) {
  const ok = (y, m, d) => {
    if (y > 2400) y -= 543; // Thai Buddhist year
    if (y < 100) y += 2000;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    const diff = (dt - today) / 864e5;
    return diff > 2 || diff < -400 ? null : `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  let m, r;
  for (m of text.matchAll(/(20\d{2}|25\d{2})\s*[.\/\-年]\s*(\d{1,2})\s*[.\/\-月]\s*(\d{1,2})/g)) if ((r = ok(+m[1], +m[2], +m[3]))) return r;
  for (m of text.matchAll(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*'?(20\d{2}|\d{2})\b/gi)) if ((r = ok(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]))) return r;
  for (m of text.matchAll(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2}),?\s*(20\d{2})/gi)) if ((r = ok(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]))) return r;
  for (m of text.matchAll(/\b(\d{1,2})[.\/\-](\d{1,2})[.\/\-](20\d{2}|25\d{2}|\d{2})\b/g)) {
    const a = +m[1], b = +m[2], y = +m[3];
    // 03/11 could be 3 Nov or 11 Mar: take whichever reading is closer to today
    const opts = [ok(y, b, a), ok(y, a, b)].filter(Boolean).sort((p, q) => Math.abs(new Date(p) - today) - Math.abs(new Date(q) - today));
    if (opts.length) return opts[0];
  }
  return null;
}
function parseTime(text) {
  const m = text.match(/\b([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)(?:\s*[:：]\s*[0-5]\d)?\s*(am|pm)?\b/i);
  if (!m) return null;
  let h = +m[1];
  if (m[3]) { const pm = /pm/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

const CAT_RX = [
  ['stay', /hotel|\binn\b|hostel|resort|airbnb|ryokan|lodg|guest\s*house|accommodation|room\s*charge|ホテル|旅館|호텔|โรงแรม|khách sạn/i],
  ['transport', /taxi|\bcab\b|grab|uber|gojek|bolt|\bjr\b|railway|rail|metro|subway|train|\bbus\b|airline|airways|airport|parking|petrol|fuel|\bgas\s*station|shell|esso|caltex|ferry|toll|suica|pasmo|octopus|タクシー|駅|交通|乗車|택시|교통|แท็กซี่/i],
  ['fun', /museum|admission|entrance|ticket|tour|\bzoo\b|aquarium|cinema|theat|theme\s*park|disney|universal|gallery|temple|shrine|onsen|spa\b|karaoke|入場|拝観|博物館|美術館|입장|พิพิธภัณฑ์/i],
  ['food', /restaurant|resto|cafe|café|coffee|\bbar\b|pub|bistro|kitchen|bakery|grill|ramen|sushi|izakaya|noodle|dining|eatery|food|burger|pizza|kopi|hawker|starbucks|mcdonald|kfc|subway\s*sandwich|tea\b|rice|chicken|noodle|soup|curry|latte|juice|meal|lunch|dinner|breakfast|食堂|ラーメン|寿司|居酒屋|カフェ|珈琲|喫茶|焼肉|定食|식당|카페|치킨|ร้านอาหาร|อาหาร|nhà hàng|phở|quán|beer|ビール|wine|drink/i],
  ['shop', /mart|store|shop|\bmall\b|market|7-?eleven|seven|lawson|family\s*mart|don\s*quijote|donki|uniqlo|daiso|pharmacy|drug|duty\s*free|outlet|boutique|supermarket|ドラッグ|薬局|マート|百貨店|편의점|마트|ร้านค้า|cửa hàng/i]
];
function guessCategory(text) {
  const t = text.replace(/\s+/g, ' ');
  for (const [k, re] of CAT_RX) if (re.test(t)) return k;
  return null;
}

function cleanName(s) {
  return s
    .replace(/\d+(?:[.,]\d+)?\s*[xX×@*]\s*\d+(?:[.,]\d+)?/g, ' ')    // "2 x 3.50"
    .replace(/@\s*\d+(?:[.,]\d+)?/g, ' ')                               // "@5.50"
    .replace(/^\s*\d{1,3}\s*[xX×*]?\s+(?=\S)/, '')                     // leading qty
    .replace(/\s[xX×]\s?\d+\b/g, ' ')                                   // "x2"
    .replace(/[|_~=<>{}\[\]]+/g, ' ')
    .replace(/(?:\s+\d+(?:[.,]\d+)*)+\s*$/, '')                          // trailing numbers (unit price)
    .replace(/\s{2,}/g, ' ').trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})]+$/gu, '')
    .replace(/^\p{Ll}\s+(?=\S)/u, '');                                 // stray OCR letter in front
}
const titleCase = s => (/[a-z]/.test(s) || !/[A-Z]{3}/.test(s) ? s : s.toLowerCase().replace(/(^|[\s&\-'(/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()));

function parseReceipt(text, { hintCurrency = null, today = new Date() } = {}) {
  const raw = String(text || '');
  const joinCjk = s => s.replace(/(?<=[　-鿿가-힯＀-￯])\s+(?=[　-鿿가-힯＀-￯])/g, '');
  const lines = raw.split(/\r?\n/).map(l => joinCjk(l.replace(/[\t ]+/g, ' ').trim())).filter(l => l.length > 1);
  const all = lines.join('\n');
  const currency = detectCurrency(all, hintCurrency);
  const zeroDec = ZERO_DEC.has(currency || hintCurrency || '');

  const rows = lines.map((l, i) => {
    const m = l.match(AMT);
    if (!m) return { i, l };
    if (/\d[.\/:\-]\s*$/.test(l.slice(0, m.index))) return { i, l }; // tail of a date, time or phone number
    const label = l.slice(0, m.index).trim();
    let amount = toNum(m[2], zeroDec);
    if (m[1]) amount = -amount;
    // a lone number with no label that looks like a year, phone or ID is not money
    if (!/\p{L}/u.test(label) && (/^\d{4}$/.test(m[2]) && +m[2] > 1900 && +m[2] < 2600)) return { i, l };
    // reference / folio / order numbers, and big round integers on a cents-based receipt, are not money
    if (/(?:\bno|\bn[°º]?|#|\bnr|folio|\bref|order|invoice|receipt|course)\.?\s*:?\s*$/i.test(label)) return { i, l };
    if (!zeroDec && /^\d{5,}$/.test(m[2])) return { i, l };
    return { i, l, label, amount, money: Number.isFinite(amount) };
  });
  const money = rows.filter(r => r.money && r.amount !== 0);

  // total
  let total = null, totalRow = null, guessed = false;
  const tc = [];
  for (const r of money) {
    const s = r.label || r.l;
    if (RX.sub.test(s) || RX.excl.test(s) || r.amount <= 0) continue;
    const rank = RX.total.findIndex(re => re.test(s));
    if (rank >= 0) tc.push({ r, rank });
  }
  // some receipts put the label on one line and the number on the next
  for (const r of rows) if (!r.money && RX.total.some(re => re.test(r.l)) && !RX.sub.test(r.l) && !RX.excl.test(r.l)) {
    const nxt = rows[r.i + 1];
    if (nxt && nxt.money && !nxt.label && nxt.amount > 0) tc.push({ r: nxt, rank: RX.total.findIndex(re => re.test(r.l)) + 0.5 });
  }
  if (tc.length) {
    const best = Math.min(...tc.map(c => c.rank));
    const pick = tc.filter(c => c.rank === best).sort((a, b) => b.r.amount - a.r.amount)[0];
    total = pick.r.amount; totalRow = pick.r;
  }
  const subRow = money.find(r => RX.sub.test(r.label || r.l));
  if (total == null && subRow) {
    const adj = money.filter(r => r.i > subRow.i && RX.adj.test(r.label || r.l));
    total = subRow.amount + adj.reduce((a, r) => a + r.amount, 0); guessed = !adj.length;
  }
  if (total == null) {
    const pool = money.filter(r => r.amount > 0 && !RX.excl.test(r.label || r.l) && !RX.meta.test(r.l));
    if (pool.length) { total = Math.max(...pool.map(r => r.amount)); guessed = true; }
  }
  if (total != null) total = Math.round(total * 100) / 100;

  // line items: priced lines above the subtotal / total, that aren't tax, payment or header lines
  const stop = Math.min(...[subRow?.i, totalRow?.i, ...money.filter(r => RX.adj.test(r.label || '')).map(r => r.i)].filter(n => n != null), Infinity);
  let items = money.filter(r => r.i < stop && r.amount > 0 && r.label && !RX.excl.test(r.label) && !RX.meta.test(r.l) && !RX.adj.test(r.label) && !RX.total.some(re => re.test(r.label)))
    .map(r => ({ name: cleanName(r.label), amount: r.amount }))
    .filter(it => /\p{L}{2}/u.test(it.name) && it.name.length <= 60);
  const sum = items.reduce((a, it) => a + it.amount, 0);
  if (total && (sum > total * 1.02 || sum < total * 0.5)) items = []; // didn't add up — don't trust them

  // merchant: first meaningful line near the top
  let merchant = null;
  for (const l of lines.slice(0, 6)) {
    if (RX.meta.test(l) || AMT.test(l) && !/\p{L}{3}/u.test(l)) continue;
    const letters = (l.match(/\p{L}/gu) || []).length;
    if (letters >= 3 && letters / l.length > 0.5) { merchant = titleCase(cleanName(l) || l).slice(0, 48); break; }
  }

  const date = parseDate(all, today), time = parseTime(all);
  const cat = guessCategory(all);
  return { total, guessed, currency, date, time, merchant, items, cat };
}

if (typeof module !== 'undefined') module.exports = { RX, AMT, parseReceipt, detectCurrency, parseDate, parseTime, guessCategory, toNum, tzCurrency, ocrLangsFor };
