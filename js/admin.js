// =========================================================
// PARIKRAMAPATH - ADMIN, OSRM ROAD DISTANCE & PADAV CRUD
// =========================================================

window.tempNextPadavs = [];

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

// 1A. MENU SE MODAL KHOLNA
function openAddPadavModal() {
    if (!window.activeYatra) return;
    document.getElementById('editPadavId').value = '';
    const heading = document.getElementById('padavModalHeading');
    if (heading) heading.innerText = '➕ नया पड़ाव / आश्रम जोड़ें';

    document.getElementById('newPadavName').value = '';
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

// Jab "Point" select ho to Bhojan/Niwas/Suvidhayein automatic "Not Available" ho jayein
function onPadavCategoryChange() {
    const cat = document.getElementById('newPadavCat').value;
    if (cat === 'Point') {
        document.getElementById('newPadavBhojan').value = 'Not Available';
        document.getElementById('newPadavNiwas').value = 'No Stay';
        document.getElementById('chkWater').checked = false;
        document.getElementById('chkToilet').checked = false;
        document.getElementById('chkMedical').checked = false;
    } else {
        // Agar wapas Ashram/Mandir chunein to default values restore karein
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

// 1B. DESKTOP/MOBILE MAP PAR CLICK KARKE EXACT LOCATION SE MODAL KHOLNA
function openAddPadavAtCoords(lat, lng) {
    if (window.map) window.map.closePopup();
    openAddPadavModal();
    document.getElementById('newPadavLat').value = lat;
    document.getElementById('newPadavLng').value = lng;
}

// 2. EXISTING PADAV EDIT KARNE KE LIYE MODAL KHOLNA
function openEditPadavModal(padavId) {
    const p = window.activeYatraPadavs.find(item => item.id === padavId);
    if (!p) return;

    document.getElementById('editPadavId').value = p.id;
    const heading = document.getElementById('padavModalHeading');
    if (heading) heading.innerText = '✏️ पड़ाव संपादित करें (Edit Padav)';

    setupPadavModalDropdowns(p.id);

    document.getElementById('newPadavName').value = p.name || '';
    document.getElementById('newPadavSubRoute').value = p.sub_route || '';
    document.getElementById('newPadavCat').value = p.category || 'Ashram';
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

// 3. PADAV DELETE KARNA
async function deletePadav(padavId) {
    const p = window.activeYatraPadavs.find(item => item.id === padavId);
    if (!p) return;
    if (!confirm(`⚠️ क्या आप वाकई "${p.name}" को हमेशा के लिए हटाना चाहते हैं?`)) return;

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
    if (box) box.innerHTML = '<small style="color:#0288d1;">⏳ सड़क से वास्तविक दूरी कैलकुलेट हो रही है...</small>';

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
            <span><b>${item.name}</b> (${item.path} • <b>${item.km} km Road</b>)</span>
            <button type="button" onclick="removeTempNextPadav(${idx})" style="background:#dc3545; color:white; border:none; border-radius:3px; padding:2px 6px; cursor:pointer;">✖</button>
        </div>
    `).join('');
}

async function submitNewPadav() {
    const editId = document.getElementById('editPadavId').value.trim();
    const isAuto = window.currentProfile && (window.currentProfile.role === 'super_admin' || window.currentProfile.role === 'moderator');

    const picker = document.getElementById('nextPadavPicker');
    if (picker && picker.value) {
        await addNextPadavToList(true);
    }

    const selectedPaths = Array.from(document.querySelectorAll('.pathTypeChk:checked')).map(cb => cb.value);
    const cleanNextList = window.tempNextPadavs.map(({ id, name, path, km }) => ({ id, name, path, km }));

    const obj = {
        yatra_id: window.activeYatra.id,
        name: document.getElementById('newPadavName').value.trim(),
        sub_route: document.getElementById('newPadavSubRoute').value,
        category: document.getElementById('newPadavCat').value,
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
        status: isAuto ? 'approved' : 'pending'
    };

    if (!obj.name || isNaN(obj.lat) || isNaN(obj.lng)) {
        return alert("पड़ाव का नाम और GPS लोकेशन आवश्यक है।");
    }

    if (editId) {
        const { data, error } = await supabaseClient.from('padavs').update(obj).eq('id', editId).select().single();
        if (error) return alert("Update Error: " + error.message);

        if (data) {
            syncPadavInMemory(data);
            renderIsolatedPadavs(window.activeYatraPadavs);
        }
        closeAllModals();
        alert("✅ पड़ाव की जानकारी अपडेट हो गई है!");
    } else {
        const { data, error } = await supabaseClient.from('padavs').insert([obj]).select().single();
        if (error) return alert("Insert Error: " + error.message);

        if (isAuto && data) {
            syncPadavInMemory(data);
            renderIsolatedPadavs(window.activeYatraPadavs);
        }
        closeAllModals();
        alert(isAuto ? "✅ नया पड़ाव मैप पर लाइव हो गया है!" : "✅ पड़ाव भेज दिया गया है। एडमिन अप्रूवल के बाद दिखेगा।");
    }
}

async function openAdminModal() {
    showModal('adminModal');
    document.getElementById('superAdminYatraCreator').style.display =
        window.currentProfile.role === 'super_admin' ? 'block' : 'none';
    document.getElementById('modYatraLabel').innerText = window.activeYatra.name;

    const { data: pending } = await supabaseClient
        .from('padavs')
        .select('*')
        .eq('yatra_id', window.activeYatra.id)
        .eq('status', 'pending');

    const box = document.getElementById('pendingPadavsList');
    if (!pending || pending.length === 0) {
        box.innerHTML = '<p style="color:#777; font-size:13px;">कोई पेंडिंग पड़ाव नहीं है।</p>';
        return;
    }

    box.innerHTML = pending.map(p => `
        <div style="border:1px solid #ddd; padding:8px; border-radius:6px; margin-bottom:8px; font-size:13px;">
            <b>${p.name}</b> (${p.category})<br><small>${p.bhojan_type} | ${p.niwas_type}</small><br>
            <button onclick="approvePadav('${p.id}')" style="background:#2e7d32; color:white; border:none; padding:4px 8px; border-radius:4px; margin-top:5px; cursor:pointer;">✔ Approve</button>
            <button onclick="deletePadav('${p.id}')" style="background:#dc3545; color:white; border:none; padding:4px 8px; border-radius:4px; margin-top:5px; cursor:pointer;">✖ Reject</button>
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

async function createNewYatra() {
    const subs = document.getElementById('newYatraSubRoutes').value.split(',').map(s => s.trim()).filter(Boolean);
    const { error } = await supabaseClient.from('yatras').insert([{
        slug: document.getElementById('newYatraSlug').value.trim().toLowerCase(),
        name: document.getElementById('newYatraName').value.trim(),
        name_hi: document.getElementById('newYatraNameHi').value.trim(),
        state: document.getElementById('newYatraState').value.trim(),
        yatra_type: document.getElementById('newYatraType').value,
        default_end_point: document.getElementById('newYatraEnd').value.trim() || null,
        sub_routes: subs,
        center_lat: parseFloat(document.getElementById('newYatraLat').value),
        center_lng: parseFloat(document.getElementById('newYatraLng').value),
        about_html: `<p>${document.getElementById('newYatraAbout').value}</p>`,
        information_html: `<p>${document.getElementById('newYatraInfo').value}</p>`,
        niyam_html: `<p>${document.getElementById('newYatraNiyam').value}</p>`
    }]);

    if (error) return alert("Error: " + error.message);
    alert("🎉 नई यात्रा और उसका SEO पेज तैयार हो गया है!");
    location.reload();
}

async function openAartiModal() {
    document.getElementById('aartiYatraTitle').innerText = window.activeYatra.name;
    const { data } = await supabaseClient.from('yatra_aartis').select('*').eq('yatra_id', window.activeYatra.id);
    document.getElementById('aartiContainer').innerHTML = (data && data.length)
        ? data.map(a => `<div style="margin-bottom:15px;"><h4>${a.title}</h4><pre style="white-space:pre-wrap; font-family:inherit;">${a.content}</pre></div>`).join('')
        : '<p style="color:#777;">इस यात्रा की आरती जल्द जोड़ी जाएगी।</p>';
    showModal('aartiModal');
}

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