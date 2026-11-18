// =========================================================
// PARIKRAMAPATH - LIVE GPS ROUTE HUD, AUTO-ADVANCE & BRANCH PRUNING
// =========================================================

window.map = null;
window.padavLayer = L.layerGroup();
window.routeLayer = L.layerGroup();
window.autoPadavLinkLayer = L.layerGroup();
window.adminLiveYatrisLayer = L.layerGroup();
window.activeYatraPadavs = [];
window.activeCustomRoutes = [];
window.padavMarkersMap = {};
window.adminYatriMarkersMap = {};
window.osrmGeometryCache = {};
window.osrmDistanceCache = {};
window.focusedOriginPadavId = null;

// Live Yatri GPS Tracking, 500m Auto-Hide & Branch Selection
window.yatriLiveCoords = null;
window.yatriLiveMarker = null;
window.passedPadavIds = new Set();
window.abandonedBranchIds = new Set();
window.activeLiveNavLeg = null;
window.isPickingEditLocation = false;
window.hasCenteredOnLiveGps = false;
window.lastDbLocationPingMs = 0;
window.lastLiveNavCalcMs = 0;
window.adminYatriRealtimeSub = null;
window.adminVisitorRealtimeSub = null;

function getOrCreateGuestVisitorId() {
    try {
        let vid = localStorage.getItem('parikrama_guest_visitor_id');
        if (!vid) {
            vid = 'guest_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now();
            localStorage.setItem('parikrama_guest_visitor_id', vid);
        }
        return vid;
    } catch (e) {
        return 'guest_temp_' + Date.now();
    }
}

// ---------------------------------------------------------
// STARTING POINT PERSISTENCE (100% LOCALSTORAGE PER YATRA)
// ---------------------------------------------------------
function getSavedStartPadavKey(yatra) {
    const slug = (yatra?.slug || yatra?.id || 'default').toString().toLowerCase().trim();
    return `parikrama_start_padav_${slug}`;
}

function saveUserStartPadavLocal(yatra, padavObj) {
    if (!yatra || !padavObj) return;
    try {
        localStorage.setItem(getSavedStartPadavKey(yatra), JSON.stringify({
            id: padavObj.id,
            name: padavObj.name,
            lat: padavObj.lat,
            lng: padavObj.lng
        }));
    } catch (e) {}
}

function getSavedUserStartPadavLocal(yatra) {
    if (!yatra) return null;
    try {
        const raw = localStorage.getItem(getSavedStartPadavKey(yatra));
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

window.setManualStartPadav = function(padavId) {
    if (!window.activeYatra) return;
    const found = (window.activeYatraPadavs || []).find(p => String(p.id) === String(padavId));
    if (!found) return;

    window.selectedStartPadav = found;
    window.focusedOriginPadavId = found.id;
    window.passedPadavIds.delete(found.id);
    window.abandonedBranchIds.delete(found.id);
    saveUserStartPadavLocal(window.activeYatra, found);
    renderIsolatedPadavs(window.activeYatraPadavs);
    alert(`🚩 "${found.name}" को आपका प्रारंभिक पड़ाव सेट कर दिया गया है।`);
};

// ---------------------------------------------------------
// FUNCTION GROUP 1: MANUAL POINT-TO-POINT LINE DRAWING
// ---------------------------------------------------------
window.isManualDrawing = false;
window.manualDrawnPoints = [];
window.manualHistoryStack = [];
window.manualTempLine = null;

// ---------------------------------------------------------
// FUNCTION GROUP 2: ALAG GPS FOLLOW RECORDER (ANTI-JUMP)
// ---------------------------------------------------------
window.isGpsFollowActive = false;
window.isGpsPaused = false;
window.gpsWatchId = null;
window.gpsRecordedPoints = [];
window.gpsTempLine = null;
window.lastValidGpsPt = null;
window.lastValidGpsTime = 0;

function safeT(key, fallback) {
    try {
        if (typeof t === 'function') return t(key) || fallback;
    } catch (e) {}
    return fallback;
}

function getDistanceInMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isUserAdminOrMod() {
    if (!window.currentProfile || !window.currentProfile.role) return false;
    const r = window.currentProfile.role.toLowerCase().trim().replace(/\s+/g, '_');
    return (r === 'super_admin' || r === 'admin' || r === 'moderator');
}

function isStrictSuperOrAdmin() {
    if (!window.currentProfile || !window.currentProfile.role) return false;
    const r = window.currentProfile.role.toLowerCase().trim().replace(/\s+/g, '_');
    return (r === 'super_admin' || r === 'admin');
}

// =========================================================
// CUSTOM ROUTE & REAL ROAD KM CALCULATOR (ZERO AIR DISTANCE)
// =========================================================
function hasCustomDrawnRouteBetween(lat1, lng1, lat2, lng2) {
    const routes = window.activeCustomRoutes || [];
    const snapToleranceMeters = 450;

    for (const r of routes) {
        const coords = r.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) continue;

        let nearStart = false;
        let nearEnd = false;

        for (let i = 0; i < coords.length; i++) {
            const pt = coords[i];
            if (!Array.isArray(pt) || pt.length < 2) continue;

            if (!nearStart && getDistanceInMeters(lat1, lng1, pt[0], pt[1]) <= snapToleranceMeters) {
                nearStart = true;
            }
            if (!nearEnd && getDistanceInMeters(lat2, lng2, pt[0], pt[1]) <= snapToleranceMeters) {
                nearEnd = true;
            }
            if (nearStart && nearEnd) return true;
        }
    }
    return false;
}

function getCustomRouteKmBetween(lat1, lng1, lat2, lng2) {
    const routes = window.activeCustomRoutes || [];
    const snapToleranceMeters = 450;

    for (const r of routes) {
        const coords = r.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) continue;

        let startIdx = -1;
        let endIdx = -1;
        let bestStartDist = snapToleranceMeters;
        let bestEndDist = snapToleranceMeters;

        for (let i = 0; i < coords.length; i++) {
            const pt = coords[i];
            if (!Array.isArray(pt) || pt.length < 2) continue;

            const d1 = getDistanceInMeters(lat1, lng1, pt[0], pt[1]);
            if (d1 <= bestStartDist) {
                bestStartDist = d1;
                startIdx = i;
            }
            const d2 = getDistanceInMeters(lat2, lng2, pt[0], pt[1]);
            if (d2 <= bestEndDist) {
                bestEndDist = d2;
                endIdx = i;
            }
        }

        if (startIdx !== -1 && endIdx !== -1 && startIdx !== endIdx) {
            const from = Math.min(startIdx, endIdx);
            const to = Math.max(startIdx, endIdx);
            let totalMeters = 0;
            for (let j = from; j < to; j++) {
                totalMeters += getDistanceInMeters(
                    coords[j][0], coords[j][1],
                    coords[j + 1][0], coords[j + 1][1]
                );
            }
            return parseFloat((totalMeters / 1000).toFixed(1));
        }
    }
    return null;
}

// Live GPS se kisi target padav tak ki remaining road distance (custom route par ya OSRM par)
function getRemainingCustomRouteKmFromLiveGps(uLat, uLng, targetPadav) {
    const routes = window.activeCustomRoutes || [];
    const snapToleranceMeters = 550;

    for (const r of routes) {
        const coords = r.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) continue;

        let userIdx = -1;
        let targetIdx = -1;
        let bestUserDist = snapToleranceMeters;
        let bestTargetDist = 450;

        for (let i = 0; i < coords.length; i++) {
            const pt = coords[i];
            if (!Array.isArray(pt) || pt.length < 2) continue;

            const dUser = getDistanceInMeters(uLat, uLng, pt[0], pt[1]);
            if (dUser <= bestUserDist) {
                bestUserDist = dUser;
                userIdx = i;
            }
            const dTarget = getDistanceInMeters(targetPadav.lat, targetPadav.lng, pt[0], pt[1]);
            if (dTarget <= bestTargetDist) {
                bestTargetDist = dTarget;
                targetIdx = i;
            }
        }

        if (userIdx !== -1 && targetIdx !== -1 && userIdx !== targetIdx) {
            const from = Math.min(userIdx, targetIdx);
            const to = Math.max(userIdx, targetIdx);
            let totalMeters = 0;
            for (let j = from; j < to; j++) {
                totalMeters += getDistanceInMeters(
                    coords[j][0], coords[j][1],
                    coords[j + 1][0], coords[j + 1][1]
                );
            }
            return parseFloat((totalMeters / 1000).toFixed(1));
        }
    }
    return null;
}

function getResolvedPathKmSync(fromPadav, toPadav, savedKm, routeIdx = 0) {
    if (!fromPadav || !toPadav) return savedKm || null;

    const customKm = getCustomRouteKmBetween(fromPadav.lat, fromPadav.lng, toPadav.lat, toPadav.lng);
    if (customKm !== null && customKm > 0) {
        return customKm;
    }

    const cacheKey = `${fromPadav.id}_${toPadav.id}_${routeIdx}`;
    if (window.osrmDistanceCache[cacheKey]) {
        return window.osrmDistanceCache[cacheKey];
    }

    if (savedKm && parseFloat(savedKm) > 0) {
        return parseFloat(savedKm);
    }

    return null;
}

async function fetchRealRoadKmAsync(fromPadav, toPadav, routeIdx = 0) {
    if (!fromPadav || !toPadav) return null;

    const customKm = getCustomRouteKmBetween(fromPadav.lat, fromPadav.lng, toPadav.lat, toPadav.lng);
    if (customKm !== null && customKm > 0) return customKm;

    const cacheKey = `${fromPadav.id}_${toPadav.id}_${routeIdx}`;
    if (window.osrmDistanceCache[cacheKey]) return window.osrmDistanceCache[cacheKey];

    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${fromPadav.lng},${fromPadav.lat};${toPadav.lng},${toPadav.lat}?overview=full&geometries=geojson&alternatives=true`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            const chosenRoute = data.routes[routeIdx] || data.routes[0];
            const roadKm = parseFloat((chosenRoute.distance / 1000).toFixed(1));
            window.osrmDistanceCache[cacheKey] = roadKm;

            if (!window.osrmGeometryCache[cacheKey] && chosenRoute.geometry?.coordinates) {
                let latLngs = chosenRoute.geometry.coordinates.map(c => [c[1], c[0]]);
                if (routeIdx > 0 && !data.routes[routeIdx]) {
                    latLngs = latLngs.map(([lat, lng]) => [lat + (0.0003 * routeIdx), lng + (0.0003 * routeIdx)]);
                }
                window.osrmGeometryCache[cacheKey] = latLngs;
            }

            const spanEl = document.getElementById(`km_badge_${fromPadav.id}_${toPadav.id}_${routeIdx}`);
            if (spanEl) {
                spanEl.innerText = `${roadKm} km`;
            }
            return roadKm;
        }
    } catch (e) {}

    return null;
}

// =========================================================
// NARMADA PARIKRAMA TAT (BANK) SYNCHRONIZATION HELPER
// =========================================================
function normalizeTatLabel(str) {
    return (str || '').toString().toLowerCase().trim().replace(/\s+/g, ' ');
}

function isSameNarmadaTat(padavA, padavB) {
    if (!padavA || !padavB) return false;
    const tatA = normalizeTatLabel(padavA.sub_route);
    const tatB = normalizeTatLabel(padavB.sub_route);
    if (!tatA || !tatB) return true;
    return tatA === tatB;
}

function getSyncedNextPadavsForPadav(p, isNarmadaParikrama) {
    let rawNext = p.next_padavs;
    if (typeof rawNext === 'string') {
        try { rawNext = JSON.parse(rawNext); } catch (e) { rawNext = []; }
    }
    const manualList = Array.isArray(rawNext) ? rawNext : [];

    if (isNarmadaParikrama) {
        const sameTatManual = manualList.filter(np => {
            if (window.abandonedBranchIds.has(np.id)) return false;
            const targetObj = (window.activeYatraPadavs || []).find(item => String(item.id) === String(np.id));
            if (!targetObj) return false;
            return isSameNarmadaTat(p, targetObj);
        });

        if (sameTatManual.length > 0) {
            return { list: sameTatManual, isAuto: false };
        }

        const tatName = normalizeTatLabel(p.sub_route);
        const isUttarTat = tatName.includes('उत्तर') || tatName.includes('uttar') || tatName.includes('north');
        const isDakshinTat = tatName.includes('दक्षिण') || tatName.includes('dakshin') || tatName.includes('south');

        const sameTatCandidates = (window.activeYatraPadavs || [])
            .filter(other => {
                if (String(other.id) === String(p.id)) return false;
                if (window.passedPadavIds.has(other.id)) return false;
                if (window.abandonedBranchIds.has(other.id)) return false;
                if (!other.lat || !other.lng) return false;
                if (!isSameNarmadaTat(p, other)) return false;

                if (isDakshinTat) return other.lng < (p.lng - 0.002);
                if (isUttarTat) return other.lng > (p.lng + 0.002);
                return true;
            })
            .map(other => {
                const knownKm = getResolvedPathKmSync(p, other, null, 0);
                const sortOrderMetric = knownKm !== null ? (knownKm * 1000) : getDistanceInMeters(p.lat, p.lng, other.lat, other.lng);
                return {
                    id: other.id,
                    name: other.name,
                    path: p.sub_route || ((Array.isArray(other.path_types) && other.path_types[0]) ? other.path_types[0] : 'परिक्रमा मार्ग'),
                    km: knownKm,
                    _sortMetric: sortOrderMetric
                };
            })
            .sort((a, b) => a._sortMetric - b._sortMetric)
            .slice(0, 1);

        return { list: sameTatCandidates, isAuto: true };
    }

    const activeManual = manualList.filter(np => !window.abandonedBranchIds.has(np.id));
    if (activeManual.length > 0) {
        return { list: activeManual, isAuto: false };
    }

    if ((window.activeYatraPadavs || []).length > 1) {
        const autoOther = window.activeYatraPadavs
            .filter(other => other.id !== p.id && !window.passedPadavIds.has(other.id) && !window.abandonedBranchIds.has(other.id) && (!p.sub_route || !other.sub_route || other.sub_route === p.sub_route))
            .map(other => {
                const knownKm = getResolvedPathKmSync(p, other, null, 0);
                const sortOrderMetric = knownKm !== null ? (knownKm * 1000) : getDistanceInMeters(p.lat, p.lng, other.lat, other.lng);
                return {
                    id: other.id,
                    name: other.name,
                    path: (Array.isArray(other.path_types) && other.path_types[0]) ? other.path_types[0] : 'मुख्य मार्ग',
                    km: knownKm,
                    _sortMetric: sortOrderMetric
                };
            })
            .sort((a, b) => a._sortMetric - b._sortMetric)
            .slice(0, 1);
        return { list: autoOther, isAuto: true };
    }

    return { list: [], isAuto: false };
}

// =========================================================
// DRAGGABLE ELEMENT HELPER (FOR FLOATING BOXES / TOOLBARS)
// =========================================================
function makeElementMovable(el) {
    if (!el || el.dataset.movableAttached === '1') return;
    el.dataset.movableAttached = '1';

    let isDragging = false;
    let startX = 0, startY = 0, origLeft = 0, origTop = 0;

    const onStart = (clientX, clientY, target) => {
        if (target && (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.tagName === 'A' || target.closest('button'))) {
            return;
        }
        const rect = el.getBoundingClientRect();
        el.style.left = rect.left + 'px';
        el.style.top = rect.top + 'px';
        el.style.bottom = 'auto';
        el.style.right = 'auto';
        el.style.transform = 'none';

        isDragging = true;
        startX = clientX;
        startY = clientY;
        origLeft = rect.left;
        origTop = rect.top;
    };

    const onMove = (clientX, clientY) => {
        if (!isDragging) return;
        const maxLeft = Math.max(0, window.innerWidth - el.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - el.offsetHeight);
        const nextLeft = Math.min(Math.max(0, origLeft + (clientX - startX)), maxLeft);
        const nextTop = Math.min(Math.max(0, origTop + (clientY - startY)), maxTop);
        el.style.left = nextLeft + 'px';
        el.style.top = nextTop + 'px';
    };

    const onEnd = () => {
        isDragging = false;
    };

    el.addEventListener('mousedown', (e) => {
        onStart(e.clientX, e.clientY, e.target);
    });
    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            e.preventDefault();
            onMove(e.clientX, e.clientY);
        }
    });
    document.addEventListener('mouseup', onEnd);

    el.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches.length === 1) {
            onStart(e.touches[0].clientX, e.touches[0].clientY, e.target);
        }
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
        if (isDragging && e.touches && e.touches.length === 1) {
            onMove(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: true });
    document.addEventListener('touchend', onEnd);
}

// =========================================================
// LIVE ROUTE NAVIGATION BAR (HUD) - MOVABLE & AUTO-HIDES IN DRAW MODE
// =========================================================
function updateLiveNavigationHud(originPadav, targetEntries) {
    let hud = document.getElementById('liveYatraNavHud');
    const isDrawingBusy = !!(window.isManualDrawing || window.isGpsFollowActive);

    if (isDrawingBusy || !originPadav || !Array.isArray(targetEntries) || targetEntries.length === 0) {
        if (hud) hud.style.display = 'none';
        return;
    }

    if (!hud) {
        hud = document.createElement('div');
        hud.id = 'liveYatraNavHud';
        hud.style.cssText = 'position:fixed; bottom:14px; left:50%; transform:translateX(-50%); z-index:9997; background:rgba(21, 101, 192, 0.96); color:#fff; padding:9px 14px; border-radius:12px; box-shadow:0 4px 16px rgba(0,0,0,0.4); max-width:92%; width:360px; font-family:sans-serif; font-size:12.5px; border:1.5px solid #bbdefb; cursor:move; touch-action:none;';
        document.body.appendChild(hud);
        makeElementMovable(hud);
    }

    hud.style.display = 'block';

    const rowsHtml = targetEntries.map((item, idx) => {
        const kmStr = item.liveKm !== null && item.liveKm !== undefined
            ? `<b>${item.liveKm} km</b>`
            : '<span>दूरी लोड...</span>';
        const prefix = targetEntries.length > 1 ? `विकल्प ${idx + 1}: ` : '➡️ अगला पड़ाव: ';
        return `
            <div style="display:flex; justify-content:space-between; align-items:center; ${idx > 0 ? 'margin-top:4px; padding-top:4px; border-top:1px dashed rgba(255,255,255,0.35);' : ''}">
                <span onclick="focusOnPadav('${item.target.id}')" style="cursor:pointer; text-decoration:underline; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:230px;">
                    ${prefix}${item.target.name}
                </span>
                <span id="hud_live_km_${item.target.id}" style="background:#ffeb3b; color:#0d47a1; padding:2px 7px; border-radius:6px; font-size:12px; white-space:nowrap;">
                    ${kmStr}
                </span>
            </div>
        `;
    }).join('');

    hud.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#bbdefb; margin-bottom:3px;">
            <span>🚩 वर्तमान चरण: <b>${originPadav.name}</b></span>
            <span style="opacity:0.85; font-size:12px;" title="खींचकर कहीं भी ले जाएं">⠿</span>
        </div>
        ${rowsHtml}
    `;
}

// =========================================================
// MY CURRENT LOCATION BUTTON + BLUE DOT ON MAP
// =========================================================
function updateMyBlueLocationDot(lat, lng, flyToLocation = false) {
    window.yatriLiveCoords = { lat, lng };
    if (!window.map) return;

    if (!window.yatriLiveMarker) {
        const yatriIcon = L.divIcon({
            html: `<div style="background:#1976d2; border:3px solid white; border-radius:50%; width:18px; height:18px; box-shadow:0 0 0 5px rgba(25,118,210,0.35), 0 2px 8px rgba(0,0,0,0.5);"></div>`,
            className: '',
            iconSize: [18, 18],
            iconAnchor: [9, 9]
        });
        window.yatriLiveMarker = L.marker([lat, lng], { icon: yatriIcon, zIndexOffset: 1000 })
            .bindPopup('📍 <b>आपकी वर्तमान लोकेशन</b>')
            .addTo(window.map);
    } else {
        window.yatriLiveMarker.setLatLng([lat, lng]);
    }

    if (flyToLocation) {
        window.map.flyTo([lat, lng], 15, { duration: 1.0 });
        window.yatriLiveMarker.openPopup();
    }
}

window.locateMyCurrentPosition = function() {
    const btn = document.getElementById('btnLocateMeMap');
    if (!navigator.geolocation) {
        return alert("⚠️ आपका ब्राउज़र या मोबाइल GPS सपोर्ट नहीं करता।");
    }

    if (btn) btn.innerText = '⏳';

    if (window.yatriLiveCoords) {
        updateMyBlueLocationDot(window.yatriLiveCoords.lat, window.yatriLiveCoords.lng, true);
    }

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            if (btn) btn.innerText = '🎯';
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            window.focusedOriginPadavId = null;
            updateMyBlueLocationDot(lat, lng, true);
            await syncYatriLiveLocationToDb(lat, lng, true);
            applyMapFilters();
        },
        (err) => {
            if (btn) btn.innerText = '🎯';
            if (window.yatriLiveCoords) {
                updateMyBlueLocationDot(window.yatriLiveCoords.lat, window.yatriLiveCoords.lng, true);
            } else {
                alert("⚠️ GPS लोकेशन नहीं मिल सकी। कृपया मोबाइल की Location (GPS) चालू करें।");
            }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
};

function injectLocateMeButtonOnMap() {
    if (document.getElementById('btnLocateMeMap')) return;

    const btn = document.createElement('button');
    btn.id = 'btnLocateMeMap';
    btn.type = 'button';
    btn.title = 'मेरी वर्तमान GPS लोकेशन पर जाएं';
    btn.innerText = '🎯';
    btn.style.cssText = 'position:fixed; bottom:118px; right:10px; z-index:9998; width:42px; height:42px; border-radius:50%; background:#ffffff; color:#1976d2; border:2px solid #1976d2; font-size:20px; display:flex; align-items:center; justify-content:center; box-shadow:0 3px 10px rgba(0,0,0,0.35); cursor:pointer;';
    btn.onclick = window.locateMyCurrentPosition;

    document.body.appendChild(btn);
}

// =========================================================
// SYNC BOTH REGISTERED & UNREGISTERED (GUEST) GPS TO SUPABASE
// =========================================================
async function syncYatriLiveLocationToDb(lat, lng, force = false) {
    if (!window.activeYatra) return;
    const now = Date.now();
    if (!force && (now - window.lastDbLocationPingMs) < 15000) return;
    window.lastDbLocationPingMs = now;

    try {
        if (window.currentUser) {
            await supabaseClient
                .from('profiles')
                .update({
                    live_lat: lat,
                    live_lng: lng,
                    active_yatra_id: window.activeYatra.id,
                    last_seen_at: new Date().toISOString()
                })
                .eq('id', window.currentUser.id);
        } else {
            const visitorId = getOrCreateGuestVisitorId();
            await supabaseClient
                .from('live_visitors')
                .upsert([{
                    visitor_id: visitorId,
                    yatra_id: window.activeYatra.id,
                    live_lat: lat,
                    live_lng: lng,
                    last_seen_at: new Date().toISOString()
                }], { onConflict: 'visitor_id' });
        }
    } catch (e) {}
}

function renderSingleAdminLiveYatri(yatri, isGuest = false) {
    if (!isStrictSuperOrAdmin() || !window.map) return;
    if (!yatri || !yatri.live_lat || !yatri.live_lng) return;

    const recordId = isGuest ? ('guest_' + yatri.visitor_id) : ('user_' + yatri.id);
    const yatraId = isGuest ? yatri.yatra_id : yatri.active_yatra_id;

    if (!isGuest && window.currentUser && String(yatri.id) === String(window.currentUser.id)) return;
    if (isGuest && String(yatri.visitor_id) === String(getOrCreateGuestVisitorId())) return;

    if (window.activeYatra && yatraId && String(yatraId) !== String(window.activeYatra.id)) {
        return;
    }

    if (!window.map.hasLayer(window.adminLiveYatrisLayer)) {
        window.adminLiveYatrisLayer.addTo(window.map);
    }

    const seenTime = yatri.last_seen_at
        ? new Date(yatri.last_seen_at).toLocaleTimeString('hi-IN', { hour: '2-digit', minute: '2-digit' })
        : 'अभी';

    const bgCol = isGuest ? '#e65100' : '#0d47a1';
    const emoji = isGuest ? '🧭' : '🚶';

    const icon = L.divIcon({
        className: '',
        html: `<div style="background:${bgCol}; color:#fff; border:2px solid #ffeb3b; border-radius:50%; width:32px; height:32px; display:flex; align-items:center; justify-content:center; font-size:16px; box-shadow:0 3px 10px rgba(0,0,0,0.5);">${emoji}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    });

    const popupHtml = isGuest
        ? `
            <div style="font-family:sans-serif; min-width:185px; font-size:13px; line-height:1.55;">
                <b style="color:#e65100; font-size:14px;">🧭 Guest यात्री (Unregistered)</b><br>
                <span><b>🕒 अंतिम अपडेट:</b> ${seenTime}</span><br>
                <div style="margin-top:7px;">
                    <a href="https://www.google.com/maps?q=${yatri.live_lat},${yatri.live_lng}" target="_blank" style="display:block; text-align:center; background:#e65100; color:#fff; padding:5px; border-radius:5px; text-decoration:none; font-size:12px; font-weight:bold;">📍 Google Maps पर देखें</a>
                </div>
            </div>
        `
        : `
            <div style="font-family:sans-serif; min-width:190px; font-size:13px; line-height:1.55;">
                <b style="color:#0d47a1; font-size:14px;">🚶 ${yatri.full_name || 'सक्रिय यात्री'}</b><br>
                <span><b>📞 मोबाइल:</b> <a href="tel:${yatri.mobile}">${yatri.mobile || 'N/A'}</a></span><br>
                <span><b>🕒 अंतिम अपडेट:</b> ${seenTime}</span><br>
                <div style="margin-top:7px; display:flex; gap:6px;">
                    <a href="tel:${yatri.mobile}" style="flex:1; text-align:center; background:#2e7d32; color:#fff; padding:5px; border-radius:5px; text-decoration:none; font-size:12px; font-weight:bold;">📞 कॉल</a>
                    <a href="https://www.google.com/maps?q=${yatri.live_lat},${yatri.live_lng}" target="_blank" style="flex:1; text-align:center; background:#1565c0; color:#fff; padding:5px; border-radius:5px; text-decoration:none; font-size:12px; font-weight:bold;">📍 मैप</a>
                </div>
            </div>
        `;

    if (window.adminYatriMarkersMap[recordId]) {
        window.adminYatriMarkersMap[recordId].setLatLng([yatri.live_lat, yatri.live_lng]);
        window.adminYatriMarkersMap[recordId].setPopupContent(popupHtml);
    } else {
        const marker = L.marker([yatri.live_lat, yatri.live_lng], { icon }).bindPopup(popupHtml);
        marker.addTo(window.adminLiveYatrisLayer);
        window.adminYatriMarkersMap[recordId] = marker;
    }
}

async function loadAllActiveYatrisForAdmin() {
    if (!isStrictSuperOrAdmin() || !window.map) return;

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: regUsers } = await supabaseClient
        .from('profiles')
        .select('id, full_name, mobile, role, active_yatra_id, live_lat, live_lng, last_seen_at')
        .not('live_lat', 'is', null)
        .gte('last_seen_at', twoHoursAgo);

    if (Array.isArray(regUsers)) {
        regUsers.forEach(u => renderSingleAdminLiveYatri(u, false));
    }

    const { data: guestUsers } = await supabaseClient
        .from('live_visitors')
        .select('visitor_id, yatra_id, live_lat, live_lng, last_seen_at')
        .gte('last_seen_at', twoHoursAgo);

    if (Array.isArray(guestUsers)) {
        guestUsers.forEach(g => renderSingleAdminLiveYatri(g, true));
    }

    if (!window.adminYatriRealtimeSub) {
        window.adminYatriRealtimeSub = supabaseClient
            .channel('public:profiles_admin_map')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (payload) => {
                if (payload && payload.new && payload.new.live_lat) {
                    renderSingleAdminLiveYatri(payload.new, false);
                }
            })
            .subscribe();
    }

    if (!window.adminVisitorRealtimeSub) {
        window.adminVisitorRealtimeSub = supabaseClient
            .channel('public:live_visitors_admin_map')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'live_visitors' }, (payload) => {
                if (payload && payload.new && payload.new.live_lat) {
                    renderSingleAdminLiveYatri(payload.new, true);
                }
            })
            .subscribe();
    }
}

// =========================================================
// READ MORE MODAL: FORMATTED PARAGRAPHS, HEADINGS & BULLETS
// =========================================================
function formatPadavDescriptionHtml(rawText) {
    if (typeof formatTextToCleanHtml === 'function') {
        return formatTextToCleanHtml(rawText);
    }
    const text = (rawText || '').trim();
    if (!text) return '';
    if (/<(p|ul|ol|li|h[1-6]|br|div)\b[^>]*>/i.test(text)) return text;

    const lines = text.split(/\r?\n/);
    let htmlOutput = '';
    let inBulletList = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
            if (inBulletList) { htmlOutput += '</ul>'; inBulletList = false; }
            continue;
        }
        const bulletMatch = line.match(/^([-*•]|\d+\.)\s+(.*)$/);
        if (bulletMatch) {
            if (!inBulletList) {
                htmlOutput += '<ul style="margin:8px 0 12px 20px; padding:0; line-height:1.7;">';
                inBulletList = true;
            }
            htmlOutput += `<li style="margin-bottom:5px;">${bulletMatch[2]}</li>`;
        } else {
            if (inBulletList) { htmlOutput += '</ul>'; inBulletList = false; }
            if (line.endsWith(':') && line.length < 85) {
                htmlOutput += `<h4 style="margin:12px 0 5px 0; color:#d84315; font-size:15px;">${line}</h4>`;
            } else {
                htmlOutput += `<p style="margin:0 0 10px 0; line-height:1.7;">${line}</p>`;
            }
        }
    }
    if (inBulletList) htmlOutput += '</ul>';
    return htmlOutput;
}

function openPadavDetailsModal(padavId) {
    const p = (window.activeYatraPadavs || []).find(item => item.id === padavId);
    if (!p) return;

    const titleEl = document.getElementById('detailPadavTitle');
    const bodyEl = document.getElementById('detailPadavBody');
    if (titleEl) titleEl.innerText = p.name;
    if (bodyEl) {
        bodyEl.innerHTML = p.description
            ? formatPadavDescriptionHtml(p.description)
            : '<p style="color:#666;">कोई अतिरिक्त विवरण उपलब्ध नहीं है।</p>';
    }

    showModal('padavDetailModal');
}

// =========================================================
// YATRI LIVE PROGRESS TRACKER:
// 1) A -> B LINE FROM STARTING POINT
// 2) CROSSING 500M HIDES A & AUTO-SWITCHES TO B -> C
// 3) BRANCHING: SHOWS ALL NEXT PADAVS, HIDES OTHER BRANCH ON COMMIT
// 4) CONTINUOUS LIVE DISTANCE UPDATE WHILE WALKING
// =========================================================
function startYatriLiveProgressTracker() {
    if (!navigator.geolocation) return;

    const yatraSlug = (window.activeYatra?.slug || '').toLowerCase();
    const yatraName = (window.activeYatra?.name || '').toLowerCase();
    const isNarmadaParikrama = yatraSlug.includes('narmada') || yatraName.includes('narmada');

    navigator.geolocation.watchPosition(pos => {
        if (pos.coords.accuracy && pos.coords.accuracy > 150) return;

        const uLat = pos.coords.latitude;
        const uLng = pos.coords.longitude;

        updateMyBlueLocationDot(uLat, uLng, false);
        syncYatriLiveLocationToDb(uLat, uLng, false);

        if (window.map && !window.hasCenteredOnLiveGps && !window.isManualDrawing && !window.isGpsFollowActive) {
            window.hasCenteredOnLiveGps = true;
            window.map.setView([uLat, uLng], 13);
        }

        let statusChanged = false;

        if (!isUserAdminOrMod()) {
            (window.activeYatraPadavs || []).forEach(p => {
                if (window.passedPadavIds.has(p.id)) return;
                const distFromPadav = getDistanceInMeters(uLat, uLng, p.lat, p.lng);

                if (distFromPadav > 500) {
                    const synced = getSyncedNextPadavsForPadav(p, isNarmadaParikrama);
                    const nextArr = synced.list;

                    if (Array.isArray(nextArr) && nextArr.length > 0) {
                        const movedTowardAnyNext = nextArr.some(np => {
                            const targetObj = window.activeYatraPadavs.find(x => String(x.id) === String(np.id));
                            if (!targetObj) return false;
                            const totalSpan = getDistanceInMeters(p.lat, p.lng, targetObj.lat, targetObj.lng);
                            const distToNext = getDistanceInMeters(uLat, uLng, targetObj.lat, targetObj.lng);
                            return distToNext < (totalSpan - 150);
                        });

                        if (movedTowardAnyNext) {
                            window.passedPadavIds.add(p.id);
                            if (String(window.focusedOriginPadavId) === String(p.id)) {
                                window.focusedOriginPadavId = null;
                            }
                            statusChanged = true;

                            if (nextArr.length > 1) {
                                const branchProgress = nextArr.map(np => {
                                    const tObj = window.activeYatraPadavs.find(x => String(x.id) === String(np.id));
                                    if (!tObj) return null;
                                    const span = getDistanceInMeters(p.lat, p.lng, tObj.lat, tObj.lng);
                                    const rem = getDistanceInMeters(uLat, uLng, tObj.lat, tObj.lng);
                                    return { id: tObj.id, gainedMeters: span - rem };
                                }).filter(Boolean);

                                if (branchProgress.length > 1) {
                                    branchProgress.sort((a, b) => b.gainedMeters - a.gainedMeters);
                                    const chosen = branchProgress[0];
                                    const runnerUp = branchProgress[1];
                                    if (chosen.gainedMeters > 450 && (chosen.gainedMeters - runnerUp.gainedMeters) > 350) {
                                        for (let k = 1; k < branchProgress.length; k++) {
                                            window.abandonedBranchIds.add(branchProgress[k].id);
                                        }
                                    }
                                }
                            }
                        }
                    } else if (window.selectedStartPadav && String(window.selectedStartPadav.id) === String(p.id)) {
                        window.passedPadavIds.add(p.id);
                        statusChanged = true;
                    }
                }
            });
        }

        if (statusChanged) {
            applyMapFilters();
        } else {
            const subVal = document.getElementById('subRouteFilter')?.value || 'all';
            const catVal = document.getElementById('categoryFilter')?.value || 'all';
            const currentVisible = (window.activeYatraPadavs || []).filter(p =>
                (isUserAdminOrMod() || !window.passedPadavIds.has(p.id)) &&
                !window.abandonedBranchIds.has(p.id) &&
                (subVal === 'all' || p.sub_route === subVal) &&
                (catVal === 'all' || p.category === catVal)
            );
            drawAutoPadavConnectingLines(currentVisible);
        }
    }, err => {
        console.warn("Live GPS tracking paused:", err.message);
    }, { enableHighAccuracy: true, maximumAge: 5000 });
}

async function initAndLoadIsolatedMap() {
    if (!window.activeYatra) return;

    if (window.selectedStartPadav) {
        saveUserStartPadavLocal(window.activeYatra, window.selectedStartPadav);
    } else {
        const savedStart = getSavedUserStartPadavLocal(window.activeYatra);
        if (savedStart) {
            window.selectedStartPadav = savedStart;
        }
    }

    window.hasCenteredOnLiveGps = false;
    window.focusedOriginPadavId = null;

    const initialLat = window.yatriLiveCoords?.lat
        || (window.selectedStartPadav ? window.selectedStartPadav.lat : window.activeYatra.center_lat);
    const initialLng = window.yatriLiveCoords?.lng
        || (window.selectedStartPadav ? window.selectedStartPadav.lng : window.activeYatra.center_lng);
    const initialZoom = (window.yatriLiveCoords || window.selectedStartPadav) ? 13 : (window.activeYatra.default_zoom || 10);

    if (!window.map) {
        window.map = L.map('map', { zoomControl: false }).setView([initialLat, initialLng], initialZoom);
        L.control.zoom({ position: 'bottomright' }).addTo(window.map);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap | Parikramapath'
        }).addTo(window.map);

        window.routeLayer.addTo(window.map);
        window.autoPadavLinkLayer.addTo(window.map);
        window.padavLayer.addTo(window.map);
        window.adminLiveYatrisLayer.addTo(window.map);

        injectLocateMeButtonOnMap();

        // MAP CLICK HANDLER
        window.map.on('click', async function(e) {
            const clickLat = e.latlng.lat;
            const clickLng = e.latlng.lng;

            if (window.isManualDrawing) {
                await handleManualMapClickPoint(clickLat, clickLng);
                return;
            }

            if (window.isGpsFollowActive) return;

            if (window.isPickingEditLocation) {
                window.isPickingEditLocation = false;
                document.getElementById('map').style.cursor = '';
                document.getElementById('newPadavLat').value = clickLat.toFixed(6);
                document.getElementById('newPadavLng').value = clickLng.toFixed(6);
                showModal('addPadavModal');
                if (typeof recalculateAllAddedNextPadavs === 'function') {
                    recalculateAllAddedNextPadavs();
                }
                return;
            }

            if (window.currentUser) {
                const latStr = clickLat.toFixed(6);
                const lngStr = clickLng.toFixed(6);
                const adminLabel = isUserAdminOrMod() ? '➕ यहाँ नया पड़ाव जोड़ें (सीधे लाइव)' : '➕ नया पड़ाव सुझाएं (Admin अप्रूवल के बाद दिखेगा)';
                const quickAddHtml = `
                    <div style="text-align:center; font-family:sans-serif; min-width:185px;">
                        <b style="font-size:12px; color:#333;">📍 चयनित स्थान</b><br>
                        <small style="color:#666;">${latStr}, ${lngStr}</small><br>
                        <button onclick="openAddPadavAtCoords('${latStr}', '${lngStr}')" 
                            style="margin-top:8px; width:100%; background:#2e7d32; color:white; border:none; padding:7px 10px; border-radius:5px; font-size:12px; font-weight:bold; cursor:pointer;">
                            ${adminLabel}
                        </button>
                    </div>
                `;
                L.popup()
                    .setLatLng(e.latlng)
                    .setContent(quickAddHtml)
                    .openOn(window.map);
            }
        });

        startYatriLiveProgressTracker();
    } else {
        window.padavLayer.clearLayers();
        window.routeLayer.clearLayers();
        window.autoPadavLinkLayer.clearLayers();
        window.adminLiveYatrisLayer.clearLayers();
        window.adminYatriMarkersMap = {};
        window.map.setView([initialLat, initialLng], initialZoom);
        injectLocateMeButtonOnMap();
    }

    setTimeout(() => { if (window.map) window.map.invalidateSize(); }, 200);

    // 1. PEHLE CUSTOM DRAWN ROUTES LOAD KAREIN
    const { data: routes } = await supabaseClient
        .from('yatra_routes')
        .select('*')
        .eq('yatra_id', window.activeYatra.id);

    window.activeCustomRoutes = routes || [];
    window.activeCustomRoutes.forEach(r => {
        if (Array.isArray(r.coordinates) && r.coordinates.length > 1) {
            L.polyline(r.coordinates, {
                color: r.color || window.activeYatra.theme_color || '#d84315',
                weight: 5,
                opacity: 0.92
            }).bindPopup(`<b>🛣️ ${r.route_name}</b><br><small>${r.sub_route || ''}</small>`).addTo(window.routeLayer);
        }
    });

    // 2. AB PADAVS RENDER KAREIN
    window.activeYatraPadavs = window.yatraPadavsForSelection || [];
    if (window.selectedStartPadav && window.activeYatraPadavs.length > 0) {
        const freshMatch = window.activeYatraPadavs.find(item => String(item.id) === String(window.selectedStartPadav.id));
        if (freshMatch) window.selectedStartPadav = freshMatch;
    }
    renderIsolatedPadavs(window.activeYatraPadavs);

    // 3. AGAR SUPER_ADMIN YA ADMIN HAI TO SABHI ACTIVE YATRIS KI LIVE LOCATION LOAD KAREIN
    if (isStrictSuperOrAdmin()) {
        loadAllActiveYatrisForAdmin();
    }
}

// =========================================================
// ACTIVE PADAV RESOLVER (START -> A -> B -> C AUTO-PROGRESSION)
// =========================================================
function resolveSingleActiveOriginPadav(visibleList) {
    if (!Array.isArray(visibleList) || visibleList.length === 0) return null;

    if (window.focusedOriginPadavId) {
        const clicked = visibleList.find(p => String(p.id) === String(window.focusedOriginPadavId));
        if (clicked) return clicked;
    }

    if (window.selectedStartPadav && !window.passedPadavIds.has(window.selectedStartPadav.id)) {
        const startMatch = visibleList.find(p => String(p.id) === String(window.selectedStartPadav.id));
        if (startMatch) return startMatch;
    }

    if (window.yatriLiveCoords && window.yatriLiveCoords.lat && window.yatriLiveCoords.lng) {
        let nearest = null;
        let bestDist = Infinity;
        for (const p of visibleList) {
            if (!p.lat || !p.lng) continue;
            const d = getDistanceInMeters(window.yatriLiveCoords.lat, window.yatriLiveCoords.lng, p.lat, p.lng);
            if (d < bestDist) {
                bestDist = d;
                nearest = p;
            }
        }
        if (nearest) return nearest;
    }

    return visibleList[0];
}

async function drawAutoPadavConnectingLines(visibleList) {
    if (!window.autoPadavLinkLayer) return;

    const yatraSlug = (window.activeYatra?.slug || '').toLowerCase();
    const yatraName = (window.activeYatra?.name || '').toLowerCase();
    const isNarmadaParikrama = yatraSlug.includes('narmada') || yatraName.includes('narmada');

    const currentOriginPadav = resolveSingleActiveOriginPadav(visibleList);
    if (!currentOriginPadav || !currentOriginPadav.lat || !currentOriginPadav.lng) {
        window.autoPadavLinkLayer.clearLayers();
        updateLiveNavigationHud(null, []);
        return;
    }

    const synced = getSyncedNextPadavsForPadav(currentOriginPadav, isNarmadaParikrama);
    const nextPadavsArr = synced.list;
    if (!Array.isArray(nextPadavsArr) || nextPadavsArr.length === 0) {
        window.autoPadavLinkLayer.clearLayers();
        updateLiveNavigationHud(null, []);
        return;
    }

    const branchColors = ['#1565c0', '#2e7d32', '#6a1b9a'];
    const hudEntries = [];
    const now = Date.now();
    const shouldQueryLiveOsrm = (now - window.lastLiveNavCalcMs) > 10000;
    if (shouldQueryLiveOsrm) window.lastLiveNavCalcMs = now;

    const validTargets = nextPadavsArr
        .map((np, idx) => {
            const targetP = window.activeYatraPadavs.find(item => String(item.id) === String(np.id));
            if (!targetP || !targetP.lat || !targetP.lng) return null;
            if (isNarmadaParikrama && !isSameNarmadaTat(currentOriginPadav, targetP)) return null;
            return { np, targetP, idx };
        })
        .filter(Boolean);

    if (validTargets.length === 0) {
        window.autoPadavLinkLayer.clearLayers();
        updateLiveNavigationHud(null, []);
        return;
    }

    window.autoPadavLinkLayer.clearLayers();

    for (const item of validTargets) {
        const { np, targetP, idx } = item;
        const lineColor = branchColors[idx % branchColors.length];
        const hasLiveGps = !!(window.yatriLiveCoords && window.yatriLiveCoords.lat && window.yatriLiveCoords.lng);

        let liveRemainingKm = null;
        if (hasLiveGps) {
            liveRemainingKm = getRemainingCustomRouteKmFromLiveGps(
                window.yatriLiveCoords.lat,
                window.yatriLiveCoords.lng,
                targetP
            );
        }
        if (liveRemainingKm === null) {
            liveRemainingKm = getResolvedPathKmSync(currentOriginPadav, targetP, np.km, idx);
        }

        hudEntries.push({ target: targetP, liveKm: liveRemainingKm });

        const hasCustomLine = hasCustomDrawnRouteBetween(
            currentOriginPadav.lat, currentOriginPadav.lng,
            targetP.lat, targetP.lng
        );

        const buildTooltip = (kmValue) => {
            const kmText = kmValue ? ` • <b>${kmValue} km शेष (सड़क मार्ग)</b>` : '';
            const branchTag = validTargets.length > 1 ? `<b>[विकल्प ${idx + 1}]</b> ` : '';
            return `${branchTag}<b>➡️ ${currentOriginPadav.name} ➔ ${targetP.name}</b><br><small>${np.path || currentOriginPadav.sub_route || 'परिक्रमा मार्ग'}${kmText}</small>`;
        };

        const dottedStyle = {
            color: lineColor,
            weight: 5,
            opacity: 0.92,
            dashArray: '8, 8'
        };

        if (hasLiveGps) {
            const liveCacheKey = `live_${targetP.id}`;
            if (window.osrmGeometryCache[liveCacheKey] && !shouldQueryLiveOsrm) {
                if (!hasCustomLine) {
                    L.polyline(window.osrmGeometryCache[liveCacheKey], dottedStyle)
                        .bindPopup(buildTooltip(window.osrmDistanceCache[liveCacheKey] || liveRemainingKm))
                        .addTo(window.autoPadavLinkLayer);
                }
                const hudBadge = document.getElementById(`hud_live_km_${targetP.id}`);
                if (hudBadge && window.osrmDistanceCache[liveCacheKey]) {
                    hudBadge.innerHTML = `<b>${window.osrmDistanceCache[liveCacheKey]} km</b>`;
                }
                continue;
            }

            try {
                const url = `https://router.project-osrm.org/route/v1/driving/${window.yatriLiveCoords.lng},${window.yatriLiveCoords.lat};${targetP.lng},${targetP.lat}?overview=full&geometries=geojson`;
                const res = await fetch(url);
                const data = await res.json();

                if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                    const liveRoadKm = parseFloat((data.routes[0].distance / 1000).toFixed(1));
                    const finalKm = getRemainingCustomRouteKmFromLiveGps(window.yatriLiveCoords.lat, window.yatriLiveCoords.lng, targetP) || liveRoadKm;
                    window.osrmDistanceCache[liveCacheKey] = finalKm;

                    const latLngs = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                    window.osrmGeometryCache[liveCacheKey] = latLngs;

                    if (!hasCustomLine) {
                        L.polyline(latLngs, dottedStyle)
                            .bindPopup(buildTooltip(finalKm))
                            .addTo(window.autoPadavLinkLayer);
                    }

                    const hudBadge = document.getElementById(`hud_live_km_${targetP.id}`);
                    if (hudBadge) {
                        hudBadge.innerHTML = `<b>${finalKm} km</b>`;
                    }
                    continue;
                }
            } catch (e) {}
        }

        if (!hasCustomLine) {
            const pairCacheKey = `${currentOriginPadav.id}_${targetP.id}_${idx}`;
            if (window.osrmGeometryCache[pairCacheKey]) {
                L.polyline(window.osrmGeometryCache[pairCacheKey], dottedStyle)
                    .bindPopup(buildTooltip(window.osrmDistanceCache[pairCacheKey] || liveRemainingKm))
                    .addTo(window.autoPadavLinkLayer);
            } else {
                const roadKm = await fetchRealRoadKmAsync(currentOriginPadav, targetP, idx);
                if (window.osrmGeometryCache[pairCacheKey]) {
                    L.polyline(window.osrmGeometryCache[pairCacheKey], dottedStyle)
                        .bindPopup(buildTooltip(roadKm || liveRemainingKm))
                        .addTo(window.autoPadavLinkLayer);
                }
            }
        }
    }

    updateLiveNavigationHud(currentOriginPadav, hudEntries);
}

function renderIsolatedPadavs(list) {
    if (!window.padavLayer || !Array.isArray(list)) return;
    window.padavLayer.clearLayers();
    window.padavMarkersMap = {};
    if (window.ParikramaVisited) window.ParikramaVisited.clearRegistry();

    const adminMode = isUserAdminOrMod();
    const isLoggedInUser = !!window.currentUser;

    const visiblePadavs = adminMode
        ? list
        : list.filter(p => !window.passedPadavIds.has(p.id) && !window.abandonedBranchIds.has(p.id));

    drawAutoPadavConnectingLines(visiblePadavs);

    const yatraSlug = (window.activeYatra?.slug || '').toLowerCase();
    const yatraName = (window.activeYatra?.name || '').toLowerCase();
    const isNarmadaParikrama = yatraSlug.includes('narmada') || yatraName.includes('narmada');

    visiblePadavs.forEach(p => {
        if (!p.lat || !p.lng) return;

        const isStart = window.selectedStartPadav && String(window.selectedStartPadav.id) === String(p.id);
        const isPointOnly = (p.category === 'Point');
        const isPending = (p.status === 'pending');

        const emoji = isStart ? '🚩' : (
            p.category === 'Mandir' ? '🛕' :
            (p.category === 'Annakshetra' ? '🍛' :
            (p.category === 'Medical' ? '🏥' :
            (isPointOnly ? '📍' : '🛌')))
        );
        const borderCol = isStart ? '#2e7d32' : (isPending ? '#ff9800' : (isPointOnly ? '#546e7a' : (window.activeYatra?.theme_color || '#d84315')));
        const size = isStart ? 38 : (isPointOnly ? 26 : 30);

        const icon = L.divIcon({
            html: `<div style="background:white; border:3px solid ${borderCol}; border-radius:50%; width:${size}px; height:${size}px; display:flex; align-items:center; justify-content:center; font-size:${isPointOnly ? 14 : 17}px; box-shadow:0 3px 8px rgba(0,0,0,0.4);">${emoji}</div>`,
            className: '',
            iconSize: [size, size]
        });

        const pendingBadge = isPending
            ? `<div style="background:#fff3e0; color:#e65100; border:1px solid #ffb74d; padding:3px 6px; border-radius:4px; font-size:11px; font-weight:bold; margin-bottom:5px; text-align:center;">⏳ Admin Approval Pending</div>`
            : '';

        const startTag = isStart
            ? `<div style="background:#2e7d32; color:white; padding:4px; border-radius:4px; font-size:11px; font-weight:bold; margin-bottom:5px; text-align:center;">🚩 आपका प्रारंभिक पड़ाव</div>`
            : `<button type="button" onclick="setManualStartPadav('${p.id}')" style="width:100%; background:#e8f5e9; color:#1b5e20; border:1px solid #a5d6a7; padding:4px 6px; border-radius:4px; font-size:11px; font-weight:bold; margin-bottom:6px; cursor:pointer;">🚩 इसे प्रारंभिक पड़ाव (Start) बनाएं</button>`;

        let descriptionPreviewHtml = '';
        if (p.description && p.description.trim().length > 0) {
            const cleanOneLine = p.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            descriptionPreviewHtml = `
                <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; background:#fff8e1; border-left:3px solid #ff9800; padding:4px 7px; border-radius:4px; margin:5px 0;">
                    <span style="font-size:12px; color:#333; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1;">
                        ${cleanOneLine}
                    </span>
                    <button type="button" onclick="openPadavDetailsModal('${p.id}')" style="background:none; border:none; color:#d84315; font-size:11px; font-weight:bold; text-decoration:underline; cursor:pointer; white-space:nowrap; padding:0;">
                        Read more
                    </button>
                </div>
            `;
        }

        const amenities = [
            p.has_water ? '🚰 पानी' : '',
            p.has_toilet ? '🚻 शौचालय' : '',
            p.has_medical ? '💊 मेडिकल' : ''
        ].filter(Boolean).join(' • ');

        let pathTypesArr = p.path_types;
        if (typeof pathTypesArr === 'string') {
            try { pathTypesArr = JSON.parse(pathTypesArr); } catch(e) { pathTypesArr = []; }
        }
        const pathsHtml = (Array.isArray(pathTypesArr) && pathTypesArr.length > 0)
            ? `<p style="margin:4px 0; font-size:12px;"><b>मार्ग प्रकार:</b> ${pathTypesArr.join(', ')}</p>`
            : '';

        const facilitySectionHtml = isPointOnly
            ? `<p style="margin:4px 0; font-size:12px; color:#37474f; background:#eceff1; padding:5px 7px; border-radius:4px;">📍 <b>मार्ग बिंदु / लैंडमार्क</b> (यहाँ भोजन या ठहरने की व्यवस्था नहीं है)</p>`
            : `
                <p style="margin:3px 0; font-size:12px;"><b>${safeT('bhojan', 'भोजन')}:</b> ${p.bhojan_type || '-'}</p>
                <p style="margin:3px 0; font-size:12px;"><b>${safeT('niwas', 'निवास')}:</b> ${p.niwas_type || '-'}</p>
                <p style="margin:3px 0; font-size:12px; color:#2e7d32;"><b>सुविधाएं:</b> ${amenities || 'सामान्य'}</p>
            `;

        const synced = getSyncedNextPadavsForPadav(p, isNarmadaParikrama);
        const finalNextList = synced.list;
        const isAutoSuggested = synced.isAuto;

        let nextOptionsHtml = '';
        if (finalNextList.length > 0) {
            const tatLabelText = (isNarmadaParikrama && p.sub_route) ? ` (${p.sub_route})` : '';
            const boxTitle = isAutoSuggested
                ? `➡️ इसी तट${tatLabelText} के अगले पड़ाव:`
                : (finalNextList.length > 1 ? `➡️ आगे जाने के ${finalNextList.length} रास्ते${tatLabelText}:` : `➡️ आगे जाने का रास्ता${tatLabelText}:`);

            nextOptionsHtml = `
                <div style="background:#f1f8e9; padding:7px; border-radius:6px; margin:7px 0; border-left:3px solid #2e7d32;">
                    <b style="font-size:11px; color:#2e7d32;">${boxTitle}</b>` +
                    finalNextList.map((np, idx) => {
                        const targetP = window.activeYatraPadavs.find(item => String(item.id) === String(np.id));
                        let targetFacilities = '';
                        if (targetP) {
                            if (targetP.category === 'Point') {
                                targetFacilities = `<div style="font-size:11px; color:#546e7a; margin-top:2px; padding-left:8px;">📍 मार्ग बिंदु (Landmark)</div>`;
                            } else {
                                const fList = [
                                    targetP.bhojan_type && !targetP.bhojan_type.includes('Not') ? `🍛 ${targetP.bhojan_type}` : '',
                                    targetP.niwas_type && !targetP.niwas_type.includes('No Stay') ? `🛌 ${targetP.niwas_type}` : '',
                                    targetP.has_water ? '🚰' : '',
                                    targetP.has_toilet ? '🚻' : '',
                                    targetP.has_medical ? '💊' : ''
                                ].filter(Boolean).join(' • ');
                                targetFacilities = `<div style="font-size:11px; color:#333; margin-top:2px; padding-left:8px;">सुविधा: ${fList || 'सामान्य'}</div>`;
                            }
                        }

                        const resolvedKm = targetP ? getResolvedPathKmSync(p, targetP, np.km, idx) : (np.km || null);
                        const kmSpanId = targetP ? `km_badge_${p.id}_${targetP.id}_${idx}` : '';
                        const kmLabel = resolvedKm ? `${resolvedKm} km` : 'सड़क दूरी लोड...';

                        const routeTag = finalNextList.length > 1 ? `<span style="font-size:10px; background:#e8f5e9; color:#1b5e20; padding:1px 4px; border-radius:3px; margin-right:3px;">मार्ग ${idx + 1}</span>` : '• ';

                        return `
                            <div style="font-size:12px; margin-top:5px; padding-top:4px; border-top:1px dashed #c5e1a5;">
                                ${routeTag}<span onclick="focusOnPadav('${np.id}')" style="color:#d84315; text-decoration:underline; cursor:pointer; font-weight:bold;">
                                    ${np.name}
                                </span> 
                                <span style="color:#1b5e20; font-weight:bold;">(${np.path || ''} • <span id="${kmSpanId}">${kmLabel}</span>)</span>
                                ${targetFacilities}
                            </div>
                        `;
                    }).join('') + 
                `</div>`;
        }

        let actionBtnsHtml = '';
        if (adminMode) {
            actionBtnsHtml = `
                <div style="display:flex; gap:6px; margin-top:8px; border-top:1px dashed #ccc; padding-top:8px;">
                    <button onclick="openEditPadavModal('${p.id}')" style="flex:1; background:#ffc107; color:#000; border:none; padding:6px; border-radius:4px; font-size:12px; font-weight:bold; cursor:pointer;">✏️ Edit</button>
                    <button onclick="deletePadav('${p.id}')" style="flex:1; background:#dc3545; color:#fff; border:none; padding:6px; border-radius:4px; font-size:12px; font-weight:bold; cursor:pointer;">🗑️ Delete</button>
                </div>
            `;
        } else if (isLoggedInUser) {
            actionBtnsHtml = `
                <div style="margin-top:8px; border-top:1px dashed #ccc; padding-top:8px;">
                    <button onclick="openEditPadavModal('${p.id}')" style="width:100%; background:#ffc107; color:#000; border:none; padding:6px; border-radius:4px; font-size:12px; font-weight:bold; cursor:pointer;">✏️ जानकारी सुधारें (Edit)</button>
                </div>
            `;
        }

        const visitedBtnHtml = window.ParikramaVisited
            ? window.ParikramaVisited.getActionButtonHtml(p.id)
            : '';

        const popupHtml = `
            <div style="min-width:225px; max-width:265px; font-family:sans-serif;">
                ${pendingBadge}
                ${startTag}
                <span style="font-size:11px; background:#fff3e0; color:#e65100; padding:2px 6px; border-radius:4px; font-weight:bold;">${p.sub_route || window.activeYatra.name}</span>
                <h4 style="margin:6px 0 4px 0; color:#222; font-size:15px;">${p.name}</h4>
                ${descriptionPreviewHtml}
                ${pathsHtml}
                ${facilitySectionHtml}
                ${p.contact_no ? `<p style="margin:4px 0; font-size:12px;"><b>📞 संपर्क:</b> ${p.contact_person || ''} (<a href="tel:${p.contact_no}">${p.contact_no}</a>)</p>` : ''}
                ${nextOptionsHtml}
                ${visitedBtnHtml}
                <a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}" target="_blank" style="display:block; text-align:center; background:#1976d2; color:white; padding:6px; border-radius:5px; text-decoration:none; font-size:12px; font-weight:bold; margin-top:8px;">🧭 Google Maps से दिशा देखें</a>
                ${actionBtnsHtml}
            </div>
        `;

        const marker = L.marker([p.lat, p.lng], { icon }).bindPopup(popupHtml);

        marker.on('click', () => {
            if (String(window.focusedOriginPadavId) !== String(p.id)) {
                window.focusedOriginPadavId = p.id;
                drawAutoPadavConnectingLines(visiblePadavs);
            }
        });

        marker.on('popupopen', () => {
            finalNextList.forEach((np, idx) => {
                const targetP = window.activeYatraPadavs.find(item => String(item.id) === String(np.id));
                if (targetP) {
                    fetchRealRoadKmAsync(p, targetP, idx);
                }
            });
        });

        window.padavMarkersMap[p.id] = marker;

        if (window.ParikramaVisited) {
            window.ParikramaVisited.attachToMarker(window.padavLayer, marker, p);
        } else {
            marker.addTo(window.padavLayer);
        }
    });
}

function focusOnPadav(padavId) {
    const targetPadav = window.activeYatraPadavs.find(p => String(p.id) === String(padavId));
    const targetMarker = window.padavMarkersMap[padavId];
    if (targetPadav && window.map) {
        window.focusedOriginPadavId = targetPadav.id;
        applyMapFilters();
        window.map.flyTo([targetPadav.lat, targetPadav.lng], 13);
        const refreshedMarker = window.padavMarkersMap[padavId] || targetMarker;
        if (refreshedMarker) {
            if (!window.padavLayer.hasLayer(refreshedMarker)) {
                refreshedMarker.addTo(window.padavLayer);
            }
            refreshedMarker.openPopup();
        }
    }
}

function applyMapFilters() {
    const subVal = document.getElementById('subRouteFilter').value;
    const catVal = document.getElementById('categoryFilter').value;

    const filtered = window.activeYatraPadavs.filter(p =>
        (subVal === 'all' || p.sub_route === subVal) &&
        (catVal === 'all' || p.category === catVal)
    );
    renderIsolatedPadavs(filtered);
}

// =========================================================
// 1. SEPARATE FUNCTION: MANUAL POINT-TO-POINT LINE DRAWER
// =========================================================
function startManualLineDrawing() {
    if (window.isGpsFollowActive) cancelGpsFollowRecording();

    window.isManualDrawing = true;
    window.manualDrawnPoints = [];
    window.manualHistoryStack = [];

    const hud = document.getElementById('liveYatraNavHud');
    if (hud) hud.style.display = 'none';

    const toolbar = document.getElementById('manualDrawToolbar');
    if (toolbar) {
        toolbar.style.display = 'block';
        toolbar.style.cursor = 'move';
        makeElementMovable(toolbar);
    }
    document.getElementById('manualPointsCount').innerText = '0 points';
    document.getElementById('manualDrawStatus').innerText = 'मैप पर एक बिंदु से दूसरे बिंदु तक क्लिक करके लाइन खींचें।';
}

function startRouteDrawing() {
    startManualLineDrawing();
}

async function handleManualMapClickPoint(lat, lng) {
    const snapChk = document.getElementById('chkSnapToRoad');
    const useRoadSnap = snapChk ? snapChk.checked : true;
    const statusEl = document.getElementById('manualDrawStatus');

    if (window.manualDrawnPoints.length === 0 || !useRoadSnap) {
        window.manualDrawnPoints.push([lat, lng]);
        window.manualHistoryStack.push(1);
        updateManualTempLine();
        if (statusEl) statusEl.innerText = 'अगले बिंदु पर क्लिक करें।';
        return;
    }

    const prevPt = window.manualDrawnPoints[window.manualDrawnPoints.length - 1];
    if (statusEl) statusEl.innerHTML = '<span style="color:#0288d1;">⏳ सड़क के अनुसार लाइन जोड़ी जा रही है...</span>';

    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${prevPt[1]},${prevPt[0]};${lng},${lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            const snapped = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]).slice(1);
            if (snapped.length > 0) {
                window.manualDrawnPoints.push(...snapped);
                window.manualHistoryStack.push(snapped.length);
                updateManualTempLine();
                if (statusEl) statusEl.innerHTML = '<span style="color:#2e7d32;">✅ जुड़ गया। अगला बिंदु चुनें या सेव करें।</span>';
                return;
            }
        }
    } catch (e) {}

    window.manualDrawnPoints.push([lat, lng]);
    window.manualHistoryStack.push(1);
    updateManualTempLine();
    if (statusEl) statusEl.innerText = 'बिंदु जोड़ा गया।';
}

function updateManualTempLine() {
    document.getElementById('manualPointsCount').innerText = `${window.manualDrawnPoints.length} points`;
    if (window.manualTempLine) window.map.removeLayer(window.manualTempLine);
    if (window.manualDrawnPoints.length > 0) {
        window.manualTempLine = L.polyline(window.manualDrawnPoints, {
            color: '#2e7d32',
            weight: 5,
            dashArray: '8, 6'
        }).addTo(window.map);
    }
}

function undoManualDrawPoint() {
    if (window.manualDrawnPoints.length === 0) return;
    const count = window.manualHistoryStack.pop() || 1;
    window.manualDrawnPoints.splice(-count, count);
    updateManualTempLine();
}

function cancelManualLineDrawing() {
    window.isManualDrawing = false;
    window.manualDrawnPoints = [];
    window.manualHistoryStack = [];
    if (window.manualTempLine) window.map.removeLayer(window.manualTempLine);
    document.getElementById('manualDrawToolbar').style.display = 'none';
    applyMapFilters();
}

async function saveManualDrawnRoute() {
    if (window.manualDrawnPoints.length < 2) return alert("कम से कम 2 बिंदु चुनें।");
    const routeName = prompt("इस मार्ग का नाम लिखें (जैसे: ओंकारेश्वर से मोरटक्का मार्ग):");
    if (!routeName) return;

    const subRoute = document.getElementById('subRouteFilter').value !== 'all'
        ? document.getElementById('subRouteFilter').value
        : (window.activeYatra.sub_routes?.[0] || 'Main Route');

    const newRouteObj = {
        yatra_id: window.activeYatra.id,
        sub_route: subRoute,
        route_name: routeName,
        coordinates: [...window.manualDrawnPoints],
        color: window.activeYatra.theme_color || '#d84315'
    };

    const { data, error } = await supabaseClient.from('yatra_routes').insert([newRouteObj]).select().single();
    if (error) return alert("Route save error: " + error.message);

    window.activeCustomRoutes.push(data || newRouteObj);

    L.polyline(newRouteObj.coordinates, {
        color: newRouteObj.color,
        weight: 5,
        opacity: 0.92
    }).bindPopup(`<b>🛣️ ${routeName}</b><br><small>${subRoute}</small>`).addTo(window.routeLayer);

    cancelManualLineDrawing();
    alert("✅ आपका कस्टम मार्ग और उसकी सटीक दूरी सेव हो गई है!");
}

// =========================================================
// 2. SEPARATE FUNCTION: GPS FOLLOW RECORDER (ANTI-JUMP)
// =========================================================
function startGpsFollowRecording() {
    if (window.isManualDrawing) cancelManualLineDrawing();

    if (!navigator.geolocation) {
        return alert("आपका मोबाइल/ब्राउज़र GPS सपोर्ट नहीं करता।");
    }

    window.isGpsFollowActive = true;
    window.isGpsPaused = false;
    window.gpsRecordedPoints = [];
    window.lastValidGpsPt = null;
    window.lastValidGpsTime = 0;

    const hud = document.getElementById('liveYatraNavHud');
    if (hud) hud.style.display = 'none';

    const gpsToolbar = document.getElementById('gpsFollowToolbar');
    if (gpsToolbar) {
        gpsToolbar.style.display = 'block';
        gpsToolbar.style.cursor = 'move';
        makeElementMovable(gpsToolbar);
    }
    document.getElementById('gpsPointsCount').innerText = '0 points';
    const statusEl = document.getElementById('gpsFollowStatus');
    const pauseBtn = document.getElementById('btnPauseResumeGps');
    if (pauseBtn) {
        pauseBtn.innerText = '⏸️ रोकें';
        pauseBtn.style.background = '#ff9800';
    }
    if (statusEl) statusEl.innerHTML = '<span style="color:#0288d1;">📡 सटीक GPS सिग्नल की प्रतीक्षा...</span>';

    window.gpsWatchId = navigator.geolocation.watchPosition(pos => {
        if (!window.isGpsFollowActive || window.isGpsPaused) return;

        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc = pos.coords.accuracy || 999;
        const now = Date.now();

        if (acc > 35) {
            if (statusEl) statusEl.innerHTML = `<span style="color:#e65100;">⚠️ GPS सिग्नल कमज़ोर (±${Math.round(acc)}m), स्थिर होने की प्रतीक्षा...</span>`;
            return;
        }

        if (window.map) window.map.panTo([lat, lng]);

        if (!window.lastValidGpsPt) {
            window.lastValidGpsPt = [lat, lng];
            window.lastValidGpsTime = now;
            window.gpsRecordedPoints.push([lat, lng]);
            updateGpsTempLine();
            if (statusEl) statusEl.innerHTML = `<span style="color:#2e7d32;">🟢 GPS रिकॉर्डिंग चालू (±${Math.round(acc)}m सटीक)</span>`;
            return;
        }

        const distMoved = getDistanceInMeters(window.lastValidGpsPt[0], window.lastValidGpsPt[1], lat, lng);
        const timeDiffSec = Math.max((now - window.lastValidGpsTime) / 1000, 1);
        const speedMps = distMoved / timeDiffSec;

        if (distMoved < 12) return;

        if (distMoved > 120 || speedMps > 25) {
            console.warn(`GPS Jump Blocked: ${Math.round(distMoved)}m`);
            if (statusEl) statusEl.innerHTML = `<span style="color:#d84315;">🛡️ GPS जंप रोका गया (${Math.round(distMoved)}m उछाल फ़िल्टर)</span>`;
            return;
        }

        window.lastValidGpsPt = [lat, lng];
        window.lastValidGpsTime = now;
        window.gpsRecordedPoints.push([lat, lng]);
        updateGpsTempLine();

        if (statusEl) statusEl.innerHTML = `<span style="color:#2e7d32;">🟢 मार्ग रिकॉर्ड हो रहा है (±${Math.round(acc)}m सटीक)</span>`;
    }, err => {
        if (statusEl) statusEl.innerHTML = `<span style="color:#dc3545;">❌ GPS त्रुटि: ${err.message}</span>`;
    }, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000
    });
}

function pauseResumeGpsFollow() {
    window.isGpsPaused = !window.isGpsPaused;
    const btn = document.getElementById('btnPauseResumeGps');
    const statusEl = document.getElementById('gpsFollowStatus');
    if (window.isGpsPaused) {
        btn.innerText = '▶️ फिर चालू करें';
        btn.style.background = '#2e7d32';
        statusEl.innerText = '⏸️ GPS रिकॉर्डिंग रुकी हुई है।';
    } else {
        btn.innerText = '⏸️ रोकें';
        btn.style.background = '#ff9800';
        statusEl.innerText = '🟢 GPS रिकॉर्डिंग फिर से चालू...';
    }
}

function updateGpsTempLine() {
    document.getElementById('gpsPointsCount').innerText = `${window.gpsRecordedPoints.length} points`;
    if (window.gpsTempLine) window.map.removeLayer(window.gpsTempLine);
    if (window.gpsRecordedPoints.length > 0) {
        window.gpsTempLine = L.polyline(window.gpsRecordedPoints, {
            color: '#0288d1',
            weight: 5
        }).addTo(window.map);
    }
}

function cancelGpsFollowRecording() {
    window.isGpsFollowActive = false;
    window.isGpsPaused = false;
    if (window.gpsWatchId !== null) {
        navigator.geolocation.clearWatch(window.gpsWatchId);
        window.gpsWatchId = null;
    }
    window.gpsRecordedPoints = [];
    if (window.gpsTempLine) window.map.removeLayer(window.gpsTempLine);
    document.getElementById('gpsFollowToolbar').style.display = 'none';
    applyMapFilters();
}

async function saveGpsFollowedRoute() {
    if (window.gpsRecordedPoints.length < 2) return alert("कम से कम 2 GPS बिंदु रिकॉर्ड होने दें।");
    const routeName = prompt("इस GPS मार्ग का नाम लिखें:");
    if (!routeName) return;

    const subRoute = document.getElementById('subRouteFilter').value !== 'all'
        ? document.getElementById('subRouteFilter').value
        : (window.activeYatra.sub_routes?.[0] || 'Main Route');

    const newRouteObj = {
        yatra_id: window.activeYatra.id,
        sub_route: subRoute,
        route_name: routeName,
        coordinates: [...window.gpsRecordedPoints],
        color: '#0288d1'
    };

    const { data, error } = await supabaseClient.from('yatra_routes').insert([newRouteObj]).select().single();
    if (error) return alert("Save Error: " + error.message);

    window.activeCustomRoutes.push(data || newRouteObj);

    L.polyline(newRouteObj.coordinates, {
        color: '#0288d1',
        weight: 5,
        opacity: 0.92
    }).bindPopup(`<b>📡 ${routeName}</b><br><small>${subRoute}</small>`).addTo(window.routeLayer);

    cancelGpsFollowRecording();
    alert("✅ GPS द्वारा रिकॉर्ड किया गया मार्ग और उसकी सटीक दूरी सेव हो गई है!");
}