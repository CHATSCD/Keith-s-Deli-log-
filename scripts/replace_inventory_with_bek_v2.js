const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const BEK_PATH = path.join(ROOT, 'data', 'bek_list_v2_raw.tsv');

const html = fs.readFileSync(INDEX_PATH, 'utf8');

const tempZoneToSection = (tempZone) => {
  const t = tempZone.toLowerCase();
  if (t.includes('frozen')) return 'Frozen';
  if (t.includes('refrigeration')) return 'Refrigerator';
  return 'Dry';
};

const categoryToSection = (tempZone, category) => {
  const section = tempZoneToSection(tempZone);
  if (section === 'Dry' && category === 'Equipment & Supplies') return 'Dry Container';
  if (section === 'Dry') return 'Dry Food';
  return section;
};

function parsePackSize(packSize) {
  const m = packSize.match(/^(\d+)\s*\//);
  return m ? parseInt(m[1], 10) : 1;
}

function parsePrice(priceRaw) {
  const perLb = /LB$/i.test(priceRaw.trim());
  const num = parseFloat(priceRaw.replace(/[^0-9.]/g, ''));
  return { value: isNaN(num) ? 0 : num, perLb };
}

function computeCost(orderUnit, packSizeRaw, priceRaw) {
  const { value, perLb } = parsePrice(priceRaw);
  if (perLb) return value;
  const unit = orderUnit.trim().toLowerCase();
  if (unit === 'pack' || unit === 'packs' || unit === 'p') {
    const n = parsePackSize(packSizeRaw);
    return n > 0 ? Math.round((value / n) * 100) / 100 : value;
  }
  return value;
}

const lines = fs.readFileSync(BEK_PATH, 'utf8').split('\n').filter(l => l.trim().length > 0);
const rows = lines.slice(1).map(line => {
  const cols = line.split('\t');
  const [unit, itemNum, packSize, brand, itemName, tempZone, category, each, price, weeklyAvg, special] = cols;
  return {
    unit: (unit || '').trim(),
    itemNum: (itemNum || '').trim(),
    packSize: (packSize || '').trim(),
    brand: (brand || '').trim(),
    itemName: (itemName || '').trim(),
    tempZone: (tempZone || '').trim(),
    category: (category || '').trim(),
    each: (each || '').trim(),
    priceRaw: (price || '').trim(),
    special: (special || '').trim(),
  };
}).filter(r => r.itemName);

const seenItemNum = new Map();
const dupes = [];
let id = 0;
const perLbFlagged = [];
const inventory = rows.map(row => {
  id += 1;
  const cost = computeCost(row.unit, row.packSize, row.priceRaw);
  const { perLb } = parsePrice(row.priceRaw);
  if (perLb) perLbFlagged.push(row.itemName);
  if (seenItemNum.has(row.itemNum)) dupes.push(row.itemName);
  seenItemNum.set(row.itemNum, true);
  const category = (row.category && row.category !== '-') ? row.category : 'General';
  return {
    id,
    desc: row.itemName,
    section: categoryToSection(row.tempZone, category),
    category,
    unit: row.packSize,
    cost,
    par: 1.0,
    sources: 1,
    confidence: 'BEK list',
    on_hand: 0,
    brand: row.brand,
    bek: row.itemNum,
  };
});

const newArrayStr = 'const INVENTORY = ' + JSON.stringify(inventory) + ';';
const newHtml = html.replace(/const INVENTORY = \[.*?\];/s, newArrayStr);
fs.writeFileSync(INDEX_PATH, newHtml);

console.log(`Total rows processed: ${rows.length}`);
console.log(`Final inventory size: ${inventory.length}`);
console.log(`Per-lb priced items (cost stored as $/lb): ${perLbFlagged.length}`);
console.log(`Duplicate item numbers seen: ${dupes.length}`);
if (dupes.length) console.log(' dupes:', dupes);
console.log('\n--- Sample items ---');
inventory.slice(0, 3).forEach(i => console.log(' ', JSON.stringify(i)));
