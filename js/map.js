// =========================================================
// PARIKRAMAPATH - SEPARATE LINE DRAWER, READ MORE & ANTI-JUMP GPS
// =========================================================

window.map = null;
window.padavLayer = L.layerGroup();
window.routeLayer = L.layerGroup();
window.autoPadavLinkLayer = L.layerGroup();
window.activeYatraPadavs = [];
window.activeCustomRoutes = [];
window.padavMarkersMap = {};
window.osrmGeometryCache = {};

// Live Yatri GPS Tracking & 500m Auto-Hide
window.yatriLiveCoords = null;
window.yatriLiveMarker = null;
window.passedPadavIds = new Set();
window.isPickingEditLocation = false;

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

function quickCalcKm(lat1, lng1, lat2, lng2) {
    return parseFloat(((getDistanceInMeters(lat1, lng1, lat2, lng2) / 1000) * 1.25).toFixed(1));
}

function isUserAdminOrMod() {
    if (!window.currentProfile || !window.currentProfile.role) return false;
    const r = window.currentProfile.role.toLowerCase().trim().replace(/\s+/g, '_');
    return (r === 'super_admin' || r === 'admin' || r === 'moderator');
}

// =========================================================
// CHECK IF CUSTOM DRAWN ROUTE ALREADY EXISTS BETWEEN TWO PADAVS
// =========================================================
function hasCustomDrawnRouteBetween(lat1, lng1, lat2, lng2) {
    const routes = window.activeCustomRoutes || [];
    const snapToleranceMeters = 350; // 350m ke dayre me agar custom line start/end ya guzarti hai

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
// YATRI LIVE PROGRESS TRACKER (500M AAGE JANE PAR PICHHLA PADAV HIDE)
// =========================================================
function startYatriLiveProgressTracker() {
    if (!navigator.geolocation) return;

    navigator.geolocation.watchPosition(pos => {
        if (pos.coords.accuracy && pos.coords.accuracy > 50) return;

        const uLat = pos.coords.latitude;
        const uLng = pos.coords.longitude;
        window.yatriLiveCoords = { lat: uLat, lng: uLng };

        if (window.map) {
            if (!window.yatriLiveMarker) {
                const yatriIcon = L.divIcon({
                    html: `<div style="background:#1976d2; border:3px solid white; border-radius:50%; width:16px; height:16px; box-shadow:0 0 10px rgba(25,118,210,0.9);"></div>`,
                    className: '',
                    iconSize: [16, 16]
                });
                window.yatriLiveMarker = L.marker([uLat, uLng], { icon: yatriIcon })
                    .bindPopup('🚶 <b>आपकी वर्तमान लोकेशन</b>')
                    .addTo(window.map);
            } else {
                window.yatriLiveMarker.setLatLng([uLat, uLng]);
            }
        }

        if (isUserAdminOrMod()) return;

        let statusChanged = false;
        (window.activeYatraPadavs || []).forEach(p => {
            if (window.passedPadavIds.has(p.id)) return;
            const distFromPadav = getDistanceInMeters(uLat, uLng, p.lat, p.lng);

            if (distFromPadav > 500) {
                let nextArr = p.next_padavs;
                if (typeof nextArr === 'string') {
                    try { nextArr = JSON.parse(nextArr); } catch (e) { nextArr = []; }
                }

                if (Array.isArray(nextArr) && nextArr.length > 0) {
                    const targetObj = window.activeYatraPadavs.find(x => x.id === nextArr[0].id);
                    if (targetObj) {
                        const totalSpan = getDistanceInMeters(p.lat, p.lng, targetObj.lat, targetObj.lng);
                        const distToNext = getDistanceInMeters(uLat, uLng, targetObj.lat, targetObj.lng);
                        if (distToNext < totalSpan) {
                            window.passedPadavIds.add(p.id);
                            statusChanged = true;
                        }
                    }
                } else if (window.selectedStartPadav && window.selectedStartPadav.id === p.id) {
                    window.passedPadavIds.add(p.id);
                    statusChanged = true;
                }
            }
        });

        if (statusChanged) applyMapFilters();
    }, err => {
        console.warn("Live GPS tracking paused:", err.message);
    }, { enableHighAccuracy: true, maximumAge: 10000 });
}

async function initAndLoadIsolatedMap() {
    if (!window.activeYatra) return;

    const startLat = window.selectedStartPadav ? window.selectedStartPadav.lat : window.activeYatra.center_lat;
    const startLng = window.selectedStartPadav ? window.selectedStartPadav.lng : window.activeYatra.center_lng;
    const startZoom = window.selectedStartPadav ? 12 : (window.activeYatra.default_zoom || 10);

    if (!window.map) {
        window.map = L.map('map', { zoomControl: false }).setView([startLat, startLng], startZoom);
        L.control.zoom({ position: 'bottomright' }).addTo(window.map);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap | Parikramapath'
        }).addTo(window.map);

        window.routeLayer.addTo(window.map);
        window.autoPadavLinkLayer.addTo(window.map);
        window.padavLayer.addTo(window.map);

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

            // Koi bhi registered user map par click karke naya padav/point add kar sakta hai (approval ke baad dikhega)
            if (window.currentUser) {
                const latStr = clickLat.toFixed(6);
                const lngStr = clickLng.toFixed(6);
                const quickAddHtml = `
                    <div style="text-align:center; font-family:sans-serif; min-width:175px;">
                        <b style="font-size:12px; color:#333;">📍 चयनित स्थान</b><br>
                        <small style="color:#666;">${latStr}, ${lngStr}</small><br>
                        <button onclick="openAddPadavAtCoords('${latStr}', '${lngStr}')" 
                            style="margin-top:8px; width:100%; background:#2e7d32; color:white; border:none; padding:7px 10px; border-radius:5px; font-size:12px; font-weight:bold; cursor:pointer;">
                            ➕ यहाँ नया पड़ाव / पॉइंट जोड़ें
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
        window.map.setView([startLat, startLng], startZoom);
    }

    setTimeout(() => { if (window.map) window.map.invalidateSize(); }, 200);

    // 1. PEHLE CUSTOM DRAWN ROUTES LOAD KAREIN TAAKI AUTO-OSRM UNHE OVERLAP NA KARE
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

    // 2. AB PADAVS AUR SIRF BINA-CUSTOM-LINE WALE ROUTES RENDER KAREIN
    window.activeYatraPadavs = window.yatraPadavsForSelection || [];
    renderIsolatedPadavs(window.activeYatraPadavs);
}

async function drawAutoPadavConnectingLines(visibleList) {
    if (!window.autoPadavLinkLayer) return;
    window.autoPadavLinkLayer.clearLayers();

    const primaryColor = window.activeYatra?.theme_color || '#d84315';
    const altRouteColors = ['#1565c0', '#2e7d32', '#6a1b9a'];

    for (const p of visibleList) {
        if (!p.lat || !p.lng) continue;

        let nextPadavsArr = p.next_padavs;
        if (typeof nextPadavsArr === 'string') {
            try { nextPadavsArr = JSON.parse(nextPadavsArr); } catch (e) { nextPadavsArr = []; }
        }
        if (!Array.isArray(nextPadavsArr) || nextPadavsArr.length === 0) continue;

        for (let i = 0; i < nextPadavsArr.length; i++) {
            const np = nextPadavsArr[i];
            const targetP = window.activeYatraPadavs.find(item => item.id === np.id);
            if (!targetP || !targetP.lat || !targetP.lng) continue;

            // AGAR IN DO BINDUS KE BEECH PEHLE SE CUSTOM LINE DRAW KI GAYI HAI TO ROAD WALA AUTO-ROUTE SKIP KAREIN
            if (hasCustomDrawnRouteBetween(p.lat, p.lng, targetP.lat, targetP.lng)) {
                continue;
            }

            const isAlternateRoute = (i > 0);
            const routeColor = isAlternateRoute ? altRouteColors[(i - 1) % altRouteColors.length] : primaryColor;
            const routeBadge = nextPadavsArr.length > 1 ? `<b>[विकल्प मार्ग ${i + 1}]</b> ` : '';
            const lineTooltip = `${routeBadge}<b>${p.name} ➡️ ${targetP.name}</b><br><small>${np.path || 'परिक्रमा मार्ग'} • <b>${np.km || ''} km</b></small>`;

            const lineOptions = {
                color: routeColor,
                weight: isAlternateRoute ? 4 : 5,
                opacity: 0.88,
                dashArray: isAlternateRoute ? '8, 6' : null
            };

            const cacheKey = `${p.id}_${targetP.id}_${i}`;

            if (window.osrmGeometryCache[cacheKey]) {
                L.polyline(window.osrmGeometryCache[cacheKey], lineOptions)
                    .bindPopup(lineTooltip)
                    .addTo(window.autoPadavLinkLayer);
                continue;
            }

            try {
                const url = `https://router.project-osrm.org/route/v1/driving/${p.lng},${p.lat};${targetP.lng},${targetP.lat}?overview=full&geometries=geojson&alternatives=true`;
                const res = await fetch(url);
                const data = await res.json();

                if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                    const chosenRoute = data.routes[i] || data.routes[0];
                    let latLngs = chosenRoute.geometry.coordinates.map(c => [c[1], c[0]]);
                    if (isAlternateRoute && !data.routes[i]) {
                        latLngs = latLngs.map(([lat, lng]) => [lat + (0.0003 * i), lng + (0.0003 * i)]);
                    }
                    window.osrmGeometryCache[cacheKey] = latLngs;
                    L.polyline(latLngs, lineOptions)
                        .bindPopup(lineTooltip)
                        .addTo(window.autoPadavLinkLayer);
                    continue;
                }
            } catch (e) {}

            const offset = isAlternateRoute ? 0.0004 * i : 0;
            const fallbackCoords = [[p.lat + offset, p.lng + offset], [targetP.lat + offset, targetP.lng + offset]];
            window.osrmGeometryCache[cacheKey] = fallbackCoords;
            L.polyline(fallbackCoords, { ...lineOptions, dashArray: '8, 8' })
                .bindPopup(lineTooltip)
                .addTo(window.autoPadavLinkLayer);
        }
    }
}

function renderIsolatedPadavs(list) {
    if (!window.padavLayer || !Array.isArray(list)) return;
    window.padavLayer.clearLayers();
    window.padavMarkersMap = {};

    const adminMode = isUserAdminOrMod();
    const isLoggedInUser = !!window.currentUser;

    const visiblePadavs = adminMode
        ? list
        : list.filter(p => !window.passedPadavIds.has(p.id));

    drawAutoPadavConnectingLines(visiblePadavs);

    const yatraSlug = (window.activeYatra?.slug || '').toLowerCase();
    const yatraName = (window.activeYatra?.name || '').toLowerCase();
    const isNarmadaParikrama = yatraSlug.includes('narmada') || yatraName.includes('narmada');

    visiblePadavs.forEach(p => {
        if (!p.lat || !p.lng) return;

        const isStart = window.selectedStartPadav && window.selectedStartPadav.id === p.id;
        const isPointOnly = (p.category === 'Point');

        const emoji = isStart ? '🚩' : (
            p.category === 'Mandir' ? '🛕' :
            (p.category === 'Annakshetra' ? '🍛' :
            (p.category === 'Medical' ? '🏥' :
            (isPointOnly ? '📍' : '🛌')))
        );
        const borderCol = isStart ? '#2e7d32' : (isPointOnly ? '#546e7a' : (window.activeYatra?.theme_color || '#d84315'));
        const size = isStart ? 38 : (isPointOnly ? 26 : 30);

        const icon = L.divIcon({
            html: `<div style="background:white; border:3px solid ${borderCol}; border-radius:50%; width:${size}px; height:${size}px; display:flex; align-items:center; justify-content:center; font-size:${isPointOnly ? 14 : 17}px; box-shadow:0 3px 8px rgba(0,0,0,0.4);">${emoji}</div>`,
            className: '',
            iconSize: [size, size]
        });

        const startTag = isStart
            ? `<div style="background:#2e7d32; color:white; padding:4px; border-radius:4px; font-size:11px; font-weight:bold; margin-bottom:5px; text-align:center;">🚩 आपका प्रारंभिक पड़ाव</div>`
            : '';

        // 1-LINE DESCRIPTION + "READ MORE" BUTTON
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

        let nextPadavsArr = p.next_padavs;
        if (typeof nextPadavsArr === 'string') {
            try { nextPadavsArr = JSON.parse(nextPadavsArr); } catch(e) { nextPadavsArr = []; }
        }

        let finalNextList = (Array.isArray(nextPadavsArr) && nextPadavsArr.length > 0) ? nextPadavsArr : [];
        let isAutoSuggested = false;

        if (!isNarmadaParikrama && finalNextList.length === 0 && window.activeYatraPadavs.length > 1) {
            isAutoSuggested = true;
            finalNextList = window.activeYatraPadavs
                .filter(other => other.id !== p.id && !window.passedPadavIds.has(other.id) && (!p.sub_route || !other.sub_route || other.sub_route === p.sub_route))
                .map(other => ({
                    id: other.id,
                    name: other.name,
                    path: (Array.isArray(other.path_types) && other.path_types[0]) ? other.path_types[0] : 'मुख्य मार्ग',
                    km: quickCalcKm(p.lat, p.lng, other.lat, other.lng)
                }))
                .sort((a, b) => a.km - b.km)
                .slice(0, 2);
        }

        let nextOptionsHtml = '';
        if (finalNextList.length > 0) {
            const boxTitle = isAutoSuggested
                ? '➡️ नज़दीकी अगले पड़ाव (सुझाव):'
                : (finalNextList.length > 1 ? `➡️ आगे जाने के ${finalNextList.length} रास्ते:` : '➡️ आगे जाने का रास्ता:');

            nextOptionsHtml = `
                <div style="background:#f1f8e9; padding:7px; border-radius:6px; margin:7px 0; border-left:3px solid #2e7d32;">
                    <b style="font-size:11px; color:#2e7d32;">${boxTitle}</b>` +
                    finalNextList.map((np, idx) => {
                        const targetP = window.activeYatraPadavs.find(item => item.id === np.id);
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

                        const routeTag = finalNextList.length > 1 ? `<span style="font-size:10px; background:#e8f5e9; color:#1b5e20; padding:1px 4px; border-radius:3px; margin-right:3px;">मार्ग ${idx + 1}</span>` : '• ';

                        return `
                            <div style="font-size:12px; margin-top:5px; padding-top:4px; border-top:1px dashed #c5e1a5;">
                                ${routeTag}<span onclick="focusOnPadav('${np.id}')" style="color:#d84315; text-decoration:underline; cursor:pointer; font-weight:bold;">
                                    ${np.name}
                                </span> 
                                <span style="color:#1b5e20; font-weight:bold;">(${np.path || ''} • ${np.km} km)</span>
                                ${targetFacilities}
                            </div>
                        `;
                    }).join('') + 
                `</div>`;
        }

        // REGISTERED USER EDIT BUTTON + ADMIN EDIT/DELETE BUTTONS
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

        const popupHtml = `
            <div style="min-width:225px; max-width:265px; font-family:sans-serif;">
                ${startTag}
                <span style="font-size:11px; background:#fff3e0; color:#e65100; padding:2px 6px; border-radius:4px; font-weight:bold;">${p.sub_route || window.activeYatra.name}</span>
                <h4 style="margin:6px 0 4px 0; color:#222; font-size:15px;">${p.name}</h4>
                ${descriptionPreviewHtml}
                ${pathsHtml}
                ${facilitySectionHtml}
                ${p.contact_no ? `<p style="margin:4px 0; font-size:12px;"><b>📞 संपर्क:</b> ${p.contact_person || ''} (<a href="tel:${p.contact_no}">${p.contact_no}</a>)</p>` : ''}
                ${nextOptionsHtml}
                <a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}" target="_blank" style="display:block; text-align:center; background:#1976d2; color:white; padding:6px; border-radius:5px; text-decoration:none; font-size:12px; font-weight:bold; margin-top:8px;">🧭 Google Maps से दिशा देखें</a>
                ${actionBtnsHtml}
            </div>
        `;

        const marker = L.marker([p.lat, p.lng], { icon }).bindPopup(popupHtml).addTo(window.padavLayer);
        window.padavMarkersMap[p.id] = marker;

        if (isStart) marker.openPopup();
    });
}

function focusOnPadav(padavId) {
    const targetPadav = window.activeYatraPadavs.find(p => p.id === padavId);
    const targetMarker = window.padavMarkersMap[padavId];
    if (targetPadav && window.map) {
        window.map.flyTo([targetPadav.lat, targetPadav.lng], 13);
        if (targetMarker) targetMarker.openPopup();
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

    document.getElementById('manualDrawToolbar').style.display = 'block';
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
    // Auto OSRM road line hata kar sirf custom line dikhane ke liye map refresh karein
    applyMapFilters();
    alert("✅ आपका कस्टम मार्ग सेव हो गया है!");
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

    document.getElementById('gpsFollowToolbar').style.display = 'block';
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
    // Auto OSRM road line hata kar sirf custom GPS line dikhane ke liye map refresh karein
    applyMapFilters();
    alert("✅ GPS द्वारा रिकॉर्ड किया गया मार्ग सेव हो गया है!");
}