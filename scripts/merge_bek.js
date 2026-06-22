const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const BEK_PATH = path.join(ROOT, 'data', 'bek_list_raw.tsv');

const html = fs.readFileSync(INDEX_PATH, 'utf8');

const invMatch = html.match(/const INVENTORY = (\[.*?\]);/s);
if (!invMatch) throw new Error('Could not find INVENTORY array in index.html');
const inventory = JSON.parse(invMatch[1]);

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
  if (perLb) return value; // already a per-lb price, no case-pack division applies
  const unit = orderUnit.trim().toLowerCase();
  if (unit === 'pack') {
    const n = parsePackSize(packSizeRaw);
    return n > 0 ? Math.round((value / n) * 100) / 100 : value;
  }
  return value;
}

const lines = fs.readFileSync(BEK_PATH, 'utf8').split('\n').filter(l => l.trim().length > 0);
const header = lines[0].split('\t');
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
});

function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/['".]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const existingByNorm = new Map();
for (const item of inventory) {
  existingByNorm.set(normalizeName(item.desc), item);
}

let maxId = inventory.reduce((m, i) => Math.max(m, i.id), 0);

const matched = [];
const added = [];
const perLbFlagged = [];

for (const row of rows) {
  const norm = normalizeName(row.itemName);
  const existing = existingByNorm.get(norm);
  const cost = computeCost(row.unit, row.packSize, row.priceRaw);
  const { perLb } = parsePrice(row.priceRaw);
  if (perLb) perLbFlagged.push(row.itemName);

  if (existing) {
    existing.desc = row.itemName;
    existing.section = categoryToSection(row.tempZone, row.category);
    existing.category = row.category || existing.category;
    existing.unit = row.packSize;
    existing.cost = cost;
    existing.brand = row.brand;
    existing.bek = row.itemNum;
    matched.push(row.itemName);
  } else {
    maxId += 1;
    const newItem = {
      id: maxId,
      desc: row.itemName,
      section: categoryToSection(row.tempZone, row.category),
      category: row.category || 'General',
      unit: row.packSize,
      cost,
      par: 1.0,
      sources: 1,
      confidence: 'BEK list',
      on_hand: 0,
      brand: row.brand,
      bek: row.itemNum,
    };
    inventory.push(newItem);
    existingByNorm.set(norm, newItem);
    added.push(row.itemName);
  }
}

const newArrayStr = 'const INVENTORY = ' + JSON.stringify(inventory) + ';';
const newHtml = html.replace(/const INVENTORY = \[.*?\];/s, newArrayStr);
fs.writeFileSync(INDEX_PATH, newHtml);

console.log(`Total BEK rows processed: ${rows.length}`);
console.log(`Matched existing items updated: ${matched.length}`);
console.log(`New items added: ${added.length}`);
console.log(`Per-lb priced items (cost stored as $/lb, not divided): ${perLbFlagged.length}`);
console.log(`Final inventory size: ${inventory.length}`);
console.log('\n--- Sample of added items ---');
added.slice(0, 10).forEach(n => console.log(' +', n));
console.log('\n--- Per-lb items ---');
perLbFlagged.forEach(n => console.log(' $/lb:', n));
