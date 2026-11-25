// =========================================================
// PARIKRAMAPATH - LIVE ACTIVE YATRI TRACKER (ALL YATRAS FOR SUPER_ADMIN & ADMIN)
// =========================================================

let yatriPingInterval = null;
let adminLiveLayer = null;
let adminLiveRealtime = null;
let liveYatriMarkers = {};
let isAdminLiveVisible = true;
let cachedYatrasNameMap = {};

function isStrictAdmin() {
    if (!window.currentProfile) return false;
    const cleanRole = (window.currentProfile.role || '').toLowerCase().trim().replace(/\s+/g, '_');
    return (cleanRole === 'super_admin' || cleanRole === 'admin');
}

async function ensureYatrasNameMap() {
    if (Object.keys(cachedYatrasNameMap).length > 0) return cachedYatrasNameMap;

    if (Array.isArray(window.allYatrasList)) {
        window.allYatrasList.forEach(y => {
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

// 1. Active Yatri ki GPS location har 30 second me update karein
function startYatriLocationBroadcast() {
    if (yatriPingInterval) return;

    const sendPing = () => {
        if (!window.currentUser || !window.activeYatra) return;
        if (!navigator.geolocation) return;

        navigator.geolocation.getCurrentPosition(async (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            window.yatriLiveCoords = { lat, lng };

            await supabaseClient
                .from('profiles')
                .update({
                    live_lat: lat,
                    live_lng: lng,
                    active_yatra_id: window.activeYatra.id,
                    last_seen_at: new Date().toISOString()
                })
                .eq('id', window.currentUser.id);
        }, () => {}, { enableHighAccuracy: true, timeout: 8000 });
    };

    sendPing();
    yatriPingInterval = setInterval(sendPing, 30000);
}

// 2. Sirf super_admin aur admin ke liye Floating Toggle Button aur Live Map Layer (Sabhi Yatras ke liye)
function initAdminLiveYatriTracker() {
    if (!isStrictAdmin()) return;

    injectAdminLiveToggleBtn();
    loadAndRenderActiveYatris();
    subscribeAdminLiveYatris();
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

function plotSingleYatriMarker(yatri) {
    if (!isStrictAdmin()) return;
    const mapObj = getMapInstance();
    if (!mapObj || !yatri.live_lat || !yatri.live_lng) return;

    if (!adminLiveLayer) {
        adminLiveLayer = L.layerGroup().addTo(mapObj);
    } else if (!mapObj.hasLayer(adminLiveLayer) && isAdminLiveVisible) {
        adminLiveLayer.addTo(mapObj);
    }

    const seenTime = yatri.last_seen_at
        ? new Date(yatri.last_seen_at).toLocaleTimeString('hi-IN', { hour: '2-digit', minute: '2-digit' })
        : 'अभी';

    const yatraLabel = yatri.active_yatra_id
        ? (cachedYatrasNameMap[String(yatri.active_yatra_id)] || 'सक्रिय परिक्रमा')
        : 'परिक्रमा';

    const icon = L.divIcon({
        className: 'admin-live-yatri-pin',
        html: `<div style="background:#1565c0; color:#fff; border:2px solid #fff; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-size:15px; box-shadow:0 2px 8px rgba(0,0,0,0.45);">🚶</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });

    const popupHtml = `
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

    if (liveYatriMarkers[yatri.id]) {
        liveYatriMarkers[yatri.id].setLatLng([yatri.live_lat, yatri.live_lng]);
        liveYatriMarkers[yatri.id].setPopupContent(popupHtml);
    } else {
        const marker = L.marker([yatri.live_lat, yatri.live_lng], { icon }).bindPopup(popupHtml);
        marker.addTo(adminLiveLayer);
        liveYatriMarkers[yatri.id] = marker;
    }

    const btn = document.getElementById('adminLiveYatriBtn');
    if (btn && isAdminLiveVisible) {
        btn.innerText = `👥 लाइव यात्री (${Object.keys(liveYatriMarkers).length})`;
    }
}

async function loadAndRenderActiveYatris() {
    if (!isStrictAdmin() || !isAdminLiveVisible) return;
    const mapObj = getMapInstance();
    if (!mapObj) return;

    await ensureYatrasNameMap();

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('id, full_name, mobile, role, active_yatra_id, live_lat, live_lng, last_seen_at')
        .not('live_lat', 'is', null)
        .gte('last_seen_at', twoHoursAgo);

    if (error || !Array.isArray(data)) return;

    const btn = document.getElementById('adminLiveYatriBtn');
    if (btn) {
        btn.innerText = `👥 लाइव यात्री (${data.length})`;
    }

    data.forEach(plotSingleYatriMarker);
}

function subscribeAdminLiveYatris() {
    if (!isStrictAdmin() || adminLiveRealtime) return;

    adminLiveRealtime = supabaseClient
        .channel('public:profiles_live_yatris')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, async (payload) => {
            if (isStrictAdmin() && isAdminLiveVisible && payload && payload.new && payload.new.live_lat) {
                await ensureYatrasNameMap();
                plotSingleYatriMarker(payload.new);
            }
        })
        .subscribe();
}