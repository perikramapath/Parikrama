// =========================================================
// PARIKRAMAPATH - ADMIN, YATRA CRUD, FORMATTER & PADAV APPROVAL
// =========================================================

window.tempNextPadavs = [];

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
// 2. ADMIN MODAL: PENDING PADAVS + YATRA CREATE / EDIT / DELETE
// =========================================================
async function openAdminModal() {
    showModal('adminModal');
    const isSuperAdmin = isSuperAdminUser();
    const creatorBox = document.getElementById('superAdminYatraCreator');
    if (creatorBox) {
        creatorBox.style.display = isSuperAdmin ? 'block' : 'none';
    }
    document.getElementById('modYatraLabel').innerText = window.activeYatra ? window.activeYatra.name : '';

    if (isSuperAdmin) {
        resetYatraCreatorForm();
        await loadAdminYatrasList();
    }

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

    // Agar pehle se HTML tags likhe hain to direct save karein
    if (/<(p|ul|ol|li|h[1-6]|br|div)\b[^>]*>/i.test(text)) {
        return text;
    }

    const lines = text.split(/\r?\n/);
    let htmlOutput = '';
    let inBulletList = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Khaali line = Paragraph gap
        if (!line) {
            if (inBulletList) {
                htmlOutput += '</ul>';
                inBulletList = false;
            }
            continue;
        }

        // Bullet point check (-, *, •, ya 1.)
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
            // Agar line ke ant mein ':' hai to Bold Sub-heading banayein
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