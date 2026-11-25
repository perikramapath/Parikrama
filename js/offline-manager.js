// =========================================================
// PARIKRAMAPATH - AUTOMATIC OFFLINE MANAGER (INDEXEDDB + TILES)
// =========================================================

window.ParikramaOffline = (function() {
    const DB_NAME = 'ParikramapathOfflineDB';
    const DB_VERSION = 1;
    const STORE_YATRAS = 'yatras_pack';
    const STORE_OUTBOX = 'offline_outbox';
    const TILE_CACHE_NAME = 'parikrama-map-tiles-v1';

    let dbInstance = null;
    let isPreCachingTiles = false;

    function openDB() {
        return new Promise((resolve, reject) => {
            if (dbInstance) return resolve(dbInstance);
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_YATRAS)) {
                    db.createObjectStore(STORE_YATRAS, { keyPath: 'yatra_id' });
                }
                if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
                    db.createObjectStore(STORE_OUTBOX, { keyPath: 'id', autoIncrement: true });
                }
            };
            req.onsuccess = (e) => {
                dbInstance = e.target.result;
                resolve(dbInstance);
            };
            req.onerror = (e) => reject(e.target.error);
        });
    }

    async function saveYatraOfflinePack(yatraObj, padavsList, routesList, aartiList = []) {
        if (!yatraObj || !yatraObj.id) return;
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_YATRAS, 'readwrite');
            const store = tx.objectStore(STORE_YATRAS);
            const pack = {
                yatra_id: String(yatraObj.id),
                slug: (yatraObj.slug || '').toLowerCase(),
                yatra: yatraObj,
                padavs: Array.isArray(padavsList) ? padavsList : [],
                routes: Array.isArray(routesList) ? routesList : [],
                aartis: Array.isArray(aartiList) ? aartiList : [],
                saved_at: new Date().toISOString()
            };
            store.put(pack);
            updateOfflineStatusBadge('cached', yatraObj.name_hi || yatraObj.name);
            preCacheYatraMapTiles(padavsList, routesList);
        } catch (err) {
            console.warn('Offline save error:', err);
        }
    }

    async function getYatraOfflinePack(yatraIdOrSlug) {
        try {
            const db = await openDB();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE_YATRAS, 'readonly');
                const store = tx.objectStore(STORE_YATRAS);
                const req = store.getAll();
                req.onsuccess = () => {
                    const all = req.result || [];
                    const key = String(yatraIdOrSlug || '').toLowerCase();
                    const match = all.find(item =>
                        String(item.yatra_id).toLowerCase() === key ||
                        (item.slug && item.slug === key)
                    );
                    resolve(match || null);
                };
                req.onerror = () => resolve(null);
            });
        } catch (e) {
            return null;
        }
    }

    async function getAllSavedYatraPacks() {
        try {
            const db = await openDB();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE_YATRAS, 'readonly');
                const req = tx.objectStore(STORE_YATRAS).getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            });
        } catch (e) {
            return [];
        }
    }

    // Lat/Lng ko OSM Tile X/Y me badalne ka formula
    function latLngToTile(lat, lng, zoom) {
        const x = Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
        const latRad = (lat * Math.PI) / 180;
        const y = Math.floor(
            ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
            Math.pow(2, zoom)
        );
        return { x, y, z: zoom };
    }

    // Background me Yatra ke padavs aur routes ke aas-paas ke map tiles auto-cache karein
    async function preCacheYatraMapTiles(padavsList, routesList) {
        if (!navigator.onLine || isPreCachingTiles || !('caches' in window)) return;
        isPreCachingTiles = true;

        try {
            const cache = await caches.open(TILE_CACHE_NAME);
            const points = [];

            (padavsList || []).slice(0, 60).forEach(p => {
                if (p.lat && p.lng) points.push([parseFloat(p.lat), parseFloat(p.lng)]);
            });

            (routesList || []).forEach(r => {
                if (Array.isArray(r.coordinates)) {
                    for (let i = 0; i < r.coordinates.length; i += 8) {
                        points.push(r.coordinates[i]);
                    }
                }
            });

            const tileUrls = new Set();
            const zoomLevels = [12, 13, 14];

            points.forEach(([lat, lng]) => {
                zoomLevels.forEach(z => {
                    const t = latLngToTile(lat, lng, z);
                    for (let dx = -1; dx <= 1; dx++) {
                        for (let dy = -1; dy <= 1; dy++) {
                            tileUrls.add(`https://tile.openstreetmap.org/${z}/${t.x + dx}/${t.y + dy}.png`);
                        }
                    }
                });
            });

            const urlsArr = Array.from(tileUrls).slice(0, 280); // Max ~280 tiles (~6-10 MB safe limit)
            let downloaded = 0;

            for (const url of urlsArr) {
                if (!navigator.onLine) break;
                const existing = await cache.match(url);
                if (!existing) {
                    try {
                        const resp = await fetch(url, { mode: 'cors' });
                        if (resp && resp.ok) {
                            await cache.put(url, resp);
                            downloaded++;
                        }
                    } catch (e) {}
                }
            }

            if (downloaded > 0) {
                updateOfflineStatusBadge('ready');
            }
        } finally {
            isPreCachingTiles = false;
        }
    }

    // Offline Action Outbox (Visited / New Padav jab network na ho)
    async function queueOfflineAction(actionType, payload) {
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_OUTBOX, 'readwrite');
            tx.objectStore(STORE_OUTBOX).add({
                action_type: actionType,
                payload,
                created_at: new Date().toISOString()
            });
            updateOfflineStatusBadge('queued');
        } catch (e) {}
    }

    async function syncOfflineOutbox() {
        if (!navigator.onLine || typeof supabaseClient === 'undefined') return;
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_OUTBOX, 'readonly');
            const items = await new Promise(res => {
                const r = tx.objectStore(STORE_OUTBOX).getAll();
                r.onsuccess = () => res(r.result || []);
                r.onerror = () => res([]);
            });

            if (items.length === 0) return;

            for (const item of items) {
                try {
                    if (item.action_type === 'add_padav') {
                        await supabaseClient.from('padavs').insert([item.payload]);
                    } else if (item.action_type === 'update_padav' && item.payload.id) {
                        const { id, ...rest } = item.payload;
                        await supabaseClient.from('padavs').update(rest).eq('id', id);
                    }
                    const delTx = db.transaction(STORE_OUTBOX, 'readwrite');
                    delTx.objectStore(STORE_OUTBOX).delete(item.id);
                } catch (e) {}
            }
            updateOfflineStatusBadge('synced');
        } catch (e) {}
    }

    // Battery Saver Mode toggle
    function isBatterySaverEnabled() {
        return localStorage.getItem('parikrama_battery_saver') === '1';
    }

    function toggleBatterySaver() {
        const next = !isBatterySaverEnabled();
        localStorage.setItem('parikrama_battery_saver', next ? '1' : '0');
        const btn = document.getElementById('batterySaverMenuBtn');
        if (btn) {
            btn.innerText = next ? '🔋 बैटरी सेवर: चालू (ON)' : '🔋 बैटरी सेवर GPS: बंद';
            btn.style.background = next ? '#e8f5e9' : '';
        }
        alert(next
            ? '🔋 बैटरी सेवर GPS चालू हो गया है। अब जंगल/पहाड़ में बैटरी बचाने के लिए GPS हर 20 मीटर पर अपडेट होगा।'
            : '⚡ सामान्य हाई-फ़्रीक्वेंसी GPS मोड चालू है।'
        );
    }

    // Offline Journey Diary Modal Renderer
    async function openOfflineJourneyDiary() {
        const bodyEl = document.getElementById('offlineDiaryBody');
        if (!bodyEl) return;

        const yatra = window.activeYatra;
        const padavs = window.activeYatraPadavs || [];
        const visitedSet = (window.ParikramaVisited && typeof window.ParikramaVisited.getVisitedSet === 'function')
            ? window.ParikramaVisited.getVisitedSet()
            : (window.passedPadavIds || new Set());

        const completedPadavs = padavs.filter(p => visitedSet.has(p.id) || (window.passedPadavIds && window.passedPadavIds.has(p.id)));
        const remainingPadavs = padavs.filter(p => !visitedSet.has(p.id) && !(window.passedPadavIds && window.passedPadavIds.has(p.id)));

        const savedPacks = await getAllSavedYatraPacks();

        let html = `
            <div style="background:${navigator.onLine ? '#e8f5e9' : '#fff3e0'}; padding:10px; border-radius:8px; margin-bottom:10px; border-left:4px solid ${navigator.onLine ? '#2e7d32' : '#ef6c00'};">
                <b>${navigator.onLine ? '🟢 ऑनलाइन (Live + Offline Backup Ready)' : '🟠 ऑफ़लाइन मोड (बिना नेटवर्क के काम कर रहा है)'}</b><br>
                <small style="color:#555;">फोन में सुरक्षित यात्राएं: <b>${savedPacks.length}</b></small>
            </div>
        `;

        if (yatra) {
            html += `
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px; text-align:center;">
                    <div style="background:#f1f8e9; padding:10px; border-radius:8px; border:1px solid #c5e1a5;">
                        <div style="font-size:20px; font-weight:bold; color:#2e7d32;">${completedPadavs.length}</div>
                        <div style="font-size:11.5px; color:#333;">✅ पूर्ण किए गए पड़ाव</div>
                    </div>
                    <div style="background:#fff8e1; padding:10px; border-radius:8px; border:1px solid #ffe082;">
                        <div style="font-size:20px; font-weight:bold; color:#e65100;">${remainingPadavs.length}</div>
                        <div style="font-size:11.5px; color:#333;">🚩 शेष आगे के पड़ाव</div>
                    </div>
                </div>
            `;

            if (completedPadavs.length > 0) {
                html += `<h4 style="margin:6px 0; color:#2e7d32; font-size:13.5px;">✅ पूर्ण पड़ाव सूची:</h4><ul style="margin:0 0 10px 18px; padding:0; font-size:12.5px;">`;
                completedPadavs.forEach(cp => {
                    html += `<li style="margin-bottom:4px;"><b>${cp.name}</b> (${cp.sub_route || ''})</li>`;
                });
                html += `</ul>`;
            }
        }

        if (savedPacks.length > 0) {
            html += `<h4 style="margin:8px 0 6px 0; color:#1565c0; font-size:13.5px;">📥 फोन मेमोरी में सुरक्षित (Offline Ready) यात्राएं:</h4>`;
            savedPacks.forEach(sp => {
                const dt = sp.saved_at ? new Date(sp.saved_at).toLocaleDateString('hi-IN') : '';
                html += `
                    <div style="background:#f5f5f5; padding:8px; border-radius:6px; margin-bottom:6px; font-size:12px; display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <b>🕉️ ${sp.yatra?.name_hi || sp.yatra?.name}</b><br>
                            <small style="color:#666;">${(sp.padavs || []).length} पड़ाव • अपडेट: ${dt}</small>
                        </div>
                        <span style="background:#2e7d32; color:white; padding:2px 7px; border-radius:10px; font-size:10.5px;">Saved</span>
                    </div>
                `;
            });
        }

        bodyEl.innerHTML = html;
        if (typeof showModal === 'function') showModal('offlineDiaryModal');
    }

    function updateOfflineStatusBadge(state, label = '') {
        const badge = document.getElementById('offlineStatusPill');
        if (!badge) return;

        if (!navigator.onLine) {
            badge.style.background = '#e65100';
            badge.innerText = '🟠 Offline Mode';
            return;
        }

        if (state === 'queued') {
            badge.style.background = '#f57c00';
            badge.innerText = '⏳ Sync Pending';
        } else if (state === 'cached' || state === 'ready' || state === 'synced') {
            badge.style.background = '#1b5e20';
            badge.innerText = '🟢 Offline Ready';
        } else {
            badge.style.background = '#2e7d32';
            badge.innerText = '🟢 Online';
        }
    }

    window.addEventListener('online', () => {
        updateOfflineStatusBadge('online');
        syncOfflineOutbox();
    });
    window.addEventListener('offline', () => {
        updateOfflineStatusBadge('offline');
    });

    return {
        saveYatraOfflinePack,
        getYatraOfflinePack,
        getAllSavedYatraPacks,
        queueOfflineAction,
        syncOfflineOutbox,
        isBatterySaverEnabled,
        toggleBatterySaver,
        openOfflineJourneyDiary,
        updateOfflineStatusBadge
    };
})();