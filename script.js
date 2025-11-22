let allBosses = []; 
let visibleIds = new Set(); 
let settings = { 
    notifyRespawn: false, 
    notifyCountdown: false, 
    notifyMin: 3, 
    floatMin: 10,
    useFloating: true,
    lightMode: true 
};
let currentSortType = 'default';
let currentTopBossId = null; 
let timerWorker = null; 

async function init() {
    loadSettings();
    await loadData();
    
    // [新增] 檢查是否為分享連結
    checkShareUrl();

    renderSidebar();
    renderGrid();
    
    startBackgroundTimer();

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === 'visible') {
            tick();
        }
    });

    if (Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }
    updateToggleButtonIcon();
}

// [新增] 產生分享連結
function generateShareLink() {
    const activeTimers = allBosses
        .filter(b => b.targetTime !== null)
        .map(b => ({ i: b.id, t: b.targetTime, f: b.floatSec || 0 })); // i=id, t=targetTime, f=floatSec
    
    if (activeTimers.length === 0) {
        alert("目前沒有正在倒數的魔物，無法分享！");
        return;
    }
    
    // 簡單編碼：JSON -> Base64
    const jsonStr = JSON.stringify(activeTimers);
    const b64 = btoa(jsonStr);
    
    // 組合網址 (相容 Github Pages)
    const url = `${window.location.origin}${window.location.pathname}?share=${b64}`;
    
    // 複製到剪貼簿
    navigator.clipboard.writeText(url).then(() => {
        alert("已複製分享連結！\n傳送給朋友即可同步目前的倒數時間。");
    }).catch(err => {
        console.error(err);
        alert("複製失敗，請手動複製網址列(如果有變化的話)");
    });
}

// [新增] 檢查並讀取分享連結
function checkShareUrl() {
    const params = new URLSearchParams(window.location.search);
    const shareData = params.get('share');
    
    if (shareData) {
        try {
            const decoded = atob(shareData);
            const importedTimers = JSON.parse(decoded);
            
            let count = 0;
            importedTimers.forEach(item => {
                // 尋找對應 ID 的魔物
                const boss = allBosses.find(b => b.id === item.i);
                if (boss) {
                    boss.targetTime = item.t;
                    boss.floatSec = item.f || 0;
                    boss.respawnNotified = false; // 重置通知
                    
                    // 強制顯示該魔物
                    visibleIds.add(boss.id);
                    if (boss.onSidebar === false) boss.onSidebar = true; // 確保側邊欄也打開
                    
                    count++;
                }
            });
            
            if (count > 0) {
                saveData();
                localStorage.setItem('ro_boss_visible_ids', JSON.stringify([...visibleIds]));
                
                // 清除網址參數，避免重新整理重複載入
                window.history.replaceState({}, document.title, window.location.pathname);
                
                alert(`已成功同步 ${count} 隻魔物的倒數時間！`);
            }
            
        } catch (e) {
            console.error("解析分享連結失敗", e);
            alert("無效的分享連結！");
        }
    }
}

function startBackgroundTimer() {
    const workerCode = `
        self.onmessage = function(e) {
            if (e.data === 'start') {
                setInterval(() => {
                    self.postMessage('tick');
                }, 1000);
            }
        };
    `;
    const blob = new Blob([workerCode], { type: "application/javascript" });
    timerWorker = new Worker(URL.createObjectURL(blob));
    timerWorker.onmessage = function(e) {
        if (e.data === 'tick') {
            tick();
        }
    };
    timerWorker.postMessage('start');
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        sidebar.classList.toggle('open');
        overlay.style.display = sidebar.classList.contains('open') ? 'block' : 'none';
    } else {
        sidebar.classList.toggle('hidden');
    }
    updateToggleButtonIcon();
}

function updateToggleButtonIcon() {
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('toggle-btn');
    const isMobile = window.innerWidth <= 768;
    let isOpen = isMobile ? sidebar.classList.contains('open') : !sidebar.classList.contains('hidden');
    btn.innerHTML = isOpen ? '&lt;' : '&gt;';
}

async function loadData() {
    const localList = localStorage.getItem('ro_boss_list');
    if (localList) {
        allBosses = JSON.parse(localList);
        allBosses.forEach(b => {
            if (typeof b.onSidebar === 'undefined') b.onSidebar = true;
        });
    } else {
        await syncDefaultMonsters(true);
    }
    const savedVis = localStorage.getItem('ro_boss_visible_ids');
    if (savedVis) visibleIds = new Set(JSON.parse(savedVis));
    else allBosses.forEach(b => visibleIds.add(b.id));
}

async function syncDefaultMonsters(isFirstLoad = false) {
    try {
        const response = await fetch('monsters.json?t=' + new Date().getTime());
        if (response.ok) {
            const defaultData = await response.json();
            let addedCount = 0;
            let updatedCount = 0;
            
            let maxId = allBosses.length > 0 ? Math.max(...allBosses.map(b => b.id)) : 0;

            defaultData.forEach(def => {
                const existing = allBosses.find(b => b.name === def.name);
                
                if (existing) {
                    if (existing.respawnHour !== Number(def.respawnHour)) {
                        existing.respawnHour = Number(def.respawnHour);
                        updatedCount++;
                    }
                } else {
                    maxId++;
                    allBosses.push({
                        id: maxId,
                        name: def.name,
                        respawnHour: def.respawnHour,
                        targetTime: null,
                        floatSec: 0,
                        respawnNotified: false,
                        onSidebar: true
                    });
                    visibleIds.add(maxId);
                    addedCount++;
                }
            });

            if (addedCount > 0 || updatedCount > 0 || isFirstLoad) {
                saveData();
                localStorage.setItem('ro_boss_visible_ids', JSON.stringify([...visibleIds]));
                
                if (!isFirstLoad) {
                    renderSidebar();
                    renderGrid();
                    renderManageList(); 
                    alert(`同步完成！\n新增：${addedCount} 筆\n更新時間：${updatedCount} 筆`);
                }
            } else if (!isFirstLoad) {
                alert("目前已是最新資料，無需更新。");
            }
        }
    } catch (e) {
        console.error(e);
        if (!isFirstLoad) alert("無法讀取預設資料 (monsters.json)");
    }
}

function saveData() { localStorage.setItem('ro_boss_list', JSON.stringify(allBosses)); }

function loadSettings() {
    const s = localStorage.getItem('ro_boss_settings');
    if (s) {
        const parsed = JSON.parse(s);
        settings = { ...settings, ...parsed };
    }
    document.getElementById('chk-notify-respawn').checked = settings.notifyRespawn;
    document.getElementById('chk-notify-countdown').checked = settings.notifyCountdown;
    document.getElementById('inp-notify-min').value = settings.notifyMin;
    document.getElementById('inp-float-min').value = settings.floatMin || 10; 
    document.getElementById('chk-use-float').checked = settings.useFloating !== false; 
    document.getElementById('chk-theme').checked = settings.lightMode;
    
    toggleRespawnSettings(); 
    applyTheme();
}

function toggleRespawnSettings() {
    const respawnChk = document.getElementById('chk-notify-respawn');
    const countdownChk = document.getElementById('chk-notify-countdown');
    const countdownInput = document.getElementById('inp-notify-min');
    const countdownLabel = document.getElementById('lbl-notify-countdown');

    settings.notifyRespawn = respawnChk.checked;

    if (!settings.notifyRespawn) {
        settings.notifyCountdown = false;
        countdownChk.checked = false;
        countdownChk.disabled = true;
        countdownInput.disabled = true;
        countdownLabel.classList.add('disabled');
    } else {
        countdownChk.disabled = false;
        countdownInput.disabled = false;
        countdownLabel.classList.remove('disabled');
        settings.notifyCountdown = countdownChk.checked;
    }
    saveSettings();
}

function saveSettings() {
    settings.notifyRespawn = document.getElementById('chk-notify-respawn').checked;
    settings.notifyCountdown = document.getElementById('chk-notify-countdown').checked;
    settings.notifyMin = parseInt(document.getElementById('inp-notify-min').value) || 3;
    settings.floatMin = parseInt(document.getElementById('inp-float-min').value) || 0;
    settings.useFloating = document.getElementById('chk-use-float').checked;
    localStorage.setItem('ro_boss_settings', JSON.stringify(settings));
}

function openSortModal() {
    document.getElementById('sort-modal').style.display = 'flex';
    document.querySelectorAll('.sort-option').forEach(opt => opt.classList.remove('selected'));
    const active = document.getElementById(`sort-opt-${currentSortType}`);
    if (active) active.classList.add('selected');
}

function closeSortModal() {
    document.getElementById('sort-modal').style.display = 'none';
}

function selectSort(type) {
    currentSortType = type;
    renderSidebar();
    closeSortModal();
}

// 時間格式化工具 (小數轉時分)
function formatRespawnTime(hours) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    
    if (m === 0) {
        return `${h}H`;
    } else {
        return `${h}H ${m}M`;
    }
}

function renderSidebar() {
    const list = document.getElementById('sidebar-list');
    const searchInput = document.getElementById('sidebar-search');
    const searchText = searchInput ? searchInput.value.toLowerCase() : "";

    list.innerHTML = '';
    
    let displayList = allBosses.filter(b => b.onSidebar !== false); 

    if (searchText) {
        displayList = displayList.filter(b => b.name.toLowerCase().includes(searchText));
    }

    if (currentSortType === 'name-asc') displayList.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
    else if (currentSortType === 'name-desc') displayList.sort((a, b) => b.name.localeCompare(a.name, "zh-Hant"));
    else if (currentSortType === 'time-asc') displayList.sort((a, b) => a.respawnHour - b.respawnHour);
    else if (currentSortType === 'time-desc') displayList.sort((a, b) => b.respawnHour - a.respawnHour);
    else if (currentSortType === 'checked-first') {
        displayList.sort((a, b) => {
            const aChecked = visibleIds.has(a.id) ? 1 : 0;
            const bChecked = visibleIds.has(b.id) ? 1 : 0;
            return bChecked - aChecked; 
        });
    }

    displayList.forEach(boss => {
        const div = document.createElement('div');
        div.className = 'monster-check-item';
        div.onclick = (e) => {
            if (e.target.tagName !== 'INPUT') {
                const cb = div.querySelector('input');
                cb.checked = !cb.checked;
                toggleVisibility(boss.id, cb.checked);
            }
        };
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.style.width = 'auto';
        checkbox.checked = visibleIds.has(boss.id);
        checkbox.onclick = (e) => { e.stopPropagation(); toggleVisibility(boss.id, e.target.checked); };
        
        const label = document.createElement('label');
        label.className = 'sidebar-label';
        label.innerHTML = `<span class="time-badge">(${formatRespawnTime(boss.respawnHour)})</span><span class="name-text">${boss.name}</span>`;

        div.appendChild(checkbox);
        div.appendChild(label);
        list.appendChild(div);
    });
}

function toggleVisibility(id, isChecked) {
    if (isChecked) visibleIds.add(id); else visibleIds.delete(id);
    localStorage.setItem('ro_boss_visible_ids', JSON.stringify([...visibleIds]));
    if (currentSortType === 'checked-first') renderSidebar();
    renderGrid();
}

function toggleAll(state) {
    allBosses.forEach(b => {
        if (b.onSidebar !== false) {
            state ? visibleIds.add(b.id) : visibleIds.delete(b.id);
        }
    });
    localStorage.setItem('ro_boss_visible_ids', JSON.stringify([...visibleIds]));
    renderSidebar();
    renderGrid();
}

function scrollToTop() {
    const container = document.getElementById('card-container');
    container.scrollTop = 0;
}

function renderGrid() {
    const container = document.getElementById('card-container');
    const sortedList = getSortedBosses();
    
    const newTopBoss = sortedList.length > 0 ? sortedList[0] : null;
    if (newTopBoss && currentTopBossId !== newTopBoss.id) {
        currentTopBossId = newTopBoss.id;
        container.scrollTop = 0; 
    }

    const firstPositions = new Map();
    container.querySelectorAll('.boss-card').forEach(card => {
        firstPositions.set(card.dataset.id, card.getBoundingClientRect());
    });
    const existingCards = {};
    container.querySelectorAll('.boss-card').forEach(c => existingCards[c.dataset.id] = c);

    sortedList.forEach(boss => {
        if (!visibleIds.has(boss.id) || boss.onSidebar === false) {
            if (existingCards[boss.id]) existingCards[boss.id].remove();
            return;
        }
        let card = existingCards[boss.id];
        if (!card) {
            card = createCardElement(boss);
            existingCards[boss.id] = card;
        }
        updateCardVisuals(card, boss);
        container.appendChild(card);
    });

    container.querySelectorAll('.boss-card').forEach(card => {
        const first = firstPositions.get(card.dataset.id);
        if (first) {
            const last = card.getBoundingClientRect();
            const deltaX = first.left - last.left;
            const deltaY = first.top - last.top;
            if (deltaX !== 0 || deltaY !== 0) {
                card.animate([
                    { transform: `translate(${deltaX}px, ${deltaY}px)` },
                    { transform: 'none' }
                ], { duration: 400, easing: 'cubic-bezier(0.2, 0, 0.2, 1)', fill: 'both' });
            }
        }
    });
}

function updatePlaceholder(id, mode) {
    const hInput = document.getElementById(`h-${id}`);
    const mInput = document.getElementById(`m-${id}`);
    if (mode === 'remaining') {
        hInput.placeholder = "時";
        mInput.placeholder = "分";
    } else {
        hInput.placeholder = "點";
        mInput.placeholder = "分";
    }
}

function createCardElement(boss) {
    const card = document.createElement('div');
    card.className = 'boss-card';
    card.dataset.id = boss.id;
    card.id = `card-${boss.id}`;
    
    card.innerHTML = `
        <span class="border-anim"></span>
        <span class="border-anim"></span>
        <span class="border-anim"></span>
        <span class="border-anim"></span>

        <div class="card-header">
            <div class="header-left">
                <span class="boss-duration">[${formatRespawnTime(boss.respawnHour)}]</span>
                <span class="boss-name">${boss.name}</span>
                <span class="status-display" id="status-${boss.id}"></span>
            </div>
            <button class="btn-kill-header" onclick="killBoss(${boss.id})">擊殺</button>
        </div>
        
        <div class="timer-group">
            <div class="timer-display" id="timer-${boss.id}">--:--:--</div>
        </div>
        
        <div class="correction-area">
            <select id="mode-${boss.id}" class="mode-select" onchange="updatePlaceholder(${boss.id}, this.value)">
                <option value="remaining">剩餘</option>
                <option value="killed">擊殺</option>
            </select>
            <input type="number" id="h-${boss.id}" placeholder="時" min="0" max="23">
            <input type="number" id="m-${boss.id}" placeholder="分" min="0" max="59">
            <button class="btn-update" onclick="manualUpdate(${boss.id})">更新</button>
            <button class="btn-cancel" onclick="cancelTimer(${boss.id})">取消</button>
        </div>
    `;
    return card;
}

function getSortedBosses() {
    return [...allBosses].sort((a, b) => {
        const now = Date.now();
        const aActive = a.targetTime !== null;
        const bActive = b.targetTime !== null;
        if (aActive && bActive) return (a.targetTime - now) - (b.targetTime - now);
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        return allBosses.indexOf(a) - allBosses.indexOf(b);
    });
}

function tick() {
    const now = Date.now();
    let needsReorder = false;
    allBosses.forEach(boss => {
        if (boss.targetTime) {
            const diff = boss.targetTime - now;
            const timeoutLimit = -(boss.respawnHour * 3600000);
            
            if (diff <= timeoutLimit) {
                boss.targetTime = null;
                boss.respawnNotified = false; 
                boss.lastCountdownMin = null; 
                needsReorder = true;
            } 
            else if (diff > 0 && settings.notifyCountdown) {
                const remainingMin = Math.floor(diff / 60000);
                if (remainingMin < settings.notifyMin && boss.lastCountdownMin !== remainingMin) {
                    sendCountdownNotification(boss.name, remainingMin + 1);
                    boss.lastCountdownMin = remainingMin;
                }
            }
        }
    });
    if (needsReorder) {
        saveData();
        renderGrid(); 
    }
    document.querySelectorAll('.boss-card').forEach(card => {
        const id = parseInt(card.dataset.id);
        const boss = allBosses.find(b => b.id === id);
        if (boss) updateCardVisuals(card, boss, now);
    });
}

function updateCardVisuals(card, boss, now = Date.now()) {
    const timerEl = card.querySelector(`#timer-${boss.id}`);
    const statusEl = card.querySelector(`#status-${boss.id}`);
    
    if (!boss.targetTime) {
        statusEl.innerText = ""; 
        statusEl.style.display = 'none';
        timerEl.innerText = "--:--:--";
        timerEl.style.color = "#777";
        card.classList.remove('active', 'expired');
        return;
    }

    const diff = boss.targetTime - now;
    const endDate = new Date(boss.targetTime);
    
    const timeStr = `${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`;
    const statusStr = `[ ${timeStr} ]`;
    
    if (statusEl.innerText !== statusStr) {
        statusEl.innerText = statusStr;
        statusEl.style.display = 'inline'; 
    }

    if (diff <= 0) {
        if (timerEl.innerText !== "已重生!") {
            timerEl.innerText = "已重生!";
            timerEl.style.color = "#ff4444";
            card.classList.remove('active');
            card.classList.add('expired');
            
            if (settings.notifyRespawn && !boss.respawnNotified) {
                sendNotification(boss.name);
                boss.respawnNotified = true;
                saveData(); 
            }
        }
    } else {
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        const countDownStr = `${pad(h)}:${pad(m)}:${pad(s)}`;
        
        let floatStr = "";
        if (settings.useFloating && boss.floatSec > 0) {
            const floatMinStr = Math.floor(boss.floatSec / 60);
            const floatSecStr = boss.floatSec % 60;
            floatStr = ` + ${pad(floatMinStr)}:${pad(floatSecStr)}`;
        }
        
        const fullTimerText = `${countDownStr}${floatStr}`;
        
        if (timerEl.innerText !== fullTimerText) {
            timerEl.innerText = fullTimerText;
            timerEl.style.color = "var(--timer-color)"; 
        }
        if (!card.classList.contains('active')) {
            card.classList.add('active');
            card.classList.remove('expired');
        }
    }
}

function pad(n) { return n < 10 ? '0'+n : n; }

function sendNotification(bossName) {
    if (settings.notifyRespawn && Notification.permission === "granted") {
        const n = new Notification("BOSS重生提醒", { 
            body: `${bossName} 已經重生了！`, 
            icon: "",
            requireInteraction: true 
        });
    }
}

function sendCountdownNotification(bossName, min) {
    if (Notification.permission === "granted") {
        const n = new Notification("BOSS倒數提醒", { body: `${bossName} 將在 ${min} 分鐘後重生` });
        setTimeout(() => n.close(), 3000);
    }
}

function killBoss(id) {
    const boss = allBosses.find(b => b.id === id);
    if (boss) {
        boss.targetTime = Date.now() + (boss.respawnHour * 3600000);
        boss.floatSec = settings.useFloating ? (settings.floatMin * 60) : 0; 
        boss.respawnNotified = false; 
        boss.lastCountdownMin = null;
        saveData();
        renderGrid();
        scrollToTop(); 
    }
}

function cancelTimer(id) {
    const boss = allBosses.find(b => b.id === id);
    if (boss) {
        boss.targetTime = null;
        boss.floatSec = 0;
        boss.respawnNotified = false;
        boss.lastCountdownMin = null;
        saveData();
        renderGrid();
        scrollToTop(); 
    }
}

function manualUpdate(id) {
    const boss = allBosses.find(b => b.id === id);
    const mode = document.getElementById(`mode-${id}`).value;
    const hInput = document.getElementById(`h-${id}`);
    const mInput = document.getElementById(`m-${id}`);
    
    let h = parseInt(hInput.value);
    let m = parseInt(mInput.value);
    if (isNaN(h)) h = 0;
    if (isNaN(m)) m = 0;
    const isEmpty = hInput.value === "" && mInput.value === "";

    if (boss) {
        if (isEmpty && h === 0 && m === 0) {
            boss.targetTime = null;
        } else {
            if (mode === 'remaining') {
                boss.targetTime = Date.now() + (h * 3600000) + (m * 60000) + 60000;
                boss.floatSec = 0;
            } else {
                const now = new Date();
                let killTime = new Date();
                killTime.setHours(h, m, 0, 0);
                if (killTime > now) {
                    killTime.setDate(killTime.getDate() - 1);
                }
                boss.targetTime = killTime.getTime() + (boss.respawnHour * 3600000);
                boss.floatSec = settings.useFloating ? (settings.floatMin * 60) : 0;
            }
        }
        boss.respawnNotified = false; 
        boss.lastCountdownMin = null;
        hInput.value = '';
        mInput.value = '';
        saveData();
        renderGrid();
        scrollToTop(); 
    }
}

function openSettings() {
    document.getElementById('settings-modal').style.display = 'flex';
    renderManageList();
}
function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }

function addNewMonster() {
    const name = document.getElementById('new-name').value.trim();
    const timeStr = document.getElementById('new-time').value;
    const minStr = document.getElementById('new-time-min').value;
    
    const hour = parseFloat(timeStr) || 0;
    const min = parseFloat(minStr) || 0;

    if (!name) {
        alert("請輸入魔物名稱！");
        return;
    }
    if (timeStr === "" && minStr === "") {
        alert("請輸入重生時間 (小時或分鐘)！");
        return;
    }
    if (allBosses.some(b => b.name === name)) {
        alert("該魔物名稱已存在！");
        return;
    }

    const totalHours = hour + (min / 60);

    const newId = allBosses.length > 0 ? Math.max(...allBosses.map(b => b.id)) + 1 : 1;
    allBosses.push({ id: newId, name: name, respawnHour: totalHours, targetTime: null, floatSec: 0, onSidebar: true });
    visibleIds.add(newId);
    saveData();
    localStorage.setItem('ro_boss_visible_ids', JSON.stringify([...visibleIds]));
    
    document.getElementById('new-name').value = '';
    document.getElementById('new-time').value = '';
    document.getElementById('new-time-min').value = '';
    
    renderManageList();
    renderSidebar();
    renderGrid();
    scrollToTop();
}

function deleteMonster(index) {
    if(confirm(`確定要刪除 ${allBosses[index].name} 嗎？`)) {
        allBosses.splice(index, 1);
        saveData();
        renderManageList();
        renderSidebar();
        renderGrid();
    }
}

function toggleBossInSidebar(index) {
    allBosses[index].onSidebar = !allBosses[index].onSidebar;
    
    if (!allBosses[index].onSidebar) {
        visibleIds.delete(allBosses[index].id);
        localStorage.setItem('ro_boss_visible_ids', JSON.stringify([...visibleIds]));
    }
    
    saveData();
    renderManageList(); 
    renderSidebar();    
    renderGrid();       
}

function renderManageList() {
    const div = document.getElementById('manage-list-container');
    div.innerHTML = '';
    allBosses.forEach((boss, index) => {
        const item = document.createElement('div');
        item.className = 'manage-list-item';
        item.draggable = true;
        item.dataset.index = index;
        
        item.innerHTML = `
            <div class="manage-left">
                <input type="checkbox" class="sidebar-visibility-chk" 
                       ${boss.onSidebar !== false ? 'checked' : ''} 
                       onclick="toggleBossInSidebar(${index})" title="顯示於側邊欄">
                <span>${boss.name} <small style="color:#888;">(${formatRespawnTime(boss.respawnHour)})</small></span>
            </div>
            <div class="manage-controls">
                <button onclick="deleteMonster(${index})" style="background:#f44336;">✕</button>
            </div>
        `;
        
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragend', handleDragEnd);
        div.appendChild(item);
    });
}

let dragSrcIndex = null;
function handleDragStart(e) { this.classList.add('dragging'); dragSrcIndex = Number(this.dataset.index); e.dataTransfer.effectAllowed = 'move'; }
function handleDragOver(e) { if (e.preventDefault) e.preventDefault(); this.classList.add('drag-over'); e.dataTransfer.dropEffect = 'move'; return false; }
function handleDrop(e) {
    if (e.stopPropagation) e.stopPropagation();
    const dragDestIndex = Number(this.dataset.index);
    if (dragSrcIndex !== dragDestIndex) {
        const movedItem = allBosses[dragSrcIndex];
        allBosses.splice(dragSrcIndex, 1);
        allBosses.splice(dragDestIndex, 0, movedItem);
        saveData();
        renderManageList();
        renderSidebar();
        renderGrid();
    }
    return false;
}
function handleDragEnd(e) { this.classList.remove('dragging'); document.querySelectorAll('.manage-list-item').forEach(item => item.classList.remove('drag-over')); }

function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allBosses, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = "ro_boss_list.json";
    a.click();
}

// [修改] 匯入合併邏輯：名稱相同更新時間
function importData(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const json = JSON.parse(e.target.result);
            if (!Array.isArray(json)) throw new Error("檔案格式錯誤");
            
            let addedCount = 0;
            let updatedCount = 0;
            let maxId = allBosses.length > 0 ? Math.max(...allBosses.map(b => b.id)) : 0;

            json.forEach((item) => {
                if (item.name && item.respawnHour !== undefined) {
                    const existing = allBosses.find(b => b.name === item.name);
                    if (existing) {
                        // 更新
                        if (existing.respawnHour !== Number(item.respawnHour)) {
                            existing.respawnHour = Number(item.respawnHour);
                            updatedCount++;
                        }
                    } else {
                        // 新增
                        maxId++;
                        allBosses.push({
                            id: maxId,
                            name: item.name,
                            respawnHour: Number(item.respawnHour),
                            targetTime: null, 
                            floatSec: 0,
                            onSidebar: true
                        });
                        visibleIds.add(maxId);
                        addedCount++;
                    }
                }
            });

            if (confirm(`匯入完成！\n新增：${addedCount} 筆\n更新時間：${updatedCount} 筆`)) {
                saveData();
                localStorage.setItem('ro_boss_visible_ids', JSON.stringify([...visibleIds]));
                renderSidebar();
                renderGrid();
                renderManageList();
            }
        } catch (err) { alert("匯入失敗：" + err.message); } finally { input.value = ''; }
    };
    reader.readAsText(file);
}

function toggleTheme() { settings.lightMode = document.getElementById('chk-theme').checked; applyTheme(); saveSettings(); }
function applyTheme() { if (settings.lightMode) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', 'dark'); }

window.addEventListener('resize', updateToggleButtonIcon);

init();
