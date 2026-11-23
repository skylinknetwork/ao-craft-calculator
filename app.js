let DB = null;
let customPrices = JSON.parse(localStorage.getItem("ao_custom_prices") || "{}");
let currentSelectedItem = null;
let craftableItemsList = [];

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

    craftableItemsList = Object.values(DB.items)
      .filter((item) => item.craftable)
      .sort((a, b) => a.name.localeCompare(b.name));

    document.getElementById("loadingBox").classList.add("hidden");
    populateSkills();
    populateCategoryItems("");

    const defaultItem = DB.items["Sharp Sapphire Necklace"]
      ? "Sharp Sapphire Necklace"
      : craftableItemsList[0]?.name;
    if (defaultItem) {
      selectItemAndCalculate(defaultItem);
    }
  } catch (err) {
    document.getElementById("loadingBox").textContent = "❌ Error: " + err.message;
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

function populateCategoryItems(skillFilter) {
  const catSelect = document.getElementById("categoryItemSelect");
  catSelect.innerHTML = "";

  const filtered = craftableItemsList
    .filter((item) => !skillFilter || item.skill_name === skillFilter)
    .sort((a, b) => (a.skill_level - b.skill_level) || a.name.localeCompare(b.name));

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = `-- Pilih Item (${filtered.length} resep) --`;
  catSelect.appendChild(placeholder);

  filtered.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.name;
    opt.textContent = `[Lv.${item.skill_level}] ${item.name}`;
    catSelect.appendChild(opt);
  });

  if (currentSelectedItem && filtered.some((i) => i.name === currentSelectedItem)) {
    catSelect.value = currentSelectedItem;
  }
}

function selectItemAndCalculate(itemName) {
  const item = DB.items[itemName];
  if (!item) return;

  const skillSelect = document.getElementById("skillSelect");
  if (skillSelect.value && skillSelect.value !== item.skill_name) {
    skillSelect.value = item.skill_name;
    populateCategoryItems(item.skill_name);
  }
  document.getElementById("categoryItemSelect").value = itemName;
  document.getElementById("itemSearch").value = itemName;
  document.getElementById("searchDropdown").classList.add("hidden");

  calculateItem(itemName);
}

// Rekursi perhitungan: otomatis breakdown semua sub-komponen sampai bahan mentah dasar
function resolveRecipe(itemName, neededQty, totalsMap, depth = 0) {
  const item = DB.items[itemName];
  if (!item) return null;

  const isCraftable = item.craftable && item.ingredients && item.ingredients.length > 0;
  const batchSize = item.batch_size > 0 ? item.batch_size : 1;
  const batches = isCraftable ? Math.ceil(neededQty / batchSize) : 0;
  const producedQty = isCraftable ? batches * batchSize : neededQty;

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
    children: []
  };

  if (isCraftable) {
    for (const ing of item.ingredients) {
      const subNeeded = ing.qty * batches;
      const childNode = resolveRecipe(ing.item, subNeeded, totalsMap, depth + 1);
      if (childNode) {
        node.children.push(childNode);
      }
    }
  } else {
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

function calculateItem(itemName) {
  const item = DB.items[itemName];
  if (!item) return;

  currentSelectedItem = itemName;
  const qty = Math.max(1, parseInt(document.getElementById("craftQty").value, 10) || 1);

  const totalsMap = {};
  const tree = resolveRecipe(itemName, qty, totalsMap, 0);
  const stats = sumTreeStats(tree);

  document.getElementById("resultArea").classList.remove("hidden");
  document.getElementById("resItemName").textContent = item.name;
  document.getElementById("resSkill").textContent = item.craftable
    ? `${item.skill_name} Lv.${item.skill_level}`
    : "Tidak bisa di-craft (Bahan Dasar)";
  document.getElementById("resWorkload").textContent = fmt(stats.workload);
  document.getElementById("resCraftXp").textContent = fmt(stats.xp);
  document.getElementById("resDefaultPrice").textContent = fmt((item.default_craft_price || 0) * tree.batches) + " Gold";

  renderShoppingTable(totalsMap, tree.producedQty);
  renderTree(tree);
}

function renderShoppingTable(totalsMap, totalProduced) {
  const tbody = document.getElementById("shoppingBody");
  tbody.innerHTML = "";

  const list = Object.values(totalsMap).sort((a, b) => a.name.localeCompare(b.name));
  let grandTotalCost = 0;
  const zeroPriceItems = [];

  list.forEach((entry) => {
    const unitPrice = getItemPrice(entry.name);
    const subTotal = unitPrice * entry.qty;
    grandTotalCost += subTotal;

    if (unitPrice <= 0) {
      zeroPriceItems.push(entry.name);
    }

    const tr = document.createElement("tr");
    const isRaw = entry.skillName === "Raw Material";

    tr.innerHTML = `
      <td><strong>${entry.name}</strong></td>
      <td><span class="badge-skill ${isRaw ? "badge-raw" : ""}">${entry.skillName}</span></td>
      <td class="text-right">${fmt(entry.qty)}</td>
      <td class="text-right">
        <input type="text" class="price-input row-price-input ${unitPrice <= 0 ? "input-zero-alert" : ""}" data-item="${entry.name.replace(/"/g, "&quot;")}" value="${fmt(unitPrice)}" />
      </td>
      <td class="text-right row-subtotal">${fmt(subTotal)}</td>
    `;
    tbody.appendChild(tr);
  });

  // Update Banner Peringatan Item Berharga 0
  const warningEl = document.getElementById("zeroPriceWarning");
  if (zeroPriceItems.length > 0) {
    warningEl.classList.remove("hidden");
    warningEl.innerHTML = `⚠️ <strong>PERINGATAN:</strong> Silakan input harga pasar untuk item yang masih bernilai <strong>0 Gold</strong> berikut agar total biaya akurat: <span class="warning-items-list">${zeroPriceItems.join(", ")}</span>`;
  } else {
    warningEl.classList.add("hidden");
    warningEl.innerHTML = "";
  }

  updateCostSummary(grandTotalCost, totalProduced);

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

  const skillInfo = node.isCraftable
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

// === EVENT LISTENERS ===
document.getElementById("skillSelect").addEventListener("change", (e) => {
  populateCategoryItems(e.target.value);
});

document.getElementById("categoryItemSelect").addEventListener("change", (e) => {
  const val = e.target.value;
  if (val && DB.items[val]) {
    document.getElementById("itemSearch").value = val;
    calculateItem(val);
  }
});

const searchInput = document.getElementById("itemSearch");
const searchDropdown = document.getElementById("searchDropdown");

searchInput.addEventListener("input", () => {
  const kw = searchInput.value.trim().toLowerCase();
  searchDropdown.innerHTML = "";

  if (!kw) {
    searchDropdown.classList.add("hidden");
    return;
  }

  const matches = craftableItemsList
    .filter((item) => item.name.toLowerCase().includes(kw))
    .slice(0, 30);

  if (matches.length === 0) {
    searchDropdown.classList.add("hidden");
    return;
  }

  matches.forEach((item) => {
    const div = document.createElement("div");
    div.className = "search-item";
    div.innerHTML = `
      <span class="search-item-name">${item.name}</span>
      <span class="search-item-skill">${item.skill_name} Lv.${item.skill_level}</span>
    `;
    div.addEventListener("click", () => {
      selectItemAndCalculate(item.name);
    });
    searchDropdown.appendChild(div);
  });

  searchDropdown.classList.remove("hidden");
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrapper")) {
    searchDropdown.classList.add("hidden");
  }
});

document.getElementById("btnCalculate").addEventListener("click", () => {
  const val = searchInput.value.trim();
  if (DB && DB.items[val]) {
    selectItemAndCalculate(val);
  } else if (currentSelectedItem) {
    calculateItem(currentSelectedItem);
  }
});

document.getElementById("craftQty").addEventListener("change", () => {
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
    if (shown >= 100) break;

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
