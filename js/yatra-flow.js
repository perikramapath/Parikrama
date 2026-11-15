window.yatraPadavsForSelection = [];

async function loadAllYatras() {
    document.getElementById('lblBrandTitle').innerText = t('brandTitle');
    document.getElementById('lblBrandSub').innerText = t('brandSub');
    document.getElementById('yatraSearchInput').placeholder = t('searchYatra');
    document.getElementById('langToggleBtn').innerText = t('langToggle');

    try {
        const { data, error } = await supabaseClient.from('yatras').select('*').order('name');
        if (error) throw error;
        window.allYatras = data || [];
        renderYatraCards(window.allYatras);
        if (typeof populateSevadarYatraDropdown === 'function') populateSevadarYatraDropdown(window.allYatras);

        // Check direct SEO URL link (?yatra=narmada-parikrama)
        const directSlug = new URLSearchParams(window.location.search).get('yatra');
        if (directSlug) {
            const matched = window.allYatras.find(y => y.slug === directSlug);
            if (matched) openStartPointGate(matched.id);
        }
    } catch (err) {
        console.error(err);
        document.getElementById('yatraCardsGrid').innerHTML = `<p style="color:red;">डेटा लोड करने में त्रुटि। कृपया रिफ्रेश करें।</p>`;
    }
}

function renderYatraCards(list) {
    const grid = document.getElementById('yatraCardsGrid');
    grid.innerHTML = '';
    list.forEach(y => {
        const displayName = window.currentLang === 'hi' ? (y.name_hi || y.name) : y.name;
        const typeLabel = y.yatra_type === 'circular' ? '🔄 Circular Parikrama' : `➡️ End: ${y.default_end_point}`;
        const card = document.createElement('div');
        card.className = 'yatra-card';
        card.style.borderLeftColor = y.theme_color;
        card.innerHTML = `
            <div onclick="openStartPointGate('${y.id}')" style="cursor:pointer;">
                <div style="font-size:26px;">${y.icon_emoji}</div>
                <h3 style="margin:5px 0; color:#222;">${displayName}</h3>
                <span class="badge">${y.state}</span>
                <p style="font-size:12px; color:#555; margin:8px 0;">${typeLabel} • ${y.total_distance_km} km</p>
            </div>
            <div style="display:flex; gap:8px; margin-top:10px; border-top:1px solid #eee; padding-top:8px;">
                <button onclick="openStartPointGate('${y.id}')" style="flex:1; background:${y.theme_color}; color:white; border:none; padding:7px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:12px;">🚩 यात्रा शुरू करें</button>
                <a href="yatra-guide.html?slug=${y.slug}" style="flex:1; text-align:center; background:#fff3e0; color:#d84315; text-decoration:none; padding:7px; border-radius:6px; font-weight:bold; font-size:12px;">📖 नियम व जानकारी</a>
            </div>
        `;
        grid.appendChild(card);
    });
}

function filterYatraCards() {
    const q = document.getElementById('yatraSearchInput').value.toLowerCase();
    const filtered = window.allYatras.filter(y =>
        y.name.toLowerCase().includes(q) || (y.name_hi && y.name_hi.includes(q)) || y.state.toLowerCase().includes(q)
    );
    renderYatraCards(filtered);
}

async function openStartPointGate(yatraId) {
    const yatra = window.allYatras.find(y => y.id === yatraId);
    if (!yatra) return;

    window.activeYatra = yatra;
    window.selectedStartPadav = null;

    document.getElementById('yatraGate').style.display = 'none';
    document.getElementById('startPointGate').style.display = 'flex';
    document.getElementById('routeSummaryBox').style.display = 'none';

    const btn = document.getElementById('confirmStartBtn');
    btn.disabled = true;
    btn.style.background = '#ccc';

    const displayName = window.currentLang === 'hi' ? (yatra.name_hi || yatra.name) : yatra.name;
    document.getElementById('spYatraTitle').innerText = `${yatra.icon_emoji} ${displayName}`;
    document.getElementById('spYatraMeta').innerText = `${yatra.state} • ${yatra.total_distance_km} km`;
    document.getElementById('selectedYatraHeader').style.borderLeftColor = yatra.theme_color;

    const dropdown = document.getElementById('startPointDropdown');
    dropdown.innerHTML = '<option value="">पड़ाव लोड हो रहे हैं...</option>';

    const { data: padavs } = await supabaseClient
        .from('padavs')
        .select('*')
        .eq('yatra_id', yatraId)
        .eq('status', 'approved')
        .order('sequence_no', { ascending: true });

    window.yatraPadavsForSelection = padavs || [];
    renderStartPointDropdown(window.yatraPadavsForSelection);
}

function renderStartPointDropdown(list) {
    const dropdown = document.getElementById('startPointDropdown');
    dropdown.innerHTML = '';
    if (list.length === 0) {
        dropdown.innerHTML = '<option value="custom">इस यात्रा में अभी पड़ाव नहीं जुड़े हैं (सीधे मैप खोलें)</option>';
        onStartPointSelected('custom');
        return;
    }
    list.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.innerText = `📍 ${p.name} (${p.sub_route || 'Main'})`;
        dropdown.appendChild(opt);
    });
}

function filterStartPointOptions() {
    const q = document.getElementById('startPointSearch').value.toLowerCase();
    const filtered = window.yatraPadavsForSelection.filter(p =>
        p.name.toLowerCase().includes(q) || (p.sub_route && p.sub_route.toLowerCase().includes(q))
    );
    renderStartPointDropdown(filtered);
}

function onStartPointSelected(padavId) {
    const summaryBox = document.getElementById('routeSummaryBox');
    const btn = document.getElementById('confirmStartBtn');

    if (padavId === 'custom') {
        window.selectedStartPadav = null;
        window.calculatedEndPoint = window.activeYatra.default_end_point || 'यात्रा समापन';
        summaryBox.style.display = 'none';
    } else {
        const padav = window.yatraPadavsForSelection.find(p => p.id === padavId);
        if (!padav) return;
        window.selectedStartPadav = padav;
        summaryBox.style.display = 'block';
        document.getElementById('previewStartText').innerText = padav.name;

        if (window.activeYatra.yatra_type === 'circular') {
            window.calculatedEndPoint = `${padav.name} (परिक्रमा पूर्ण)`;
            document.getElementById('previewEndText').innerText = window.calculatedEndPoint;
            document.getElementById('previewRuleNote').innerText = "ℹ️ यह गोल (Circular) परिक्रमा है — जहाँ से प्रारंभ करेंगे, वहीं समापन होगा।";
        } else {
            window.calculatedEndPoint = window.activeYatra.default_end_point || 'मुख्य धाम';
            document.getElementById('previewEndText').innerText = window.calculatedEndPoint;
            document.getElementById('previewRuleNote').innerText = `ℹ️ यह यात्रा ${padav.name} से प्रारंभ होकर ${window.calculatedEndPoint} पर पूर्ण होगी।`;
        }
    }

    btn.disabled = false;
    btn.style.background = window.activeYatra.theme_color;
    btn.style.cursor = 'pointer';
}

async function launchYatraMap() {
    document.getElementById('startPointGate').style.display = 'none';
    document.getElementById('mainAppContainer').style.display = 'block';

    const displayName = window.currentLang === 'hi' ? (window.activeYatra.name_hi || window.activeYatra.name) : window.activeYatra.name;
    document.getElementById('activeYatraName').innerText = displayName;
    document.getElementById('activeYatraBtn').style.background = window.activeYatra.theme_color;
    document.getElementById('activeStartBadge').innerText = window.selectedStartPadav ? window.selectedStartPadav.name.substring(0, 16) + '...' : 'Start Point';

    const subSelect = document.getElementById('subRouteFilter');
    subSelect.innerHTML = `<option value="all">${t('allRoutes')}</option>`;
    (window.activeYatra.sub_routes || []).forEach(sr => {
        const opt = document.createElement('option');
        opt.value = sr;
        opt.innerText = sr;
        subSelect.appendChild(opt);
    });

    if (window.currentUser) {
        await supabaseClient.from('profiles').update({
            active_yatra_id: window.activeYatra.id,
            start_point_id: window.selectedStartPadav ? window.selectedStartPadav.id : null,
            start_point_name: window.selectedStartPadav ? window.selectedStartPadav.name : 'Not Set',
            end_point_name: window.calculatedEndPoint
        }).eq('id', window.currentUser.id);
    }

    await initAndLoadIsolatedMap();
}

function backToYatraGate() {
    document.getElementById('startPointGate').style.display = 'none';
    document.getElementById('mainAppContainer').style.display = 'none';
    document.getElementById('yatraGate').style.display = 'flex';
}

function openStartPointChanger() {
    document.getElementById('mainAppContainer').style.display = 'none';
    openStartPointGate(window.activeYatra.id);
}

function openYatraSeoPage() {
    if (window.activeYatra) window.open(`yatra-guide.html?slug=${window.activeYatra.slug}`, '_blank');
}

window.addEventListener('DOMContentLoaded', loadAllYatras);