// =========================================================
// PARIKRAMAPATH - AUTOMATIC OFFLINE MANAGER + DAY-WISE EDITABLE YATRA DIARY
// =========================================================

window.ParikramaOffline = (function() {
    const DB_NAME = 'ParikramapathOfflineDB';
    const DB_VERSION = 2;
    const STORE_YATRAS = 'yatras_pack';
    const STORE_OUTBOX = 'offline_outbox';
    const STORE_DIARIES = 'yatra_day_diaries';
    const TILE_CACHE_NAME = 'parikrama-map-tiles-v1';

    let dbInstance = null;
    let isPreCachingTiles = false;
    let lastAutoGpsPt = null;
    let lastAutoGpsDate = null;

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
                if (!db.objectStoreNames.contains(STORE_DIARIES)) {
                    db.createObjectStore(STORE_DIARIES, { keyPath: 'diary_key' });
                }
            };
            req.onsuccess = (e) => {
                dbInstance = e.target.result;
                resolve(dbInstance);
            };
            req.onerror = (e) => reject(e.target.error);
        });
    }

    function getTodayDateStr() {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    function getNowTimeStr() {
        return new Date().toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    }

    function calcMeters(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // =========================================================
    // 1. YATRA OFFLINE PACK (PADAVS + ROUTES + MAP TILES)
    // =========================================================
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

    function latLngToTile(lat, lng, zoom) {
        const x = Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
        const latRad = (lat * Math.PI) / 180;
        const y = Math.floor(
            ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
            Math.pow(2, zoom)
        );
        return { x, y, z: zoom };
    }

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

            const urlsArr = Array.from(tileUrls).slice(0, 280);
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

    // =========================================================
    // 2. DAY-WISE AUTOMATIC + EDITABLE JOURNEY DIARY (DATE + TIME)
    // =========================================================
    async function getDiariesForYatra(yatraId) {
        try {
            const db = await openDB();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE_DIARIES, 'readonly');
                const req = tx.objectStore(STORE_DIARIES).getAll();
                req.onsuccess = () => {
                    const all = req.result || [];
                    const filtered = all
                        .filter(d => String(d.yatra_id) === String(yatraId))
                        .sort((a, b) => (a.day_number || 1) - (b.day_number || 1));
                    resolve(filtered);
                };
                req.onerror = () => resolve([]);
            });
        } catch (e) {
            return [];
        }
    }

    async function saveDiaryEntryRecord(entryObj) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_DIARIES, 'readwrite');
            tx.objectStore(STORE_DIARIES).put(entryObj);
            tx.oncomplete = () => resolve(entryObj);
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async function ensureTodayDiaryEntry(yatraObj, fallbackStartName = '') {
        if (!yatraObj || !yatraObj.id) return null;
        const today = getTodayDateStr();
        const key = `${yatraObj.id}_${today}`;
        const existingList = await getDiariesForYatra(yatraObj.id);
        let todayRec = existingList.find(d => d.diary_key === key);

        if (!todayRec) {
            const prevDay = existingList.length > 0 ? existingList[existingList.length - 1] : null;
            const autoStart = fallbackStartName ||
                (prevDay && prevDay.night_halt ? prevDay.night_halt : '') ||
                (window.selectedStartPadav ? window.selectedStartPadav.name : '');

            todayRec = {
                diary_key: key,
                yatra_id: String(yatraObj.id),
                yatra_name: yatraObj.name_hi || yatraObj.name,
                day_number: existingList.length + 1,
                diary_date: today,
                start_time: getNowTimeStr(),
                halt_time: '',
                start_place: autoStart,
                night_halt: '',
                visited_stops: [],
                distance_km: 0,
                experience_text: '',
                photo_urls: [],
                is_manually_edited: false,
                publish_status: 'private',
                updated_at: new Date().toISOString()
            };
            await saveDiaryEntryRecord(todayRec);
        }
        return todayRec;
    }

    // Automatic GPS distance & evening Night-Halt tracker (respects manual user edits)
    async function recordLiveGpsForDiary(lat, lng) {
        const yatra = window.activeYatra;
        if (!yatra || !yatra.id) return;

        const today = getTodayDateStr();
        const entry = await ensureTodayDiaryEntry(yatra);
        if (!entry) return;

        let changed = false;

        if (lastAutoGpsPt && lastAutoGpsDate === today && !entry.is_manually_edited) {
            const movedMeters = calcMeters(lastAutoGpsPt[0], lastAutoGpsPt[1], lat, lng);
            if (movedMeters >= 25 && movedMeters <= 500) {
                const addedKm = movedMeters / 1000;
                entry.distance_km = parseFloat(((parseFloat(entry.distance_km) || 0) + addedKm).toFixed(2));
                changed = true;
            }
        }
        lastAutoGpsPt = [lat, lng];
        lastAutoGpsDate = today;

        // Shaam 6:30 PM ke baad agar kisi padav ke 450m ke andar hain to auto Night Halt set karein
        const hourNow = new Date().getHours();
        const minNow = new Date().getMinutes();
        const isEvening = (hourNow > 18) || (hourNow === 18 && minNow >= 30);

        if (isEvening && !entry.is_manually_edited && Array.isArray(window.activeYatraPadavs)) {
            let nearestPadav = null;
            let minDist = 450;
            for (const p of window.activeYatraPadavs) {
                if (!p.lat || !p.lng) continue;
                const d = calcMeters(lat, lng, parseFloat(p.lat), parseFloat(p.lng));
                if (d <= minDist) {
                    minDist = d;
                    nearestPadav = p;
                }
            }
            if (nearestPadav && entry.night_halt !== nearestPadav.name) {
                entry.night_halt = nearestPadav.name;
                entry.halt_time = getNowTimeStr();
                changed = true;
            }
        }

        if (changed) {
            entry.updated_at = new Date().toISOString();
            await saveDiaryEntryRecord(entry);
        }
    }

    // Jab yatri kisi padav ko Visited / Night Halt mark kare
    async function recordPadavStopInDiary(padavObj, markAsNightHalt = false) {
        const yatra = window.activeYatra;
        if (!yatra || !padavObj) return;
        const entry = await ensureTodayDiaryEntry(yatra, padavObj.name);
        if (!entry) return;

        const nowTime = getNowTimeStr();
        if (!entry.start_place) {
            entry.start_place = padavObj.name;
            entry.start_time = nowTime;
        }

        const stops = Array.isArray(entry.visited_stops) ? entry.visited_stops : [];
        if (!stops.some(s => String(s.id) === String(padavObj.id))) {
            stops.push({ id: padavObj.id, name: padavObj.name, time: nowTime });
            entry.visited_stops = stops;
        }

        if (markAsNightHalt || !entry.is_manually_edited) {
            entry.night_halt = padavObj.name;
            entry.halt_time = nowTime;
        }

        entry.updated_at = new Date().toISOString();
        await saveDiaryEntryRecord(entry);
    }

    // =========================================================
    // 3. OFFLINE ACTION OUTBOX (PADAVS + DIARY PUBLIC SYNC)
    // =========================================================
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
                    } else if (item.action_type === 'publish_diary') {
                        await submitDiaryPayloadToSupabase(item.payload);
                    }
                    const delTx = db.transaction(STORE_OUTBOX, 'readwrite');
                    delTx.objectStore(STORE_OUTBOX).delete(item.id);
                } catch (e) {}
            }
            updateOfflineStatusBadge('synced');
        } catch (e) {}
    }

    async function submitDiaryPayloadToSupabase(p) {
        const uploadedUrls = Array.isArray(p.photo_urls) ? [...p.photo_urls] : [];

        // Agar offline me pending base64/dataUrl photos hain to ImgBB par upload karein
        if (Array.isArray(p.pending_data_urls) && p.pending_data_urls.length > 0 && typeof window.uploadImageToImgBB === 'function') {
            for (const dataUrl of p.pending_data_urls) {
                try {
                    const res = await fetch(dataUrl);
                    const blob = await res.blob();
                    const file = new File([blob], `diary_${Date.now()}.jpg`, { type: 'image/jpeg' });
                    const url = await window.uploadImageToImgBB(file);
                    if (url) uploadedUrls.push(url);
                } catch (err) {}
            }
        }

        const row = {
            user_id: p.user_id || null,
            yatri_name: p.yatri_name,
            yatra_id: p.yatra_id,
            yatra_name: p.yatra_name,
            day_number: p.day_number,
            diary_date: p.diary_date,
            diary_time: p.diary_time,
            start_place: p.start_place,
            night_halt: p.night_halt,
            distance_km: p.distance_km,
            experience_text: p.experience_text,
            photo_urls: uploadedUrls.slice(0, 2),
            status: 'pending'
        };

        const { error } = await supabaseClient.from('yatra_diaries').insert([row]);
        if (error) throw error;
        return uploadedUrls.slice(0, 2);
    }

    // =========================================================
    // 4. BATTERY SAVER GPS TOGGLE
    // =========================================================
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

    // =========================================================
    // 5. DAY-WISE EDITABLE JOURNEY DIARY MODAL & IMGBB UPLOAD UI
    // =========================================================
    async function openOfflineJourneyDiary() {
        const bodyEl = document.getElementById('offlineDiaryBody');
        if (!bodyEl) return;

        const yatra = window.activeYatra;
        if (yatra) {
            await ensureTodayDiaryEntry(yatra);
        }

        const diaries = yatra ? await getDiariesForYatra(yatra.id) : [];
        const savedPacks = await getAllSavedYatraPacks();

        const totalKmWalked = diaries.reduce((sum, d) => sum + (parseFloat(d.distance_km) || 0), 0).toFixed(1);
        const firstDay = diaries[0];
        const lastDay = diaries[diaries.length - 1];

        let html = `
            <div style="background:${navigator.onLine ? '#e8f5e9' : '#fff3e0'}; padding:9px 11px; border-radius:8px; margin-bottom:10px; border-left:4px solid ${navigator.onLine ? '#2e7d32' : '#ef6c00'}; font-size:12px;">
                <b>${navigator.onLine ? '🟢 ऑनलाइन (Auto-Sync + Offline Safe)' : '🟠 ऑफ़लाइन मोड (बिना नेटवर्क के काम कर रहा है)'}</b><br>
                <span style="color:#555;">फोन में सुरक्षित यात्राएं: <b>${savedPacks.length}</b> • कुल दिन: <b>${diaries.length}</b> • कुल दूरी: <b>${totalKmWalked} km</b></span>
            </div>
        `;

        if (yatra && firstDay) {
            html += `
                <div style="background:#f1f8e9; padding:9px 11px; border-radius:8px; border:1px solid #c5e1a5; margin-bottom:12px; font-size:12px; line-height:1.6;">
                    <div><b>🚩 आरंभ (Start):</b> ${firstDay.start_place || '-'} <small style="color:#555;">(${firstDay.diary_date} • ${firstDay.start_time || ''})</small></div>
                    <div><b>🏁 वर्तमान / समापन:</b> ${(lastDay && (lastDay.night_halt || lastDay.start_place)) || '-'} <small style="color:#555;">(${lastDay ? lastDay.diary_date : ''} ${lastDay?.halt_time ? '• ' + lastDay.halt_time : ''})</small></div>
                </div>
            `;
        }

        // Day-wise cards (newest first for easy editing)
        if (diaries.length > 0) {
            html += `<h4 style="margin:6px 0 8px 0; color:#d84315; font-size:14px;">📅 दिन-वार यात्रा रिकॉर्ड (Day-wise Log):</h4>`;
            const reversed = [...diaries].reverse();

            reversed.forEach(d => {
                const photos = Array.isArray(d.photo_urls) ? d.photo_urls : [];
                const photosHtml = photos.length > 0
                    ? `<div style="display:flex; gap:6px; margin-top:6px;">${photos.map(u => `<img src="${u}" style="width:58px; height:58px; object-fit:cover; border-radius:6px; border:1px solid #ccc;">`).join('')}</div>`
                    : '';

                const statusBadge = d.publish_status === 'submitted'
                    ? `<span style="background:#e3f2fd; color:#1565c0; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:bold;">🌐 Admin Approval के लिए भेजा गया</span>`
                    : (d.publish_status === 'queued'
                        ? `<span style="background:#fff3e0; color:#e65100; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:bold;">⏳ नेटवर्क आने पर अपलोड होगा</span>`
                        : '');

                html += `
                    <div style="background:#ffffff; border:1px solid #ffe0b2; border-left:4px solid #ff9800; border-radius:8px; padding:10px; margin-bottom:9px; font-size:12.5px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <b style="color:#d84315; font-size:13.5px;">Day ${d.day_number} • 📅 ${d.diary_date}</b>
                            <button type="button" onclick="ParikramaOffline.openDiaryDayEditor('${d.diary_key}')" style="background:#ffc107; color:#000; border:none; padding:4px 9px; border-radius:5px; font-size:11.5px; font-weight:bold; cursor:pointer;">
                                ✏️ Edit / अनुभव लिखें
                            </button>
                        </div>
                        <div style="color:#333; line-height:1.55;">
                            <span>🚶 <b>प्रस्थान:</b> ${d.start_place || '-'} (${d.start_time || '--:--'})</span><br>
                            <span>🛌 <b>रात्रि विश्राम:</b> ${d.night_halt || 'अभी दर्ज नहीं'} ${d.halt_time ? `(${d.halt_time})` : ''}</span><br>
                            <span>📏 <b>चली गई दूरी:</b> <b style="color:#2e7d32;">${parseFloat(d.distance_km || 0).toFixed(1)} km</b></span>
                        </div>
                        ${d.experience_text ? `<p style="margin:6px 0 0 0; background:#fffdf7; padding:6px 8px; border-radius:5px; border:1px dashed #ffd54f; color:#222;">"${d.experience_text}"</p>` : ''}
                        ${photosHtml}
                        <div style="margin-top:5px;">${statusBadge}</div>
                    </div>
                `;
            });
        }

        // Inline Edit Form Container (Hidden until Edit clicked)
        html += `<div id="diaryDayEditorContainer" style="display:none; background:#f9fbe7; border:2px solid #8bc34a; border-radius:10px; padding:11px; margin-top:10px;"></div>`;

        bodyEl.innerHTML = html;
        if (typeof showModal === 'function') showModal('offlineDiaryModal');
    }

    async function openDiaryDayEditor(diaryKey) {
        const yatra = window.activeYatra;
        if (!yatra) return;
        const diaries = await getDiariesForYatra(yatra.id);
        const rec = diaries.find(d => d.diary_key === diaryKey);
        if (!rec) return;

        const editorBox = document.getElementById('diaryDayEditorContainer');
        if (!editorBox) return;

        const padavOptions = (window.activeYatraPadavs || [])
            .map(p => `<option value="${p.name}">`)
            .join('');

        const defaultName = (window.currentProfile && window.currentProfile.full_name)
            ? window.currentProfile.full_name
            : (localStorage.getItem('pp_diary_yatri_name') || '');

        editorBox.style.display = 'block';
        editorBox.innerHTML = `
            <h4 style="margin:0 0 8px 0; color:#1b5e20;">✏️ Day ${rec.day_number} संपादित करें (Date, Time व अनुभव)</h4>
            <datalist id="diaryPadavDatalist">${padavOptions}</datalist>

            <label style="font-size:11px; font-weight:bold; color:#333;">यात्री का नाम (पब्लिक डायरी हेतु):</label>
            <input type="text" id="editDiaryYatriName" value="${defaultName}" placeholder="जैसे: Santosh" class="form-input" style="font-size:12px; margin-bottom:6px;">

            <div style="display:flex; gap:6px; margin-bottom:6px;">
                <div style="flex:1;">
                    <label style="font-size:11px; font-weight:bold;">📅 तारीख (Date):</label>
                    <input type="date" id="editDiaryDate" value="${rec.diary_date || getTodayDateStr()}" class="form-input" style="margin:0; font-size:12px;">
                </div>
                <div style="width:115px;">
                    <label style="font-size:11px; font-weight:bold;">📏 दूरी (km):</label>
                    <input type="number" step="0.1" id="editDiaryKm" value="${rec.distance_km || 0}" class="form-input" style="margin:0; font-size:12px;">
                </div>
            </div>

            <div style="display:flex; gap:6px; margin-bottom:6px;">
                <div style="flex:1;">
                    <label style="font-size:11px; font-weight:bold;">🚶 कहाँ से चले (Start):</label>
                    <input type="text" list="diaryPadavDatalist" id="editDiaryStartPlace" value="${rec.start_place || ''}" placeholder="प्रारंभ स्थान" class="form-input" style="margin:0; font-size:12px;">
                </div>
                <div style="width:115px;">
                    <label style="font-size:11px; font-weight:bold;">🕒 प्रस्थान समय:</label>
                    <input type="text" id="editDiaryStartTime" value="${rec.start_time || getNowTimeStr()}" placeholder="06:30 AM" class="form-input" style="margin:0; font-size:12px;">
                </div>
            </div>

            <div style="display:flex; gap:6px; margin-bottom:6px;">
                <div style="flex:1;">
                    <label style="font-size:11px; font-weight:bold;">🛌 कहाँ रुके (Night Halt):</label>
                    <input type="text" list="diaryPadavDatalist" id="editDiaryNightHalt" value="${rec.night_halt || ''}" placeholder="रात्रि विश्राम स्थल" class="form-input" style="margin:0; font-size:12px;">
                </div>
                <div style="width:115px;">
                    <label style="font-size:11px; font-weight:bold;">🕒 रुकने का समय:</label>
                    <input type="text" id="editDiaryHaltTime" value="${rec.halt_time || getNowTimeStr()}" placeholder="06:45 PM" class="form-input" style="margin:0; font-size:12px;">
                </div>
            </div>

            <label style="font-size:11px; font-weight:bold;">📝 आज का अनुभव / यात्रा विवरण:</label>
            <textarea id="editDiaryExpText" rows="3" placeholder="आज का रास्ता, भोजन, आश्रम व्यवस्था व अपना अनुभव लिखें..." class="form-input" style="font-size:12px; margin-bottom:6px;">${rec.experience_text || ''}</textarea>

            <label style="font-size:11px; font-weight:bold; display:block; margin-bottom:4px;">
                📷 आज की 1 या 2 फोटो जोड़ें (अधिकतम 2 फोटो):
            </label>
            <input type="file" id="editDiaryPhotosInput" accept="image/*" multiple style="font-size:11.5px; margin-bottom:8px;">

            <label style="display:flex; align-items:center; gap:6px; background:#fff; padding:6px 8px; border-radius:6px; border:1px solid #c5e1a5; font-size:12px; margin-bottom:8px; cursor:pointer;">
                <input type="checkbox" id="chkPublishDiaryPublic" checked>
                <span>🌐 वेबसाइट पर सभी यात्रियों के लिए शेयर करें (Admin Approval के बाद दिखेगा)</span>
            </label>

            <div style="display:flex; gap:6px;">
                <button type="button" id="btnSaveDiaryDayEdit" onclick="ParikramaOffline.saveDiaryDayEdit('${rec.diary_key}')" style="flex:1; background:#2e7d32; color:#fff; border:none; padding:8px; border-radius:6px; font-weight:bold; font-size:12.5px; cursor:pointer;">
                    💾 सुरक्षित करें
                </button>
                <button type="button" onclick="document.getElementById('diaryDayEditorContainer').style.display='none'" style="background:#757575; color:#fff; border:none; padding:8px 12px; border-radius:6px; font-weight:bold; font-size:12px; cursor:pointer;">
                    रद्द करें
                </button>
            </div>
        `;
        editorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    async function saveDiaryDayEdit(diaryKey) {
        const yatra = window.activeYatra;
        if (!yatra) return;
        const diaries = await getDiariesForYatra(yatra.id);
        const rec = diaries.find(d => d.diary_key === diaryKey);
        if (!rec) return;

        const saveBtn = document.getElementById('btnSaveDiaryDayEdit');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerText = '⏳ सेव हो रहा है...';
        }

        const yatriName = (document.getElementById('editDiaryYatriName')?.value || '').trim() || 'परिक्रमावासी';
        localStorage.setItem('pp_diary_yatri_name', yatriName);

        rec.diary_date = document.getElementById('editDiaryDate')?.value || rec.diary_date;
        rec.distance_km = parseFloat(document.getElementById('editDiaryKm')?.value) || 0;
        rec.start_place = (document.getElementById('editDiaryStartPlace')?.value || '').trim();
        rec.start_time = (document.getElementById('editDiaryStartTime')?.value || '').trim();
        rec.night_halt = (document.getElementById('editDiaryNightHalt')?.value || '').trim();
        rec.halt_time = (document.getElementById('editDiaryHaltTime')?.value || '').trim();
        rec.experience_text = (document.getElementById('editDiaryExpText')?.value || '').trim();
        rec.is_manually_edited = true;
        rec.updated_at = new Date().toISOString();

        const fileInput = document.getElementById('editDiaryPhotosInput');
        const selectedFiles = fileInput && fileInput.files ? Array.from(fileInput.files).slice(0, 2) : [];
        const existingUrls = Array.isArray(rec.photo_urls) ? [...rec.photo_urls] : [];
        const pendingDataUrls = [];

        if (selectedFiles.length > 0) {
            for (const file of selectedFiles) {
                if (navigator.onLine && typeof window.uploadImageToImgBB === 'function') {
                    try {
                        const imgUrl = await window.uploadImageToImgBB(file);
                        if (imgUrl) existingUrls.push(imgUrl);
                    } catch (err) {
                        alert("⚠️ फोटो अपलोड त्रुटि: " + err.message);
                    }
                } else {
                    const dataUrl = await new Promise(res => {
                        const r = new FileReader();
                        r.onload = () => res(r.result);
                        r.readAsDataURL(file);
                    });
                    if (dataUrl) {
                        existingUrls.push(dataUrl);
                        pendingDataUrls.push(dataUrl);
                    }
                }
            }
            rec.photo_urls = existingUrls.slice(-2);
        }

        const shouldPublish = document.getElementById('chkPublishDiaryPublic')?.checked;
        if (shouldPublish) {
            const publicPayload = {
                user_id: window.currentUser ? window.currentUser.id : null,
                yatri_name: yatriName,
                yatra_id: String(yatra.id),
                yatra_name: yatra.name_hi || yatra.name,
                day_number: rec.day_number,
                diary_date: rec.diary_date,
                diary_time: `${rec.start_time || ''} - ${rec.halt_time || ''}`.trim(),
                start_place: rec.start_place,
                night_halt: rec.night_halt,
                distance_km: rec.distance_km,
                experience_text: rec.experience_text,
                photo_urls: rec.photo_urls.filter(u => /^https?:\/\//i.test(u)),
                pending_data_urls: pendingDataUrls
            };

            if (navigator.onLine) {
                try {
                    const finalUrls = await submitDiaryPayloadToSupabase(publicPayload);
                    if (finalUrls && finalUrls.length > 0) rec.photo_urls = finalUrls;
                    rec.publish_status = 'submitted';
                } catch (e) {
                    await queueOfflineAction('publish_diary', publicPayload);
                    rec.publish_status = 'queued';
                }
            } else {
                await queueOfflineAction('publish_diary', publicPayload);
                rec.publish_status = 'queued';
            }
        }

        await saveDiaryEntryRecord(rec);
        await openOfflineJourneyDiary();

        alert(shouldPublish
            ? (navigator.onLine
                ? '✅ आपकी Day ' + rec.day_number + ' डायरी सुरक्षित हो गई है और एडमिन अप्रूवल के लिए भेज दी गई है!'
                : '🟠 ऑफ़लाइन होने के कारण डायरी व फोटो फोन में सेव कर ली गई हैं। नेटवर्क आते ही अपने-आप अपलोड हो जाएंगी!')
            : '✅ आपकी Day ' + rec.day_number + ' डायरी फोन में सुरक्षित कर ली गई है!'
        );
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
        ensureTodayDiaryEntry,
        recordLiveGpsForDiary,
        recordPadavStopInDiary,
        openDiaryDayEditor,
        saveDiaryDayEdit,
        queueOfflineAction,
        syncOfflineOutbox,
        isBatterySaverEnabled,
        toggleBatterySaver,
        openOfflineJourneyDiary,
        updateOfflineStatusBadge
    };
})();