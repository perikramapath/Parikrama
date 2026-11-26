// =========================================================
// PARIKRAMAPATH - ADMIN, YATRA CRUD, FORMATTER, AARTI, PADAV, DONATION & DIARY APPROVAL
// =========================================================

window.tempNextPadavs = [];
window.donationSettingsCache = {
    upi_id: 'parikramapath@upi',
    payee_name: 'Parikramapath Seva',
    bank_name: '',
    account_holder: '',
    account_number: '',
    ifsc_code: ''
};
window.appImgbbApiKeyCache = localStorage.getItem('pp_imgbb_api_key') || '';
let donorPhotoBase64 = null;

function getCleanUserRole() {
    if (!window.currentProfile || !window.currentProfile.role) return '';
    return window.currentProfile.role.toLowerCase().trim().replace(/\s+/g, '_');
}

function isAdminUser() {
    const r = getCleanUserRole();
    return (r === 'super_admin' || r === 'admin' || r === 'moderator');
}

function isSuperAdminUser() {
    const r = getCleanUserRole();
    return (r === 'super_admin' || r === 'admin');
}

function setupPadavModalDropdowns(excludePadavId = null) {
    document.getElementById('addPadavYatraName').innerText = window.activeYatra.name;

    const subSel = document.getElementById('newPadavSubRoute');
    subSel.innerHTML = (window.activeYatra.sub_routes || []).map(sr => `<option value="${sr}">${sr}</option>`).join('');

    const nextSel = document.getElementById('nextPadavPicker');
    if (nextSel) {
        nextSel.innerHTML = '<option value="">-- अगला पड़ाव चुनें --</option>';
        const seenIds = new Set();

        (window.activeYatraPadavs || []).forEach(p => {
            if (p.id === excludePadavId || seenIds.has(p.id)) return;
            seenIds.add(p.id);

            const opt = document.createElement('option');
            opt.value = p.id;
            opt.dataset.name = p.name;
            opt.dataset.lat = p.lat;
            opt.dataset.lng = p.lng;
            opt.innerText = `📍 ${p.name} (${p.sub_route || ''})`;
            nextSel.appendChild(opt);
        });
    }
}

function syncPadavInMemory(padavObj) {
    if (!padavObj) return;

    const idx = window.activeYatraPadavs.findIndex(item => item.id === padavObj.id);
    if (idx !== -1) {
        window.activeYatraPadavs[idx] = padavObj;
    } else {
        window.activeYatraPadavs.push(padavObj);
    }

    if (window.yatraPadavsForSelection && window.yatraPadavsForSelection !== window.activeYatraPadavs) {
        const sIdx = window.yatraPadavsForSelection.findIndex(item => item.id === padavObj.id);
        if (sIdx !== -1) {
            window.yatraPadavsForSelection[sIdx] = padavObj;
        } else {
            window.yatraPadavsForSelection.push(padavObj);
        }
    }
}

async function fetchActualRoadKm(lat1, lng1, lat2, lng2) {
    if (isNaN(lat1) || isNaN(lng1) || isNaN(lat2) || isNaN(lng2)) return 0;

    if (typeof getCustomRouteKmBetween === 'function') {
        const customKm = getCustomRouteKmBetween(lat1, lng1, lat2, lng2);
        if (customKm !== null && customKm > 0) {
            return customKm;
        }
    }

    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            return parseFloat((data.routes[0].distance / 1000).toFixed(1));
        }
    } catch (e) {
        console.warn("OSRM fallback triggered:", e);
    }
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.25).toFixed(1));
}

// =========================================================
// 1. PADAV ADD / EDIT / DELETE (WITH REGISTERED USER APPROVAL)
// =========================================================
function openAddPadavModal() {
    if (!window.activeYatra) return;

    if (!window.currentUser) {
        alert("🔑 नया पड़ाव जोड़ने के लिए कृपया पहले Login या Register करें।");
        openAuthModal();
        return;
    }

    const isAdmin = isAdminUser();
    const noticeEl = document.getElementById('padavApprovalNotice');
    if (noticeEl) noticeEl.style.display = isAdmin ? 'none' : 'block';

    document.getElementById('editPadavId').value = '';
    const heading = document.getElementById('padavModalHeading');
    if (heading) heading.innerText = '➕ नया पड़ाव / आश्रम जोड़ें';

    document.getElementById('newPadavName').value = '';
    const descEl = document.getElementById('newPadavDescription');
    if (descEl) descEl.value = '';
    document.getElementById('newPadavContactName').value = '';
    document.getElementById('newPadavContactNo').value = '';
    document.getElementById('newPadavLat').value = '';
    document.getElementById('newPadavLng').value = '';
    document.getElementById('chkWater').checked = true;
    document.getElementById('chkToilet').checked = true;
    document.getElementById('chkMedical').checked = false;
    document.querySelectorAll('.pathTypeChk').forEach(chk => chk.checked = false);

    window.tempNextPadavs = [];
    renderTempNextPadavsList();
    setupPadavModalDropdowns();
    showModal('addPadavModal');
}

function onPadavCategoryChange() {
    const cat = document.getElementById('newPadavCat').value;
    if (cat === 'Point') {
        document.getElementById('newPadavBhojan').value = 'Not Available';
        document.getElementById('newPadavNiwas').value = 'No Stay';
        document.getElementById('chkWater').checked = false;
        document.getElementById('chkToilet').checked = false;
        document.getElementById('chkMedical').checked = false;
    } else {
        if (document.getElementById('newPadavBhojan').value === 'Not Available') {
            document.getElementById('newPadavBhojan').value = 'Free / Sadavrat';
        }
        if (document.getElementById('newPadavNiwas').value === 'No Stay') {
            document.getElementById('newPadavNiwas').value = 'Ashram / Dharamshala';
        }
        document.getElementById('chkWater').checked = true;
        document.getElementById('chkToilet').checked = true;
    }
}

function openAddPadavAtCoords(lat, lng) {
    if (window.map) window.map.closePopup();
    openAddPadavModal();
    document.getElementById('newPadavLat').value = lat;
    document.getElementById('newPadavLng').value = lng;
}

function openEditPadavModal(padavId) {
    if (!window.currentUser) {
        alert("🔑 पड़ाव संपादित (Edit) करने के लिए कृपया पहले Login करें।");
        openAuthModal();
        return;
    }

    const p = window.activeYatraPadavs.find(item => item.id === padavId);
    if (!p) return;

    const isAdmin = isAdminUser();
    const noticeEl = document.getElementById('padavApprovalNotice');
    if (noticeEl) noticeEl.style.display = isAdmin ? 'none' : 'block';

    document.getElementById('editPadavId').value = p.id;
    const heading = document.getElementById('padavModalHeading');
    if (heading) heading.innerText = '✏️ पड़ाव संपादित करें (Edit Padav)';

    setupPadavModalDropdowns(p.id);

    document.getElementById('newPadavName').value = p.name || '';
    document.getElementById('newPadavSubRoute').value = p.sub_route || '';
    document.getElementById('newPadavCat').value = p.category || 'Ashram';
    const descEl = document.getElementById('newPadavDescription');
    if (descEl) descEl.value = p.description || '';
    document.getElementById('newPadavBhojan').value = p.bhojan_type || 'Free / Sadavrat';
    document.getElementById('newPadavNiwas').value = p.niwas_type || 'Ashram / Dharamshala';
    document.getElementById('chkWater').checked = !!p.has_water;
    document.getElementById('chkToilet').checked = !!p.has_toilet;
    document.getElementById('chkMedical').checked = !!p.has_medical;
    document.getElementById('newPadavContactName').value = p.contact_person || '';
    document.getElementById('newPadavContactNo').value = p.contact_no || '';
    document.getElementById('newPadavLat').value = p.lat;
    document.getElementById('newPadavLng').value = p.lng;

    let savedPaths = p.path_types;
    if (typeof savedPaths === 'string') {
        try { savedPaths = JSON.parse(savedPaths); } catch (e) { savedPaths = []; }
    }
    savedPaths = Array.isArray(savedPaths) ? savedPaths : [];
    document.querySelectorAll('.pathTypeChk').forEach(chk => {
        chk.checked = savedPaths.includes(chk.value);
    });

    let savedNext = p.next_padavs;
    if (typeof savedNext === 'string') {
        try { savedNext = JSON.parse(savedNext); } catch (e) { savedNext = []; }
    }
    window.tempNextPadavs = (Array.isArray(savedNext) ? savedNext : []).map(np => {
        const target = window.activeYatraPadavs.find(x => x.id === np.id);
        return {
            id: np.id,
            name: np.name,
            lat: target ? target.lat : p.lat,
            lng: target ? target.lng : p.lng,
            path: np.path || '',
            km: np.km || 0
        };
    });
    renderTempNextPadavsList();
    showModal('addPadavModal');
}

async function deletePadav(padavId) {
    const p = window.activeYatraPadavs.find(item => item.id === padavId);
    const label = p ? p.name : 'इस पड़ाव';
    if (!confirm(`⚠️ क्या आप वाकई "${label}" को हमेशा के लिए हटाना चाहते हैं?`)) return;

    const { error } = await supabaseClient.from('padavs').delete().eq('id', padavId);
    if (error) return alert("Delete Error: " + error.message);

    window.activeYatraPadavs = window.activeYatraPadavs.filter(item => item.id !== padavId);
    if (window.yatraPadavsForSelection) {
        window.yatraPadavsForSelection = window.yatraPadavsForSelection.filter(item => item.id !== padavId);
    }
    renderIsolatedPadavs(window.activeYatraPadavs);
    alert("🗑️ पड़ाव हटा दिया गया है।");
}

function fillCurrentGPS() {
    if (!navigator.geolocation) return alert("GPS उपलब्ध नहीं है।");
    navigator.geolocation.getCurrentPosition(pos => {
        document.getElementById('newPadavLat').value = pos.coords.latitude.toFixed(6);
        document.getElementById('newPadavLng').value = pos.coords.longitude.toFixed(6);
        recalculateAllAddedNextPadavs();
    }, () => alert("GPS लोकेशन नहीं मिल सकी।"));
}

async function addNextPadavToList(silent = false) {
    const lat1 = parseFloat(document.getElementById('newPadavLat').value);
    const lng1 = parseFloat(document.getElementById('newPadavLng').value);
    if (isNaN(lat1) || isNaN(lng1)) {
        if (!silent) alert("पहले इस पड़ाव की GPS लोकेशन भरें ताकि सड़क से दूरी कैलकुलेट हो सके।");
        return false;
    }

    const picker = document.getElementById('nextPadavPicker');
    const opt = picker.options[picker.selectedIndex];
    if (!opt || !opt.value) {
        if (!silent) alert("कृपया सूची से अगला पड़ाव चुनें।");
        return false;
    }

    const box = document.getElementById('selectedNextPadavsList');
    if (box) box.innerHTML = '<small style="color:#0288d1;">⏳ मार्ग से वास्तविक दूरी कैलकुलेट हो रही है...</small>';

    const pathStyle = document.getElementById('nextPadavPathSelect').value;
    const roadKm = await fetchActualRoadKm(lat1, lng1, parseFloat(opt.dataset.lat), parseFloat(opt.dataset.lng));

    window.tempNextPadavs = window.tempNextPadavs.filter(x => x.id !== opt.value);
    window.tempNextPadavs.push({
        id: opt.value,
        name: opt.dataset.name,
        lat: parseFloat(opt.dataset.lat),
        lng: parseFloat(opt.dataset.lng),
        path: pathStyle,
        km: roadKm
    });

    picker.selectedIndex = 0;
    renderTempNextPadavsList();
    return true;
}

function removeTempNextPadav(index) {
    window.tempNextPadavs.splice(index, 1);
    renderTempNextPadavsList();
}

async function recalculateAllAddedNextPadavs() {
    const lat1 = parseFloat(document.getElementById('newPadavLat').value);
    const lng1 = parseFloat(document.getElementById('newPadavLng').value);
    if (isNaN(lat1) || isNaN(lng1) || window.tempNextPadavs.length === 0) return;

    for (let item of window.tempNextPadavs) {
        item.km = await fetchActualRoadKm(lat1, lng1, item.lat, item.lng);
    }
    renderTempNextPadavsList();
}

function renderTempNextPadavsList() {
    const box = document.getElementById('selectedNextPadavsList');
    if (!box) return;
    if (window.tempNextPadavs.length === 0) {
        box.innerHTML = '<small style="color:#666;">अभी कोई अगला पड़ाव नहीं जोड़ा गया है।</small>';
        return;
    }
    box.innerHTML = window.tempNextPadavs.map((item, idx) => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:white; padding:5px 8px; border-radius:4px; margin-top:4px; border:1px solid #ddd;">
            <span><b>${item.name}</b> (${item.path} • <b>${item.km} km</b>)</span>
            <button type="button" onclick="removeTempNextPadav(${idx})" style="background:#dc3545; color:white; border:none; border-radius:3px; padding:2px 6px; cursor:pointer;">✖</button>
        </div>
    `).join('');
}

async function submitNewPadav() {
    if (!window.currentUser) {
        alert("🔑 कृपया पहले Login या Register करें।");
        openAuthModal();
        return;
    }

    const editId = document.getElementById('editPadavId').value.trim();
    const isAdmin = isAdminUser();

    const picker = document.getElementById('nextPadavPicker');
    if (picker && picker.value) {
        await addNextPadavToList(true);
    }

    const selectedPaths = Array.from(document.querySelectorAll('.pathTypeChk:checked')).map(cb => cb.value);
    const cleanNextList = window.tempNextPadavs.map(({ id, name, path, km }) => ({ id, name, path, km }));
    const descEl = document.getElementById('newPadavDescription');

    const obj = {
        yatra_id: window.activeYatra.id,
        name: document.getElementById('newPadavName').value.trim(),
        sub_route: document.getElementById('newPadavSubRoute').value,
        category: document.getElementById('newPadavCat').value,
        description: descEl ? descEl.value.trim() : '',
        path_types: selectedPaths,
        bhojan_type: document.getElementById('newPadavBhojan').value,
        niwas_type: document.getElementById('newPadavNiwas').value,
        has_water: document.getElementById('chkWater').checked,
        has_toilet: document.getElementById('chkToilet').checked,
        has_medical: document.getElementById('chkMedical').checked,
        next_padavs: cleanNextList,
        next_padav_km: cleanNextList.length > 0 ? cleanNextList[0].km : 0,
        contact_person: document.getElementById('newPadavContactName').value.trim(),
        contact_no: document.getElementById('newPadavContactNo').value.trim(),
        lat: parseFloat(document.getElementById('newPadavLat').value),
        lng: parseFloat(document.getElementById('newPadavLng').value),
        status: isAdmin ? 'approved' : 'pending'
    };

    if (!obj.name || isNaN(obj.lat) || isNaN(obj.lng)) {
        return alert("पड़ाव का नाम और GPS लोकेशन आवश्यक है।");
    }

    if (editId) {
        const { data, error } = await supabaseClient.from('padavs').update(obj).eq('id', editId).select().single();
        if (error) return alert("Update Error: " + error.message);

        if (isAdmin && data) {
            syncPadavInMemory(data);
            renderIsolatedPadavs(window.activeYatraPadavs);
            closeAllModals();
            alert("✅ पड़ाव की जानकारी अपडेट हो गई है!");
        } else {
            window.activeYatraPadavs = window.activeYatraPadavs.filter(item => item.id !== editId);
            renderIsolatedPadavs(window.activeYatraPadavs);
            closeAllModals();
            alert("✅ आपके बदलाव सुरक्षित कर लिए गए हैं। एडमिन की स्वीकृति (Approval) के बाद यह मैप पर दिखाई देगा।");
        }
    } else {
        obj.created_by = window.currentUser.id;
        const { data, error } = await supabaseClient.from('padavs').insert([obj]).select().single();
        if (error) return alert("Insert Error: " + error.message);

        if (isAdmin && data) {
            syncPadavInMemory(data);
            renderIsolatedPadavs(window.activeYatraPadavs);
        }
        closeAllModals();
        alert(isAdmin
            ? "✅ नया पड़ाव मैप पर लाइव हो गया है!"
            : "✅ आपका पड़ाव भेज दिया गया है। एडमिन के अप्रूवल के बाद यह मैप पर दिखाई देगा।");
    }
}

// =========================================================
// 2. ADMIN MODAL: PENDING PADAVS + YATRA CRUD + AARTI + DONATION + DIARIES
// =========================================================
async function openAdminModal() {
    showModal('adminModal');
    const isSuperAdmin = isSuperAdminUser();
    const creatorBox = document.getElementById('superAdminYatraCreator');
    if (creatorBox) {
        creatorBox.style.display = isSuperAdmin ? 'block' : 'none';
    }
    const donationAdminBox = document.getElementById('superAdminDonationManager');
    if (donationAdminBox) {
        donationAdminBox.style.display = isSuperAdmin ? 'block' : 'none';
    }
    document.getElementById('modYatraLabel').innerText = window.activeYatra ? window.activeYatra.name : 'सभी यात्राएं';

    if (isSuperAdmin) {
        resetYatraCreatorForm();
        await loadAdminYatrasList();
        await loadAdminDonationManager();
    }

    if (isAdminUser() && window.activeYatra && typeof loadAdminAartis === 'function') {
        await loadAdminAartis();
    }

    if (isAdminUser()) {
        await renderAdminDiaryApprovalSection();
    }

    const box = document.getElementById('pendingPadavsList');
    if (!window.activeYatra) {
        box.innerHTML = '<p style="color:#777; font-size:12px;">किसी यात्रा के मैप पर जाकर पेंडिंग पड़ाव देखें।</p>';
        return;
    }

    const { data: pending } = await supabaseClient
        .from('padavs')
        .select('*')
        .eq('yatra_id', window.activeYatra.id)
        .eq('status', 'pending');

    if (!pending || pending.length === 0) {
        box.innerHTML = '<p style="color:#777; font-size:13px;">कोई पेंडिंग पड़ाव नहीं है।</p>';
        return;
    }

    box.innerHTML = pending.map(p => `
        <div style="border:1px solid #ddd; padding:8px; border-radius:6px; margin-bottom:8px; font-size:13px;">
            <b>${p.name}</b> (${p.category})<br>
            <small>${p.bhojan_type} | ${p.niwas_type}</small>
            ${p.description ? `<p style="margin:4px 0; font-size:12px; color:#444; background:#f9f9f9; padding:4px; border-radius:4px;">📝 ${p.description}</p>` : ''}
            <div style="margin-top:5px;">
                <button onclick="approvePadav('${p.id}')" style="background:#2e7d32; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">✔ Approve</button>
                <button onclick="rejectPendingPadav('${p.id}')" style="background:#dc3545; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">✖ Reject</button>
            </div>
        </div>
    `).join('');
}

async function approvePadav(id) {
    const { data } = await supabaseClient.from('padavs').update({ status: 'approved' }).eq('id', id).select().single();
    if (data) {
        syncPadavInMemory(data);
        renderIsolatedPadavs(window.activeYatraPadavs);
    }
    openAdminModal();
}

async function rejectPendingPadav(id) {
    if (!confirm("क्या आप इस पेंडिंग पड़ाव को रिजेक्ट/डिलीट करना चाहते हैं?")) return;
    await supabaseClient.from('padavs').delete().eq('id', id);
    openAdminModal();
}

// =========================================================
// 3. YATRA SMART TEXT FORMATTER & CRUD (EDIT / DELETE)
// =========================================================
function formatTextToCleanHtml(rawText) {
    const text = (rawText || '').trim();
    if (!text) return '';

    if (/<(p|ul|ol|li|h[1-6]|br|div)\b[^>]*>/i.test(text)) {
        return text;
    }

    const lines = text.split(/\r?\n/);
    let htmlOutput = '';
    let inBulletList = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (!line) {
            if (inBulletList) {
                htmlOutput += '</ul>';
                inBulletList = false;
            }
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
            if (inBulletList) {
                htmlOutput += '</ul>';
                inBulletList = false;
            }
            if (line.endsWith(':') && line.length < 85) {
                htmlOutput += `<h4 style="margin:14px 0 6px 0; color:#d84315; font-size:15px;">${line}</h4>`;
            } else {
                htmlOutput += `<p style="margin:0 0 10px 0; line-height:1.7;">${line}</p>`;
            }
        }
    }

    if (inBulletList) {
        htmlOutput += '</ul>';
    }

    return htmlOutput;
}

function htmlToEditableText(htmlStr) {
    if (!htmlStr) return '';
    return htmlStr
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<\/li>/gi, '\n')
        .replace(/<\/(p|h[1-6]|div|ul|ol)>/gi, '\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function loadAdminYatrasList() {
    const listBox = document.getElementById('adminYatrasList');
    if (!listBox) return;
    listBox.innerHTML = '<small style="color:#555;">यात्राएं लोड हो रही हैं...</small>';

    const { data: yatras } = await supabaseClient.from('yatras').select('*').order('name');
    window.adminCachedYatras = yatras || [];

    if (window.adminCachedYatras.length === 0) {
        listBox.innerHTML = '<small style="color:#777;">कोई यात्रा नहीं मिली।</small>';
        return;
    }

    listBox.innerHTML = window.adminCachedYatras.map(y => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:white; padding:6px 8px; border-radius:5px; margin-bottom:5px; border:1px solid #bbdefb; font-size:12px;">
            <div>
                <b>${y.name_hi || y.name}</b><br>
                <small style="color:#666;">${y.state || ''} • ${y.total_distance_km || 0} km • ${y.slug}</small>
            </div>
            <div style="display:flex; gap:4px;">
                <button type="button" onclick="editYatraInAdmin('${y.id}')" style="background:#ffc107; color:#000; border:none; padding:4px 7px; border-radius:4px; font-weight:bold; cursor:pointer;">✏️ Edit</button>
                <button type="button" onclick="deleteYatraInAdmin('${y.id}')" style="background:#dc3545; color:#fff; border:none; padding:4px 7px; border-radius:4px; font-weight:bold; cursor:pointer;">🗑️ Delete</button>
            </div>
        </div>
    `).join('');
}

function editYatraInAdmin(yatraId) {
    const y = (window.adminCachedYatras || []).find(item => item.id === yatraId);
    if (!y) return;

    document.getElementById('editYatraId').value = y.id;
    document.getElementById('yatraFormHeading').innerText = `✏️ यात्रा संपादित करें: ${y.name_hi || y.name}`;
    document.getElementById('saveYatraBtn').innerText = '💾 यात्रा अपडेट करें';
    document.getElementById('cancelYatraEditBtn').style.display = 'inline-block';

    document.getElementById('newYatraSlug').value = y.slug || '';
    document.getElementById('newYatraName').value = y.name || '';
    document.getElementById('newYatraNameHi').value = y.name_hi || '';
    document.getElementById('newYatraState').value = y.state || '';
    const distEl = document.getElementById('newYatraDistance');
    if (distEl) distEl.value = y.total_distance_km || '';
    document.getElementById('newYatraType').value = y.yatra_type || 'circular';
    document.getElementById('newYatraEnd').value = y.default_end_point || '';
    document.getElementById('newYatraSubRoutes').value = Array.isArray(y.sub_routes) ? y.sub_routes.join(', ') : '';
    document.getElementById('newYatraLat').value = y.center_lat || '';
    document.getElementById('newYatraLng').value = y.center_lng || '';
    document.getElementById('newYatraAbout').value = htmlToEditableText(y.about_html);
    document.getElementById('newYatraInfo').value = htmlToEditableText(y.information_html);
    document.getElementById('newYatraNiyam').value = htmlToEditableText(y.niyam_html);
}

function resetYatraCreatorForm() {
    document.getElementById('editYatraId').value = '';
    document.getElementById('yatraFormHeading').innerText = '➕ नई यात्रा व SEO पेज जोड़ें (Super Admin)';
    document.getElementById('saveYatraBtn').innerText = 'Create Yatra & SEO Page';
    document.getElementById('cancelYatraEditBtn').style.display = 'none';

    ['newYatraSlug', 'newYatraName', 'newYatraNameHi', 'newYatraState', 'newYatraDistance', 'newYatraEnd',
     'newYatraSubRoutes', 'newYatraLat', 'newYatraLng', 'newYatraAbout', 'newYatraInfo', 'newYatraNiyam']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

async function saveYatraForm() {
    const editId = document.getElementById('editYatraId').value.trim();
    const subs = document.getElementById('newYatraSubRoutes').value.split(',').map(s => s.trim()).filter(Boolean);
    const distEl = document.getElementById('newYatraDistance');

    const payload = {
        slug: document.getElementById('newYatraSlug').value.trim().toLowerCase(),
        name: document.getElementById('newYatraName').value.trim(),
        name_hi: document.getElementById('newYatraNameHi').value.trim(),
        state: document.getElementById('newYatraState').value.trim(),
        total_distance_km: distEl ? (parseFloat(distEl.value) || 0) : 0,
        yatra_type: document.getElementById('newYatraType').value,
        default_end_point: document.getElementById('newYatraEnd').value.trim() || null,
        sub_routes: subs,
        center_lat: parseFloat(document.getElementById('newYatraLat').value),
        center_lng: parseFloat(document.getElementById('newYatraLng').value),
        about_html: formatTextToCleanHtml(document.getElementById('newYatraAbout').value),
        information_html: formatTextToCleanHtml(document.getElementById('newYatraInfo').value),
        niyam_html: formatTextToCleanHtml(document.getElementById('newYatraNiyam').value)
    };

    if (!payload.slug || !payload.name || isNaN(payload.center_lat) || isNaN(payload.center_lng)) {
        return alert("Slug, Yatra Name, Center Lat और Center Lng आवश्यक हैं।");
    }

    if (editId) {
        const { error } = await supabaseClient.from('yatras').update(payload).eq('id', editId);
        if (error) return alert("Update Error: " + error.message);
        alert("✅ यात्रा अपडेट हो गई है!");
        location.reload();
    } else {
        const { error } = await supabaseClient.from('yatras').insert([payload]);
        if (error) return alert("Error: " + error.message);
        alert("🎉 नई यात्रा और उसका SEO पेज तैयार हो गया है!");
        location.reload();
    }
}

async function deleteYatraInAdmin(yatraId) {
    const y = (window.adminCachedYatras || []).find(item => item.id === yatraId);
    if (!y) return;
    if (!confirm(`⚠️ चेतावनी: क्या आप वाकई "${y.name_hi || y.name}" यात्रा को डिलीट करना चाहते हैं? इसके सभी पड़ाव और मार्ग भी हट सकते हैं।`)) return;

    const { error } = await supabaseClient.from('yatras').delete().eq('id', yatraId);
    if (error) return alert("Delete Yatra Error: " + error.message);

    alert("🗑️ यात्रा डिलीट कर दी गई है।");
    location.reload();
}

// =========================================================
// 4. OFFLINE AARTI CACHE + ADMIN AARTI ADD / DELETE
// =========================================================
async function syncOfflineAartis() {
    try {
        const { data, error } = await supabaseClient
            .from('yatra_aartis')
            .select('*')
            .order('created_at', { ascending: true });
        if (data && !error) {
            localStorage.setItem('pp_offline_aartis', JSON.stringify(data));
        }
    } catch (e) {
        console.warn("Offline Aarti sync skipped:", e);
    }
}

async function openAartiModal() {
    if (!window.activeYatra) return;
    document.getElementById('aartiYatraTitle').innerText = window.activeYatra.name_hi || window.activeYatra.name;
    showModal('aartiModal');

    await syncOfflineAartis();
    renderYatraAartiList();
}

function renderYatraAartiList() {
    const container = document.getElementById('aartiContainer');
    const allCached = JSON.parse(localStorage.getItem('pp_offline_aartis') || '[]');
    const yatraAartis = allCached.filter(a => a.yatra_id === window.activeYatra.id);

    if (yatraAartis.length === 0) {
        container.innerHTML = '<p style="color:#777; text-align:center;">इस यात्रा की आरती जल्द जोड़ी जाएगी।</p>';
        return;
    }

    container.innerHTML = yatraAartis.map(a => `
        <button type="button" onclick="viewAartiLyrics('${a.id}')" style="width:100%; padding:11px; margin-bottom:8px; background:#fff8e1; border:2px solid #ff9800; border-radius:8px; font-size:15px; font-weight:bold; color:#d84315; cursor:pointer; text-align:left;">
            🪔 ${a.title}
        </button>
    `).join('');
}

function viewAartiLyrics(aartiId) {
    const container = document.getElementById('aartiContainer');
    const allCached = JSON.parse(localStorage.getItem('pp_offline_aartis') || '[]');
    const aarti = allCached.find(a => String(a.id) === String(aartiId));
    if (!aarti) return;

    const formattedLyrics = (aarti.content || '').replace(/\r?\n/g, '<br>');
    container.innerHTML = `
        <button type="button" onclick="renderYatraAartiList()" style="background:none; border:none; color:#0288d1; font-weight:bold; cursor:pointer; margin-bottom:10px; font-size:14px; padding:0;">⬅ सभी आरतियाँ (Back)</button>
        <h4 style="color:#e91e63; text-align:center; margin:0 0 10px 0; font-size:17px;">🪔 ${aarti.title}</h4>
        <div style="font-size:15px; line-height:1.8; color:#222; text-align:center; background:#fffdf7; padding:12px; border-radius:8px; border:1px solid #ffe082;">
            ${formattedLyrics}
        </div>
    `;
}

async function addYatraAarti() {
    if (!isAdminUser() || !window.activeYatra) return;
    const titleEl = document.getElementById('adminAartiTitle');
    const contentEl = document.getElementById('adminAartiContent');
    if (!titleEl || !contentEl) return;

    const title = titleEl.value.trim();
    const content = contentEl.value.trim();

    if (!title || !content) return alert("कृपया आरती का शीर्षक और बोल दोनों भरें।");

    const { error } = await supabaseClient.from('yatra_aartis').insert([{
        yatra_id: window.activeYatra.id,
        title: title,
        content: content
    }]);

    if (error) return alert("Aarti Save Error: " + error.message);

    alert("✅ आरती सुरक्षित हो गई है!");
    titleEl.value = '';
    contentEl.value = '';
    await syncOfflineAartis();
    await loadAdminAartis();
}

async function loadAdminAartis() {
    const label = document.getElementById('adminAartiYatraLabel');
    if (label && window.activeYatra) label.innerText = window.activeYatra.name_hi || window.activeYatra.name;

    const box = document.getElementById('adminAartiList');
    if (!box || !window.activeYatra) return;

    const { data } = await supabaseClient
        .from('yatra_aartis')
        .select('*')
        .eq('yatra_id', window.activeYatra.id)
        .order('created_at');

    if (!data || data.length === 0) {
        box.innerHTML = '<small style="color:#777;">इस यात्रा में अभी कोई आरती नहीं जुड़ी है।</small>';
        return;
    }

    box.innerHTML = data.map(a => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:white; padding:6px 8px; border-radius:5px; margin-bottom:4px; border:1px solid #f48fb1; font-size:12px;">
            <b>🪔 ${a.title}</b>
            <button type="button" onclick="deleteYatraAarti('${a.id}')" style="background:#dc3545; color:white; border:none; padding:3px 7px; border-radius:4px; cursor:pointer;">🗑️ Delete</button>
        </div>
    `).join('');
}

async function deleteYatraAarti(aartiId) {
    if (!confirm("क्या आप इस आरती को डिलीट करना चाहते हैं?")) return;
    const { error } = await supabaseClient.from('yatra_aartis').delete().eq('id', aartiId);
    if (error) return alert("Delete Error: " + error.message);
    await syncOfflineAartis();
    await loadAdminAartis();
}

// =========================================================
// 5. DYNAMIC UPI QR DONATION, NEFT COPY & ADMIN DONOR WALL
// =========================================================
async function initDonationAndDonorWall() {
    try {
        const { data: settings } = await supabaseClient
            .from('donation_settings')
            .select('*')
            .eq('id', 1)
            .single();

        if (settings) {
            window.donationSettingsCache = settings;
        }
    } catch (e) {
        console.warn("Donation settings fallback:", e);
    }

    renderDonationDetailsOnHome();
    generateDynamicUpiQr(51);
    await loadPublicDonorWall();
}

function renderDonationDetailsOnHome() {
    const s = window.donationSettingsCache;
    const upiDisp = document.getElementById('displayUpiIdText');
    if (upiDisp) upiDisp.innerText = s.upi_id || 'parikramapath@upi';

    const neftBox = document.getElementById('neftDetailsBox');
    if (neftBox) {
        if (s.account_number && s.ifsc_code) {
            neftBox.style.display = 'block';
            document.getElementById('dispBankName').innerText = s.bank_name || '-';
            document.getElementById('dispAccHolder').innerText = s.account_holder || s.payee_name || '-';
            document.getElementById('dispAccNo').innerText = s.account_number;
            document.getElementById('dispIfsc').innerText = s.ifsc_code;
        } else {
            neftBox.style.display = 'none';
        }
    }
}

function setDonationAmount(amt) {
    const input = document.getElementById('donationAmountInput');
    if (input) input.value = amt;
    generateDynamicUpiQr(amt);
}

function generateDynamicUpiQr(customAmt = null) {
    const s = window.donationSettingsCache;
    const input = document.getElementById('donationAmountInput');
    const amount = customAmt !== null ? parseFloat(customAmt) : (input ? parseFloat(input.value) : 0);

    const upiId = encodeURIComponent((s.upi_id || 'parikramapath@upi').trim());
    const payee = encodeURIComponent((s.payee_name || 'Parikramapath Seva').trim());
    const note = encodeURIComponent('Parikramapath Seva Sahyog');

    let upiUri = `upi://pay?pa=${upiId}&pn=${payee}&tn=${note}&cu=INR`;
    if (!isNaN(amount) && amount > 0) {
        upiUri += `&am=${amount.toFixed(2)}`;
    }

    const qrContainer = document.getElementById('donationUpiQrBox');
    if (qrContainer && typeof QRCode !== 'undefined') {
        qrContainer.innerHTML = '';
        new QRCode(qrContainer, {
            text: upiUri,
            width: 145,
            height: 145,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
        });
    }

    const payBtn = document.getElementById('directUpiPayLink');
    if (payBtn) {
        payBtn.href = upiUri;
    }
}

function copyDonationField(type) {
    const s = window.donationSettingsCache;
    let textToCopy = '';
    if (type === 'upi') textToCopy = s.upi_id;
    if (type === 'acc') textToCopy = s.account_number;
    if (type === 'ifsc') textToCopy = s.ifsc_code;
    if (!textToCopy) return;

    navigator.clipboard.writeText(textToCopy).then(() => {
        alert(`📋 कॉपी हो गया: ${textToCopy}`);
    }).catch(() => {
        prompt("कृपया यहाँ से कॉपी करें:", textToCopy);
    });
}

function handleDonorPhotoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const size = 140;
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const minSide = Math.min(img.width, img.height);
            const sx = (img.width - minSide) / 2;
            const sy = (img.height - minSide) / 2;
            ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
            donorPhotoBase64 = canvas.toDataURL('image/jpeg', 0.75);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function submitDonorWallEntry() {
    const fullName = document.getElementById('donorNameInput').value.trim();
    const city = document.getElementById('donorCityInput').value.trim();
    const utrNo = document.getElementById('donorUtrInput').value.trim();
    const amt = parseFloat(document.getElementById('donationAmountInput').value) || 0;

    if (!fullName || !city || !utrNo) {
        return alert("⚠️ कृपया अपना नाम, शहर और UPI/NEFT Transaction ID (UTR) अवश्य भरें।");
    }

    const { error } = await supabaseClient.from('donors').insert([{
        full_name: fullName,
        city: city,
        amount: amt,
        utr_no: utrNo,
        photo_base64: donorPhotoBase64,
        status: 'pending'
    }]);

    if (error) return alert("Error: " + error.message);

    document.getElementById('donorNameInput').value = '';
    document.getElementById('donorCityInput').value = '';
    document.getElementById('donorUtrInput').value = '';
    const fileInput = document.getElementById('donorPhotoInput');
    if (fileInput) fileInput.value = '';
    donorPhotoBase64 = null;

    alert("🙏 धन्यवाद! आपका विवरण प्राप्त हो गया है। एडमिन सत्यापन के बाद आपका नाम व फोटो 'हमारे सहयोगी' सूची में जुड़ जाएगा।");
}

async function loadPublicDonorWall() {
    const wallBox = document.getElementById('publicDonorWallGrid');
    if (!wallBox) return;

    const { data: donors } = await supabaseClient
        .from('donors')
        .select('id, full_name, city, photo_base64, created_at')
        .eq('status', 'approved')
        .order('created_at', { ascending: false });

    if (!donors || donors.length === 0) {
        wallBox.innerHTML = '<small style="color:#777;">प्रथम सहयोगी बनकर परिक्रमापथ सेवा में सहभागी बनें।</small>';
        return;
    }

    wallBox.innerHTML = donors.map(d => {
        const avatar = d.photo_base64 || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
        return `
            <div style="background:white; border:1px solid #ffe082; border-radius:10px; padding:8px 10px; display:flex; align-items:center; gap:8px; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                <img src="${avatar}" alt="${d.full_name}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; border:2px solid #ff9800;">
                <div style="text-align:left; line-height:1.3;">
                    <div style="font-weight:bold; font-size:12.5px; color:#222;">${d.full_name}</div>
                    <div style="font-size:11px; color:#666;">📍 ${d.city}</div>
                </div>
            </div>
        `;
    }).join('');
}

// ADMIN DONATION SETTINGS & DONOR APPROVALS
async function loadAdminDonationManager() {
    const s = window.donationSettingsCache;
    if (document.getElementById('adminUpiIdInput')) {
        document.getElementById('adminUpiIdInput').value = s.upi_id || '';
        document.getElementById('adminPayeeNameInput').value = s.payee_name || '';
        document.getElementById('adminBankNameInput').value = s.bank_name || '';
        document.getElementById('adminAccHolderInput').value = s.account_holder || '';
        document.getElementById('adminAccNoInput').value = s.account_number || '';
        document.getElementById('adminIfscInput').value = s.ifsc_code || '';
    }

    const listBox = document.getElementById('adminDonorsApprovalList');
    if (!listBox) return;

    const { data: allDonors } = await supabaseClient
        .from('donors')
        .select('*')
        .order('created_at', { ascending: false });

    if (!allDonors || allDonors.length === 0) {
        listBox.innerHTML = '<small style="color:#777;">अभी कोई दानदाता प्रविष्टि नहीं है।</small>';
        return;
    }

    listBox.innerHTML = allDonors.map(d => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:white; padding:6px 8px; border-radius:5px; margin-bottom:5px; border:1px solid ${d.status === 'approved' ? '#c8e6c9' : '#ffe082'}; font-size:12px;">
            <div>
                <b>${d.full_name}</b> (${d.city}) — <span style="color:#2e7d32; font-weight:bold;">₹${d.amount || 0}</span><br>
                <small style="color:#555;">UTR: <b>${d.utr_no}</b> • Status: <b>${d.status.toUpperCase()}</b></small>
            </div>
            <div style="display:flex; gap:4px;">
                ${d.status !== 'approved' ? `<button type="button" onclick="approveDonorEntry('${d.id}')" style="background:#2e7d32; color:white; border:none; padding:4px 7px; border-radius:4px; cursor:pointer;">✔ Approve</button>` : ''}
                <button type="button" onclick="deleteDonorEntry('${d.id}')" style="background:#dc3545; color:white; border:none; padding:4px 7px; border-radius:4px; cursor:pointer;">🗑️ Delete</button>
            </div>
        </div>
    `).join('');
}

async function saveAdminDonationSettings() {
    if (!isSuperAdminUser()) return;

    const payload = {
        id: 1,
        upi_id: document.getElementById('adminUpiIdInput').value.trim(),
        payee_name: document.getElementById('adminPayeeNameInput').value.trim() || 'Parikramapath Seva',
        bank_name: document.getElementById('adminBankNameInput').value.trim(),
        account_holder: document.getElementById('adminAccHolderInput').value.trim(),
        account_number: document.getElementById('adminAccNoInput').value.trim(),
        ifsc_code: document.getElementById('adminIfscInput').value.trim().toUpperCase(),
        updated_at: new Date().toISOString()
    };

    if (!payload.upi_id) return alert("⚠️ कृपया UPI ID अवश्य डालें।");

    const { error } = await supabaseClient.from('donation_settings').upsert(payload);
    if (error) return alert("Save Error: " + error.message);

    window.donationSettingsCache = payload;
    renderDonationDetailsOnHome();
    generateDynamicUpiQr();
    alert("✅ UPI और बैंक विवरण सुरक्षित हो गए हैं!");
}

async function approveDonorEntry(donorId) {
    const { error } = await supabaseClient.from('donors').update({ status: 'approved' }).eq('id', donorId);
    if (error) return alert("Error: " + error.message);
    await loadAdminDonationManager();
    await loadPublicDonorWall();
}

async function deleteDonorEntry(donorId) {
    if (!confirm("क्या आप इस दानदाता प्रविष्टि को हटाना चाहते हैं?")) return;
    const { error } = await supabaseClient.from('donors').delete().eq('id', donorId);
    if (error) return alert("Error: " + error.message);
    await loadAdminDonationManager();
    await loadPublicDonorWall();
}

// =========================================================
// 6. IMGBB API KEY & PUBLIC YATRA DIARY APPROVAL SYSTEM
// =========================================================
function deduplicateDayDiaries(list) {
    const mapByKey = new Map();
    (list || []).forEach(item => {
        const k = `${String(item.yatra_id || '')}_${String(item.yatri_name || '').trim().toLowerCase()}_${parseInt(item.day_number, 10) || 1}`;
        const prev = mapByKey.get(k);
        if (!prev) {
            mapByKey.set(k, { ...item });
        } else {
            let pPhotos = prev.photo_urls;
            let cPhotos = item.photo_urls;
            if (typeof pPhotos === 'string') { try { pPhotos = JSON.parse(pPhotos); } catch (e) { pPhotos = []; } }
            if (typeof cPhotos === 'string') { try { cPhotos = JSON.parse(cPhotos); } catch (e) { cPhotos = []; } }
            const mergedPhotos = (Array.isArray(cPhotos) && cPhotos.length > 0)
                ? cPhotos
                : (Array.isArray(pPhotos) ? pPhotos : []);

            mapByKey.set(k, {
                ...prev,
                ...item,
                experience_text: item.experience_text || prev.experience_text || '',
                photo_urls: mergedPhotos
            });
        }
    });
    return Array.from(mapByKey.values());
}

async function loadAppImgbbSettings() {
    try {
        const { data } = await supabaseClient
            .from('app_settings')
            .select('imgbb_api_key')
            .eq('id', 1)
            .single();
        if (data && data.imgbb_api_key) {
            window.appImgbbApiKeyCache = data.imgbb_api_key;
            localStorage.setItem('pp_imgbb_api_key', data.imgbb_api_key);
        }
    } catch (e) {}
}

window.saveAdminImgbbApiKey = async function() {
    if (!isSuperAdminUser()) return;
    const input = document.getElementById('adminImgbbKeyInput');
    if (!input) return;

    const apiKey = input.value.trim();
    if (!apiKey) return alert("⚠️ कृपया ImgBB API Key डालें।");

    const { error } = await supabaseClient.from('app_settings').upsert({
        id: 1,
        imgbb_api_key: apiKey,
        updated_at: new Date().toISOString()
    });

    if (error) return alert("Save Error: " + error.message);

    window.appImgbbApiKeyCache = apiKey;
    localStorage.setItem('pp_imgbb_api_key', apiKey);
    alert("✅ ImgBB API Key सुरक्षित हो गई है! अब यात्री डायरी में 1-2 फोटो अपलोड कर सकेंगे।");
};

window.uploadImageToImgBB = async function(file) {
    if (!file) return null;
    if (!window.appImgbbApiKeyCache) {
        await loadAppImgbbSettings();
    }
    const apiKey = window.appImgbbApiKeyCache;
    if (!apiKey) {
        throw new Error("ImgBB API Key सेट नहीं है। कृपया Admin Panel में ImgBB API Key जोड़ें।");
    }

    const compressedBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const maxDim = 1024;
                let w = img.width;
                let h = img.height;
                if (w > maxDim || h > maxDim) {
                    if (w > h) {
                        h = Math.round((h * maxDim) / w);
                        w = maxDim;
                    } else {
                        w = Math.round((w * maxDim) / h);
                        h = maxDim;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
                resolve(dataUrl.split(',')[1]);
            };
            img.onerror = () => reject(new Error("Invalid image file"));
            img.src = ev.target.result;
        };
        reader.onerror = () => reject(new Error("File read failed"));
        reader.readAsDataURL(file);
    });

    const formData = new FormData();
    formData.append('key', apiKey);
    formData.append('image', compressedBase64);

    const resp = await fetch('https://api.imgbb.com/1/upload', {
        method: 'POST',
        body: formData
    });
    const json = await resp.json();
    if (json && json.success && json.data && json.data.url) {
        return json.data.url;
    }
    throw new Error(json?.error?.message || "ImgBB upload failed");
};

async function renderAdminDiaryApprovalSection() {
    const adminModal = document.getElementById('adminModal');
    if (!adminModal) return;

    await loadAppImgbbSettings();

    let diaryManagerBox = document.getElementById('adminYatraDiariesManager');
    if (!diaryManagerBox) {
        diaryManagerBox = document.createElement('div');
        diaryManagerBox.id = 'adminYatraDiariesManager';
        diaryManagerBox.style.cssText = 'background:#e8f5e9; padding:12px; border-radius:8px; border:1px solid #81c784; margin-top:15px;';
        adminModal.appendChild(diaryManagerBox);
    }

    const isSuper = isSuperAdminUser();
    const imgbbKeyHtml = isSuper ? `
        <div style="background:#ffffff; padding:8px; border-radius:6px; border:1px solid #c8e6c9; margin-bottom:10px;">
            <label style="font-size:11.5px; font-weight:bold; color:#1b5e20; display:block; margin-bottom:4px;">
                🖼️ ImgBB API Key (यात्री डायरी फोटो अपलोड हेतु):
            </label>
            <div style="display:flex; gap:5px;">
                <input type="text" id="adminImgbbKeyInput" value="${window.appImgbbApiKeyCache || ''}" placeholder="ImgBB API Key यहाँ पेस्ट करें..." class="form-input" style="margin:0; flex:1; font-size:12px;">
                <button type="button" onclick="saveAdminImgbbApiKey()" style="background:#2e7d32; color:#fff; border:none; padding:0 12px; border-radius:5px; font-weight:bold; font-size:12px; cursor:pointer;">Save</button>
            </div>
        </div>
    ` : '';

    diaryManagerBox.innerHTML = `
        <h4 style="margin:0 0 8px 0; color:#1b5e20;">📖 Pending Yatra Diaries (यात्री अनुभव अप्रूवल)</h4>
        ${imgbbKeyHtml}
        <div id="pendingYatraDiariesList" style="max-height:240px; overflow-y:auto;">
            <small style="color:#555;">यात्रा डायरियाँ लोड हो रही हैं...</small>
        </div>
    `;

    const listEl = document.getElementById('pendingYatraDiariesList');
    const { data: diaries, error } = await supabaseClient
        .from('yatra_diaries')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(40);

    const uniqueDiaries = deduplicateDayDiaries(diaries).slice(0, 30);

    if (error || !uniqueDiaries || uniqueDiaries.length === 0) {
        listEl.innerHTML = '<small style="color:#666;">अभी कोई यात्रा डायरी सबमिट नहीं हुई है।</small>';
        return;
    }

    listEl.innerHTML = uniqueDiaries.map(d => {
        let photos = d.photo_urls;
        if (typeof photos === 'string') {
            try { photos = JSON.parse(photos); } catch (e) { photos = []; }
        }
        photos = Array.isArray(photos) ? photos.slice(0, 2) : [];
        const imgsHtml = photos.length > 0
            ? `<div style="display:flex; gap:6px; margin:6px 0;">${photos.map(u => `<a href="${u}" target="_blank"><img src="${u}" style="width:62px; height:62px; object-fit:cover; border-radius:6px; border:1px solid #ccc;"></a>`).join('')}</div>`
            : '';

        const isApproved = (d.status === 'approved');
        return `
            <div style="background:#ffffff; padding:8px; border-radius:6px; margin-bottom:7px; border:1px solid ${isApproved ? '#a5d6a7' : '#ffcc80'}; font-size:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <b style="color:#d84315;">${d.yatri_name} — ${d.yatra_name} (Day ${d.day_number})</b>
                    <span style="font-size:10.5px; background:${isApproved ? '#e8f5e9' : '#fff3e0'}; color:${isApproved ? '#2e7d32' : '#e65100'}; padding:2px 6px; border-radius:4px; font-weight:bold;">
                        ${isApproved ? 'LIVE' : 'PENDING'}
                    </span>
                </div>
                <div style="color:#555; margin-top:2px;">
                    📅 ${d.diary_date || ''} ${d.diary_time || ''} • 🚩 ${d.start_place || '-'} ➔ 🛌 ${d.night_halt || '-'} (${d.distance_km || 0} km)
                </div>
                ${d.experience_text ? `<p style="margin:5px 0; color:#222; background:#f9fbe7; padding:5px; border-radius:4px;">"${d.experience_text}"</p>` : ''}
                ${imgsHtml}
                <div style="display:flex; gap:6px; margin-top:6px;">
                    ${!isApproved ? `<button type="button" onclick="approveYatraDiary('${d.id}')" style="background:#2e7d32; color:#fff; border:none; padding:4px 9px; border-radius:4px; font-weight:bold; cursor:pointer;">✔ Approve & Publish</button>` : ''}
                    <button type="button" onclick="deleteYatraDiary('${d.id}')" style="background:#dc3545; color:#fff; border:none; padding:4px 9px; border-radius:4px; font-weight:bold; cursor:pointer;">🗑️ Delete</button>
                </div>
            </div>
        `;
    }).join('');
}

window.approveYatraDiary = async function(diaryId) {
    const { error } = await supabaseClient
        .from('yatra_diaries')
        .update({ status: 'approved' })
        .eq('id', diaryId);
    if (error) return alert("Error: " + error.message);
    await renderAdminDiaryApprovalSection();
    await loadPublicYatraDiariesWall();
};

window.deleteYatraDiary = async function(diaryId) {
    if (!confirm("क्या आप इस यात्रा डायरी को हमेशा के लिए हटाना चाहते हैं?")) return;
    const { error } = await supabaseClient
        .from('yatra_diaries')
        .delete()
        .eq('id', diaryId);
    if (error) return alert("Error: " + error.message);
    await renderAdminDiaryApprovalSection();
    await loadPublicYatraDiariesWall();
};

// Public Approved Yatra Diaries Wall on Home Page
async function loadPublicYatraDiariesWall() {
    const donorWall = document.getElementById('publicDonorWallGrid');
    if (!donorWall) return;

    let diarySection = document.getElementById('publicYatraDiariesSection');
    if (!diarySection) {
        diarySection = document.createElement('section');
        diarySection.id = 'publicYatraDiariesSection';
        diarySection.setAttribute('aria-label', 'यात्रियों की परिक्रमा डायरी');
        diarySection.style.cssText = 'margin-top:22px; padding:14px; background:#f9fbe7; border:1.5px solid #c5e1a5; border-radius:14px; text-align:left;';
        const parentSec = donorWall.closest('section');
        if (parentSec && parentSec.parentNode) {
            parentSec.parentNode.insertBefore(diarySection, parentSec);
        }
    }

    const { data: approvedDiaries } = await supabaseClient
        .from('yatra_diaries')
        .select('*')
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(24);

    const uniqueDiaries = deduplicateDayDiaries(approvedDiaries).slice(0, 12);

    if (!uniqueDiaries || uniqueDiaries.length === 0) {
        diarySection.style.display = 'none';
        return;
    }

    diarySection.style.display = 'block';
    diarySection.innerHTML = `
        <h2 style="font-size:17px; color:#2e7d32; margin:0 0 10px 0;">📖 यात्रियों के लाइव अनुभव (Yatra Diaries)</h2>
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(250px, 1fr)); gap:10px;">
            ${uniqueDiaries.map(d => {
                let photos = d.photo_urls;
                if (typeof photos === 'string') {
                    try { photos = JSON.parse(photos); } catch (e) { photos = []; }
                }
                photos = Array.isArray(photos) ? photos.slice(0, 2) : [];
                const photoGrid = photos.length > 0
                    ? `<div style="display:flex; gap:6px; margin-top:7px;">${photos.map(u => `<a href="${u}" target="_blank" style="flex:1;"><img src="${u}" alt="${d.yatri_name}" style="width:100%; height:85px; object-fit:cover; border-radius:7px; border:1px solid #ddd;"></a>`).join('')}</div>`
                    : '';

                const expText = (d.experience_text || '').trim();
                const isLongText = expText.length > 130;
                const readMoreBtnHtml = (window.ParikramaDiaryBlog && (isLongText || photoGrid))
                    ? `<button type="button" onclick="ParikramaDiaryBlog.openDiaryById('${d.id}')" style="margin-top:7px; background:#fff3e0; color:#d84315; border:1px solid #ffb74d; padding:4px 10px; border-radius:6px; font-size:11.5px; font-weight:bold; cursor:pointer;">Read more ➔</button>`
                    : '';

                return `
                    <article style="background:#ffffff; border:1px solid #dcedc8; border-radius:10px; padding:10px; box-shadow:0 2px 6px rgba(0,0,0,0.05);">
                        <div style="font-weight:bold; font-size:13.5px; color:#d84315;">
                            🚩 ${d.yatri_name} — ${d.yatra_name} | Day ${d.day_number}
                        </div>
                        <div style="font-size:11px; color:#666; margin:3px 0 6px 0;">
                            📅 ${d.diary_date || ''} ${d.diary_time ? '• 🕒 ' + d.diary_time : ''}
                        </div>
                        <div style="font-size:12px; color:#1b5e20; background:#f1f8e9; padding:5px 7px; border-radius:6px; margin-bottom:6px;">
                            🚶 ${d.start_place || 'आरंभ'} ➔ 🛌 <b>${d.night_halt || 'विश्राम'}</b> (${d.distance_km || 0} km)
                        </div>
                        ${expText ? `<p style="margin:0; font-size:12.5px; color:#333; line-height:1.5; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">${expText}</p>` : ''}
                        ${photoGrid}
                        ${readMoreBtnHtml}
                    </article>
                `;
            }).join('')}
        </div>
    `;
}

window.addEventListener('DOMContentLoaded', () => {
    setTimeout(syncOfflineAartis, 2500);
    setTimeout(initDonationAndDonorWall, 600);
    setTimeout(loadAppImgbbSettings, 800);
    setTimeout(loadPublicYatraDiariesWall, 1000);
});

// =========================================================
// 7. MODAL & MENU HELPERS
// =========================================================
function showModal(id) {
    closeAllModals();
    document.getElementById('modalBackdrop').style.display = 'block';
    document.getElementById(id).style.display = 'block';
}
function closeAllModals() {
    document.getElementById('modalBackdrop').style.display = 'none';
    document.querySelectorAll('.center-modal').forEach(m => m.style.display = 'none');
}
function toggleMenu() {
    const m = document.getElementById('dropdownMenu');
    m.style.display = m.style.display === 'flex' ? 'none' : 'flex';
}
function openAuthModal() { showModal('authModal'); }
function toggleAuthForm(mode) {
    document.getElementById('loginSection').style.display = mode === 'login' ? 'block' : 'none';
    document.getElementById('signupSection').style.display = mode === 'signup' ? 'block' : 'none';
}
async function logoutUser() { await supabaseClient.auth.signOut(); location.reload(); }