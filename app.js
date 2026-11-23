let DB = null;
let customPrices = JSON.parse(localStorage.getItem("ao_custom_prices") || "{}");
let currentSelectedItem = null;

const fmt = (num) => Math.round(num || 0).toLocaleString("en-US");
const parseNum = (str) => parseInt(String(str || "0").replace(/[^\d]/g, ""), 10) || 0;

function saveCustomPrices() {
  localStorage.setItem("ao_custom_prices", JSON.stringify(customPrices));
}

function getItemPrice(itemName) {
  if (customPrices[itemName] !== undefined) {
    return customPrices[itemName];
  }
  if (DB.fixed_prices && DB.fixed_prices[itemName] !== undefined) {
    return DB.fixed_prices[itemName];
  }
  const item = DB.items[itemName];
  if (item && item.default_craft_price > 0) {
    return item.default_craft_price;
  }
  return 0;
}

async function init() {
  try {
    const resp = await fetch("recipes.json");
    if (!resp.ok) throw new Error("Gagal memuat recipes.json");
    DB = await resp.json();

    document.getElementById("loadingBox").classList.add("hidden");
    populateSkills();
    populateDatalist("");

    // Default contoh pertama kali buka
    const defaultItem = DB.items["Apocalyptic Gloves"] ? "Apocalyptic Gloves" : Object.keys(DB.items)[0];
    document.getElementById("itemSearch").value = defaultItem;
    calculateItem(defaultItem);
  } catch (err) {
    document.getElementById("loadingBox").textContent = "❌ Error: " + err.message + " (Pastikan dijalankan lewat server/GitHub Pages)";
  }
}

function populateSkills() {
  const select = document.getElementById("skillSelect");
  (DB.skills || []).forEach((skill) => {
    const opt = document.createElement("option");
    opt.value = skill;
    opt.textContent = skill;
    select.appendChild(opt);
  });
}

function populateDatalist(skillFilter) {
  const datalist = document.getElementById("itemDatalist");
  datalist.innerHTML = "";
  const names = Object.keys(DB.items).sort();

  for (const name of names) {
    const item = DB.items[name];
    if (!item.craftable) continue;
    if (skillFilter && item.skill_name !== skillFilter) continue;

    const opt = document.createElement("option");
    opt.value = name;
    datalist.appendChild(opt);
  }
}

// Rekursi perhitungan kebutuhan bahan & pohon crafting
function resolveRecipe(itemName, neededQty, breakSub, totalsMap, depth = 0) {
  const item = DB.items[itemName];
  if (!item) return null;

  const isCraftable = item.craftable && item.ingredients && item.ingredients.length > 0;
  const shouldBreak = isCraftable && (depth === 0 || breakSub);

  const batchSize = item.batch_size > 0 ? item.batch_size : 1;
  const batches = shouldBreak ? Math.ceil(neededQty / batchSize) : 0;
  const producedQty = shouldBreak ? batches * batchSize : neededQty;

  const node = {
    name: itemName,
    neededQty,
    batches,
    producedQty,
    skillName: item.skill_name,
    skillLevel: item.skill_level,
    workload: batches * (item.workload || 0),
    xp: batches * (item.craft_xp || 0),
    isCraftable,
    shouldBreak,
    children: []
  };

  if (shouldBreak) {
    for (const ing of item.ingredients) {
      const subNeeded = ing.qty * batches;
      const childNode = resolveRecipe(ing.item, subNeeded, breakSub, totalsMap, depth + 1);
      if (childNode) {
        node.children.push(childNode);
      }
    }
  } else {
    // Masukkan ke daftar bahan akhir yang harus dibeli
    if (!totalsMap[itemName]) {
      totalsMap[itemName] = {
        name: itemName,
        skillName: item.skill_name || "Raw Material",
        qty: 0
      };
    }
    totalsMap[itemName].qty += neededQty;
  }

  return node;
}

function sumTreeStats(node) {
  let workload = node.workload;
  let xp = node.xp;
  for (const ch of node.children) {
    const st = sumTreeStats(ch);
    workload += st.workload;
    xp += st.xp;
  }
  return { workload, xp };
}

function estimateLevelGain(startLv, gainedXp) {
  const table = DB.experience_table || [];
  if (!table.length || gainedXp <= 0) return `Lv.${startLv} (+${fmt(gainedXp)} XP)`;

  let lv = Math.max(1, Math.min(180, startLv));
  let remainingXp = gainedXp;

  while (lv < 180) {
    const nextRow = table.find((r) => r.level === lv + 1);
    if (!nextRow || nextRow.xp_required <= 0) break;
    if (remainingXp >= nextRow.xp_required) {
      remainingXp -= nextRow.xp_required;
      lv++;
    } else {
      break;
    }
  }

  if (lv > startLv) {
    return `Lv.${startLv} ➔ Lv.${lv} (Naik ${lv - startLv} Level!)`;
  }
  return `Tetap Lv.${startLv} (+${fmt(gainedXp)} XP)`;
}

function calculateItem(itemName) {
  const item = DB.items[itemName];
  if (!item) return;

  currentSelectedItem = itemName;
  const qty = Math.max(1, parseInt(document.getElementById("craftQty").value, 10) || 1);
  const breakSub = document.getElementById("chkBreakSub").checked;
  const startLv = parseInt(document.getElementById("currentLevel").value, 10) || 1;
  const xpBonus = parseFloat(document.getElementById("xpBonus").value) || 0;

  const totalsMap = {};
  const tree = resolveRecipe(itemName, qty, breakSub, totalsMap, 0);
  const stats = sumTreeStats(tree);
  const finalXp = Math.round(stats.xp * (1 + xpBonus / 100));

  document.getElementById("resultArea").classList.remove("hidden");
  document.getElementById("resItemName").textContent = item.name;
  document.getElementById("resSkill").textContent = item.craftable
    ? `${item.skill_name} Lv.${item.skill_level}`
    : "Tidak bisa di-craft (Bahan Dasar)";
  document.getElementById("resBatchSize").textContent = fmt(item.batch_size);
  document.getElementById("resTotalBatches").textContent = fmt(tree.batches) + " batch";
  document.getElementById("resTotalProduced").textContent = fmt(tree.producedQty) + " pcs";
  document.getElementById("resWorkload").textContent = fmt(stats.workload);
  document.getElementById("resCraftXp").textContent = fmt(finalXp) + (xpBonus > 0 ? ` (+${xpBonus}%)` : "");
  document.getElementById("resLevelGain").textContent = estimateLevelGain(startLv, finalXp);
  document.getElementById("resDefaultPrice").textContent = fmt((item.default_craft_price || 0) * tree.batches) + " Gold";

  renderShoppingTable(totalsMap, tree.producedQty);
  renderTree(tree);
}

function renderShoppingTable(totalsMap, totalProduced) {
  const tbody = document.getElementById("shoppingBody");
  tbody.innerHTML = "";

  const list = Object.values(totalsMap).sort((a, b) => a.name.localeCompare(b.name));
  let grandTotalCost = 0;

  list.forEach((entry) => {
    const unitPrice = getItemPrice(entry.name);
    const subTotal = unitPrice * entry.qty;
    grandTotalCost += subTotal;

    const tr = document.createElement("tr");
    const isRaw = entry.skillName === "Raw Material";

    tr.innerHTML = `
      <td><strong>${entry.name}</strong></td>
      <td><span class="badge-skill ${isRaw ? "badge-raw" : ""}">${entry.skillName}</span></td>
      <td class="text-right">${fmt(entry.qty)}</td>
      <td class="text-right">
        <input type="text" class="price-input row-price-input" data-item="${entry.name.replace(/"/g, "&quot;")}" value="${fmt(unitPrice)}" />
      </td>
      <td class="text-right row-subtotal">${fmt(subTotal)}</td>
    `;
    tbody.appendChild(tr);
  });

  updateCostSummary(grandTotalCost, totalProduced);

  // Event edit harga langsung di tabel
  tbody.querySelectorAll(".row-price-input").forEach((inp) => {
    inp.addEventListener("change", (e) => {
      const name = e.target.getAttribute("data-item");
      const val = parseNum(e.target.value);
      customPrices[name] = val;
      saveCustomPrices();
      e.target.value = fmt(val);
      calculateItem(currentSelectedItem);
    });
  });
}

function updateCostSummary(totalCost, totalProduced) {
  document.getElementById("resTotalCost").textContent = fmt(totalCost) + " Gold";
  const costPerItem = totalProduced > 0 ? totalCost / totalProduced : 0;
  document.getElementById("resCostPerItem").textContent = fmt(costPerItem) + " Gold / pcs";

  const sellUnit = parseNum(document.getElementById("sellPriceInput").value);
  const profitEl = document.getElementById("resProfit");

  if (sellUnit > 0) {
    const totalRevenue = sellUnit * totalProduced;
    const profit = totalRevenue - totalCost;
    profitEl.textContent = (profit >= 0 ? "+" : "-") + fmt(Math.abs(profit)) + " Gold";
    profitEl.className = profit >= 0 ? "profit-plus" : "profit-minus";
  } else {
    profitEl.textContent = "-";
    profitEl.className = "";
  }
}

function renderTree(node, isRoot = true) {
  if (isRoot) {
    const container = document.getElementById("treeContainer");
    container.innerHTML = "";
    container.appendChild(buildTreeElement(node, true));
  }
}

function buildTreeElement(node, isRoot) {
  const wrapper = document.createElement("div");
  wrapper.className = isRoot ? "tree-node root-node" : "tree-node";

  const skillInfo = node.shouldBreak
    ? `${node.skillName} Lv.${node.skillLevel} • ${fmt(node.batches)} batch`
    : `${node.skillName || "Bahan Dasar"}`;

  const row = document.createElement("div");
  row.className = "tree-row";
  row.innerHTML = `
    <div>
      <span class="tree-qty">${fmt(node.neededQty)}x</span>
      <span class="tree-item-title">${node.name}</span>
    </div>
    <div class="tree-meta">${skillInfo}</div>
  `;
  wrapper.appendChild(row);

  if (node.children && node.children.length > 0) {
    node.children.forEach((child) => {
      wrapper.appendChild(buildTreeElement(child, false));
    });
  }

  return wrapper;
}

// Event Listeners
document.getElementById("skillSelect").addEventListener("change", (e) => {
  populateDatalist(e.target.value);
});

document.getElementById("itemSearch").addEventListener("change", (e) => {
  const val = e.target.value.trim();
  if (DB && DB.items[val]) {
    calculateItem(val);
  }
});

document.getElementById("btnCalculate").addEventListener("click", () => {
  const val = document.getElementById("itemSearch").value.trim();
  if (DB && DB.items[val]) {
    calculateItem(val);
  } else {
    alert("Nama item tidak ditemukan, pilih dari daftar saran ya!");
  }
});

document.getElementById("chkBreakSub").addEventListener("change", () => {
  if (currentSelectedItem) calculateItem(currentSelectedItem);
});

document.getElementById("currentLevel").addEventListener("change", () => {
  if (currentSelectedItem) calculateItem(currentSelectedItem);
});

document.getElementById("xpBonus").addEventListener("change", () => {
  if (currentSelectedItem) calculateItem(currentSelectedItem);
});

document.getElementById("sellPriceInput").addEventListener("input", (e) => {
  const val = parseNum(e.target.value);
  e.target.value = val > 0 ? fmt(val) : "";
  if (currentSelectedItem) calculateItem(currentSelectedItem);
});

document.getElementById("btnResetPrices").addEventListener("click", () => {
  if (confirm("Hapus semua harga bahan kustom yang tersimpan di browser?")) {
    customPrices = {};
    saveCustomPrices();
    if (currentSelectedItem) calculateItem(currentSelectedItem);
  }
});

// Modal Daftar Harga
document.getElementById("btnCustomPrices").addEventListener("click", () => {
  document.getElementById("priceModal").classList.remove("hidden");
  renderModalPrices("");
});

document.getElementById("btnCloseModal").addEventListener("click", () => {
  document.getElementById("priceModal").classList.add("hidden");
});

document.getElementById("modalSearchInput").addEventListener("input", (e) => {
  renderModalPrices(e.target.value.trim().toLowerCase());
});

function renderModalPrices(keyword) {
  const tbody = document.getElementById("modalPriceBody");
  tbody.innerHTML = "";

  const names = Object.keys(DB.items).sort();
  let shown = 0;

  for (const name of names) {
    if (keyword && !name.toLowerCase().includes(keyword)) continue;
    if (shown >= 100) break; // Batasi 100 baris agar tetap super ringan

    const item = DB.items[name];
    const price = getItemPrice(name);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${name}</td>
      <td><span class="badge-skill">${item.skill_name}</span></td>
      <td class="text-right">
        <input type="text" class="price-input modal-price-inp" data-item="${name.replace(/"/g, "&quot;")}" value="${fmt(price)}" />
      </td>
    `;
    tbody.appendChild(tr);
    shown++;
  }

  tbody.querySelectorAll(".modal-price-inp").forEach((inp) => {
    inp.addEventListener("change", (e) => {
      const name = e.target.getAttribute("data-item");
      const val = parseNum(e.target.value);
      customPrices[name] = val;
      saveCustomPrices();
      e.target.value = fmt(val);
      if (currentSelectedItem) calculateItem(currentSelectedItem);
    });
  });
}

init();
