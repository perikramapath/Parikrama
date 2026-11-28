// =========================================================
// PARIKRAMAPATH - LIVE ACTIVE YATRI TRACKER (BACKGROUND + RESUME + 2-MIN ADMIN REFRESH)
// =========================================================

let yatriPingInterval = null;
let yatriWatchId = null;
let adminRefreshInterval = null;
let adminLiveLayer = null;
let adminLiveRealtime = null;
let adminGuestRealtime = null;
let liveYatriMarkers = {};
let knownOnlineYatriKeys = new Set();
let hasInitialYatriLoadDone = false;
let isAdminLiveVisible = true;
let cachedYatrasNameMap = {};
let lastPendingUpdatesSignature = '';
let screenWakeLockSentinel = null;
let lifecycleListenersAttached = false;

function isStrictAdmin() {
    if (!window.currentProfile) return false;
    const cleanRole = (window.currentProfile.role || '').toLowerCase().trim().replace(/\s+/g, '_');
    return (cleanRole === 'super_admin' || cleanRole === 'admin');
}

function getGuestVisitorIdSafe() {
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

async function ensureYatrasNameMap() {
    if (Array.isArray(window.allYatrasList)) {
        window.allYatrasList.forEach(y => {
            cachedYatrasNameMap[String(y.id)] = y.name_hi || y.name;
        });
    }
    if (Array.isArray(window.allYatras)) {
        window.allYatras.forEach(y => {
            cachedYatrasNameMap[String(y.id)] = y.name_hi || y.name;
        });
    }
    if (window.activeYatra && window.activeYatra.id) {
        cachedYatrasNameMap[String(window.activeYatra.id)] = window.activeYatra.name_hi || window.activeYatra.name;
    }

    if (Object.keys(cachedYatrasNameMap).length === 0 && typeof supabaseClient !== 'undefined') {
        try {
            const { data } = await supabaseClient.from('yatras').select('id, name, name_hi');
            if (Array.isArray(data)) {
                data.forEach(y => {
                    cachedYatrasNameMap[String(y.id)] = y.name_hi || y.name;
                });
            }
        } catch (e) {}
    }

    return cachedYatrasNameMap;
}

// =========================================================
// SCREEN WAKE LOCK (SCREEN BAND HONE SE BACHANE KE LIYE JAB MAP KHULA HO)
// =========================================================
async function requestAppWakeLock() {
    try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') {
            if (!screenWakeLockSentinel || screenWakeLockSentinel.released) {
                screenWakeLockSentinel = await navigator.wakeLock.request('screen');
            }
        }
    } catch (e) {}
}

// =========================================================
// TOAST NOTIFICATION FOR ADMIN (NAYA YATRI / UPDATE AANE PAR)
// =========================================================
function showAdminLiveToast(message, bgColor = '#1b5e20') {
    if (!isStrictAdmin()) return;
    let toast = document.getElementById('adminLiveUpdateToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'adminLiveUpdateToast';
        toast.style.cssText = 'position:fixed; top:66px; left:50%; transform:translateX(-50%); z-index:10000; color:#fff; padding:9px 16px; border-radius:24px; font-family:sans-serif; font-size:12.5px; font-weight:bold; box-shadow:0 4px 16px rgba(0,0,0,0.4); border:1.5px solid #fff; transition:opacity 0.3s ease; max-width:90%; text-align:center;';
        document.body.appendChild(toast);
    }
    toast.style.background = bgColor;
    toast.innerText = message;
    toast.style.opacity = '1';
    toast.style.display = 'block';

    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => { toast.style.display = 'none'; }, 320);
    }, 5000);
}

// =========================================================
// 1. YATRI LOCATION BROADCAST (REGISTERED + GUEST, BACKGROUND & RESUME SAFE)
// =========================================================
async function pushCoordinatesToDatabase(lat, lng) {
    if (!window.activeYatra || !navigator.onLine || typeof supabaseClient === 'undefined') return;
    window.yatriLiveCoords = { lat, lng };

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
            const visitorId = getGuestVisitorIdSafe();
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

function sendImmediateYatriGpsPing() {
    if (!window.activeYatra || !navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            await pushCoordinatesToDatabase(pos.coords.latitude, pos.coords.longitude);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
}

function startYatriLocationBroadcast() {
    attachAppLifecycleSyncListeners();
    requestAppWakeLock();

    if (!yatriPingInterval) {
        sendImmediateYatriGpsPing();
        yatriPingInterval = setInterval(sendImmediateYatriGpsPing, 30000);
    }

    if (yatriWatchId === null && navigator.geolocation) {
        yatriWatchId = navigator.geolocation.watchPosition(
            async (pos) => {
                if (pos.coords.accuracy && pos.coords.accuracy > 150) return;
                await pushCoordinatesToDatabase(pos.coords.latitude, pos.coords.longitude);
            },
            () => {},
            { enableHighAccuracy: true, maximumAge: 5000 }
        );
    }
}

// =========================================================
// 2. ADMIN LIVE TRACKER + 2-MINUTE AUTO REFRESH + UPDATE DETECTOR
// =========================================================
function initAdminLiveYatriTracker() {
    if (!isStrictAdmin()) return;

    attachAppLifecycleSyncListeners();
    requestAppWakeLock();
    injectAdminLiveToggleBtn();
    loadAndRenderActiveYatris();
    subscribeAdminLiveYatris(false);

    // Har 2 minute (120000 ms) me background refresh (cache ko bina chhede)
    if (!adminRefreshInterval) {
        adminRefreshInterval = setInterval(() => {
            if (!isStrictAdmin()) return;
            loadAndRenderActiveYatris();
            checkAdminPendingUpdates();
        }, 120000);
    }
}

function injectAdminLiveToggleBtn() {
    if (!isStrictAdmin()) return;
    if (document.getElementById('adminLiveYatriBtn')) return;

    const btn = document.createElement('button');
    btn.id = 'adminLiveYatriBtn';
    btn.type = 'button';
    btn.innerText = '👥 लाइव यात्री: ON';
    btn.style.cssText = 'position:fixed; bottom:74px; left:14px; z-index:9998; background:#1565c0; color:#fff; border:2px solid #fff; border-radius:24px; padding:8px 14px; font-size:12.5px; font-weight:bold; box-shadow:0 4px 14px rgba(0,0,0,0.35); cursor:pointer;';

    btn.onclick = () => {
        isAdminLiveVisible = !isAdminLiveVisible;
        btn.innerText = isAdminLiveVisible ? '👥 लाइव यात्री: ON' : '👥 लाइव यात्री: OFF';
        btn.style.background = isAdminLiveVisible ? '#1565c0' : '#546e7a';

        const mapObj = getMapInstance();
        if (!isAdminLiveVisible && adminLiveLayer && mapObj) {
            mapObj.removeLayer(adminLiveLayer);
        } else if (isAdminLiveVisible) {
            loadAndRenderActiveYatris();
        }
    };

    document.body.appendChild(btn);
}

function getMapInstance() {
    return window.map || (typeof map !== 'undefined' ? map : null);
}

function plotSingleYatriMarker(yatri, isGuest = false) {
    if (!isStrictAdmin()) return;
    const mapObj = getMapInstance();
    if (!mapObj || !yatri || !yatri.live_lat || !yatri.live_lng) return;

    const markerKey = isGuest ? `guest_${yatri.visitor_id}` : `user_${yatri.id}`;
    const yatraId = isGuest ? yatri.yatra_id : yatri.active_yatra_id;

    // Naya yatri online aaya ho to Admin ko turant batayein
    if (hasInitialYatriLoadDone && !knownOnlineYatriKeys.has(markerKey)) {
        const yatraName = yatraId ? (cachedYatrasNameMap[String(yatraId)] || 'परिक्रमा') : 'परिक्रमा';
        const whoLabel = isGuest ? 'एक नया Guest यात्री' : `🚶 ${yatri.full_name || 'यात्री'}`;
        showAdminLiveToast(`🟢 ${whoLabel} (${yatraName}) अभी ऑनलाइन जुड़ा!`, '#1b5e20');
    }
    knownOnlineYatriKeys.add(markerKey);

    if (!adminLiveLayer) {
        adminLiveLayer = L.layerGroup().addTo(mapObj);
    } else if (!mapObj.hasLayer(adminLiveLayer) && isAdminLiveVisible) {
        adminLiveLayer.addTo(mapObj);
    }

    const seenTime = yatri.last_seen_at
        ? new Date(yatri.last_seen_at).toLocaleTimeString('hi-IN', { hour: '2-digit', minute: '2-digit' })
        : 'अभी';

    const yatraLabel = yatraId
        ? (cachedYatrasNameMap[String(yatraId)] || 'सक्रिय परिक्रमा')
        : 'परिक्रमा';

    const bgColor = isGuest ? '#e65100' : '#1565c0';
    const emoji = isGuest ? '🧭' : '🚶';

    const icon = L.divIcon({
        className: 'admin-live-yatri-pin',
        html: `<div style="background:${bgColor}; color:#fff; border:2px solid #fff; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-size:15px; box-shadow:0 2px 8px rgba(0,0,0,0.45);">${emoji}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });

    const popupHtml = isGuest
        ? `
            <div style="font-family:sans-serif; min-width:190px; font-size:13px; line-height:1.5;">
                <b style="color:#e65100; font-size:14px;">🧭 Guest यात्री (Unregistered)</b><br>
                <span style="display:inline-block; background:#fff3e0; color:#d84315; padding:1px 6px; border-radius:4px; font-size:11.5px; font-weight:bold; margin:2px 0;">🚩 ${yatraLabel}</span><br>
                <span><b>🕒 अंतिम लोकेशन:</b> ${seenTime}</span><br>
                <div style="margin-top:6px;">
                    <a href="https://www.google.com/maps?q=${yatri.live_lat},${yatri.live_lng}" target="_blank" style="display:block; text-align:center; background:#e65100; color:#fff; padding:4px 6px; border-radius:5px; text-decoration:none; font-size:12px; font-weight:bold;">📍 मैप पर देखें</a>
                </div>
            </div>
        `
        : `
            <div style="font-family:sans-serif; min-width:195px; font-size:13px; line-height:1.5;">
                <b style="color:#1565c0; font-size:14px;">🚶 ${yatri.full_name || 'यात्री'}</b><br>
                <span style="display:inline-block; background:#fff3e0; color:#d84315; padding:1px 6px; border-radius:4px; font-size:11.5px; font-weight:bold; margin:2px 0;">🚩 ${yatraLabel}</span><br>
                <span><b>📞 मोबाइल:</b> <a href="tel:${yatri.mobile}">${yatri.mobile || 'N/A'}</a></span><br>
                <span><b>🕒 अंतिम लोकेशन:</b> ${seenTime}</span><br>
                <div style="margin-top:6px; display:flex; gap:6px;">
                    <a href="tel:${yatri.mobile}" style="flex:1; text-align:center; background:#2e7d32; color:#fff; padding:4px 6px; border-radius:5px; text-decoration:none; font-size:12px; font-weight:bold;">📞 कॉल</a>
                    <a href="https://www.google.com/maps?q=${yatri.live_lat},${yatri.live_lng}" target="_blank" style="flex:1; text-align:center; background:#1565c0; color:#fff; padding:4px 6px; border-radius:5px; text-decoration:none; font-size:12px; font-weight:bold;">📍 मैप</a>
                </div>
            </div>
        `;

    if (liveYatriMarkers[markerKey]) {
        liveYatriMarkers[markerKey].setLatLng([yatri.live_lat, yatri.live_lng]);
        liveYatriMarkers[markerKey].setPopupContent(popupHtml);
        if (adminLiveLayer && !adminLiveLayer.hasLayer(liveYatriMarkers[markerKey])) {
            liveYatriMarkers[markerKey].addTo(adminLiveLayer);
        }
    } else {
        const marker = L.marker([yatri.live_lat, yatri.live_lng], { icon }).bindPopup(popupHtml);
        marker.addTo(adminLiveLayer);
        liveYatriMarkers[markerKey] = marker;
    }

    const btn = document.getElementById('adminLiveYatriBtn');
    if (btn && isAdminLiveVisible) {
        btn.innerText = `👥 लाइव यात्री (${Object.keys(liveYatriMarkers).length})`;
    }
}

async function loadAndRenderActiveYatris() {
    if (!isStrictAdmin() || !isAdminLiveVisible || !navigator.onLine) return;
    const mapObj = getMapInstance();
    if (!mapObj) return;

    await ensureYatrasNameMap();

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const activeKeysThisRound = new Set();

    const { data: regData } = await supabaseClient
        .from('profiles')
        .select('id, full_name, mobile, role, active_yatra_id, live_lat, live_lng, last_seen_at')
        .not('live_lat', 'is', null)
        .gte('last_seen_at', twoHoursAgo);

    if (Array.isArray(regData)) {
        regData.forEach(u => {
            activeKeysThisRound.add(`user_${u.id}`);
            plotSingleYatriMarker(u, false);
        });
    }

    const { data: guestData } = await supabaseClient
        .from('live_visitors')
        .select('visitor_id, yatra_id, live_lat, live_lng, last_seen_at')
        .gte('last_seen_at', twoHoursAgo);

    if (Array.isArray(guestData)) {
        guestData.forEach(g => {
            activeKeysThisRound.add(`guest_${g.visitor_id}`);
            plotSingleYatriMarker(g, true);
        });
    }

    // Purane inactive markers (jo 2 ghante se offline hain) saaf karein
    Object.keys(liveYatriMarkers).forEach(k => {
        if (!activeKeysThisRound.has(k)) {
            if (adminLiveLayer) adminLiveLayer.removeLayer(liveYatriMarkers[k]);
            delete liveYatriMarkers[k];
            knownOnlineYatriKeys.delete(k);
        }
    });

    hasInitialYatriLoadDone = true;

    const btn = document.getElementById('adminLiveYatriBtn');
    if (btn && isAdminLiveVisible) {
        btn.innerText = `👥 लाइव यात्री (${Object.keys(liveYatriMarkers).length})`;
    }
}

// =========================================================
// CHECK NEW PENDING PADAVS / DIARIES FOR ADMIN (2-MIN CHECK)
// =========================================================
async function checkAdminPendingUpdates() {
    if (!isStrictAdmin() || !navigator.onLine || typeof supabaseClient === 'undefined') return;

    try {
        const [{ count: pendingPadavsCount }, { count: pendingDiariesCount }] = await Promise.all([
            supabaseClient.from('padavs').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
            supabaseClient.from('yatra_diaries').select('id', { count: 'exact', head: true }).eq('status', 'pending')
        ]);

        const pCount = pendingPadavsCount || 0;
        const dCount = pendingDiariesCount || 0;
        const sig = `${pCount}_${dCount}`;

        if (lastPendingUpdatesSignature && sig !== lastPendingUpdatesSignature && (pCount > 0 || dCount > 0)) {
            showAdminLiveToast(`🔔 नया अपडेट: ${pCount} पेंडिंग पड़ाव • ${dCount} पेंडिंग डायरी`, '#e65100');
        }
        lastPendingUpdatesSignature = sig;
    } catch (e) {}
}

function subscribeAdminLiveYatris(forceReconnect = false) {
    if (!isStrictAdmin() || typeof supabaseClient === 'undefined') return;

    if (forceReconnect) {
        try {
            if (adminLiveRealtime) supabaseClient.removeChannel(adminLiveRealtime);
            if (adminGuestRealtime) supabaseClient.removeChannel(adminGuestRealtime);
        } catch (e) {}
        adminLiveRealtime = null;
        adminGuestRealtime = null;
    }

    if (!adminLiveRealtime) {
        adminLiveRealtime = supabaseClient
            .channel('public:profiles_live_yatris')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, async (payload) => {
                if (isStrictAdmin() && isAdminLiveVisible && payload && payload.new && payload.new.live_lat) {
                    await ensureYatrasNameMap();
                    plotSingleYatriMarker(payload.new, false);
                }
            })
            .subscribe();
    }

    if (!adminGuestRealtime) {
        adminGuestRealtime = supabaseClient
            .channel('public:live_visitors_live_yatris')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'live_visitors' }, async (payload) => {
                if (isStrictAdmin() && isAdminLiveVisible && payload && payload.new && payload.new.live_lat) {
                    await ensureYatrasNameMap();
                    plotSingleYatriMarker(payload.new, true);
                }
            })
            .subscribe();
    }
}

// =========================================================
// 3. APP RESUME / SCREEN UNLOCK / NETWORK RETURN HANDLER
// (App se bahar jaakar wapas aane par turant sync + map fix)
// =========================================================
function handleAppResumeOrUnlock() {
    requestAppWakeLock();

    const mapObj = getMapInstance();
    if (mapObj && typeof mapObj.invalidateSize === 'function') {
        setTimeout(() => mapObj.invalidateSize(), 150);
    }

    // Yatri ke liye: turant GPS ping bhejein
    if (window.activeYatra) {
        sendImmediateYatriGpsPing();
    }

    // Admin ke liye: turant live yatris reload, pending updates check aur realtime reconnect karein
    if (isStrictAdmin()) {
        loadAndRenderActiveYatris();
        checkAdminPendingUpdates();
        subscribeAdminLiveYatris(true);
    }
}

function attachAppLifecycleSyncListeners() {
    if (lifecycleListenersAttached) return;
    lifecycleListenersAttached = true;

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            handleAppResumeOrUnlock();
        }
    });

    window.addEventListener('pageshow', () => {
        handleAppResumeOrUnlock();
    });

    window.addEventListener('focus', () => {
        handleAppResumeOrUnlock();
    });

    window.addEventListener('online', () => {
        handleAppResumeOrUnlock();
    });
}