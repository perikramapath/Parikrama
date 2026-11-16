window.ParikramaVisited = (function () {
    const HIDE_PREF_KEY = 'parikrama_hide_visited_map';
    const registry = new Map(); // padavId -> { marker, map, padav }

    function getActiveSlug() {
        if (window.activeYatra && window.activeYatra.slug) return window.activeYatra.slug;
        if (window.currentYatra && window.currentYatra.slug) return window.currentYatra.slug;
        const params = new URLSearchParams(window.location.search);
        return params.get('yatra') || params.get('slug') || 'default';
    }

    function getStorageKey() {
        return `parikrama_visited_${getActiveSlug()}`;
    }

    function getVisitedIds() {
        try {
            return JSON.parse(localStorage.getItem(getStorageKey()) || '[]');
        } catch (e) {
            return [];
        }
    }

    function saveVisitedIds(ids) {
        localStorage.setItem(getStorageKey(), JSON.stringify(ids));
    }

    function isVisited(padavId) {
        return getVisitedIds().includes(String(padavId));
    }

    function isHideEnabled() {
        return localStorage.getItem(HIDE_PREF_KEY) === 'true';
    }

    function updateToggleButtonUI() {
        const btn = document.getElementById('toggleHideVisitedMapBtn');
        if (!btn) return;
        const hide = isHideEnabled();
        btn.innerText = hide ? '🙈 पूर्ण छिपे हैं' : '👁️ पूर्ण दिखाएं';
        btn.style.background = hide ? '#2e7d32' : '#37474f';
    }

    function applyMarkerVisibility(padavId) {
        const entry = registry.get(String(padavId));
        if (!entry || !entry.marker || !entry.map) return;

        const shouldHide = isVisited(padavId) && isHideEnabled();
        if (shouldHide) {
            if (entry.map.hasLayer(entry.marker)) {
                entry.map.removeLayer(entry.marker);
            }
        } else {
            if (!entry.map.hasLayer(entry.marker)) {
                entry.marker.addTo(entry.map);
            }
        }
    }

    function refreshAllMarkers() {
        updateToggleButtonUI();
        registry.forEach((_, padavId) => applyMarkerVisibility(padavId));
    }

    function togglePadav(padavId) {
        const idStr = String(padavId);
        let ids = getVisitedIds();
        if (ids.includes(idStr)) {
            ids = ids.filter(id => id !== idStr);
        } else {
            ids.push(idStr);
        }
        saveVisitedIds(ids);
        applyMarkerVisibility(idStr);

        // यदि पॉपअप खुला है तो बटन का स्टेटस तुरंत अपडेट करें
        const btn = document.getElementById(`visited-btn-${idStr}`);
        if (btn) {
            const done = ids.includes(idStr);
            btn.innerText = done ? '✅ Visited (पूर्ण)' : '⬜ Visited मार्क करें';
            btn.style.background = done ? '#2e7d32' : '#ff9800';
        }
    }

    function toggleHideVisited() {
        const nextState = !isHideEnabled();
        localStorage.setItem(HIDE_PREF_KEY, nextState ? 'true' : 'false');
        refreshAllMarkers();
    }

    function clearRegistry() {
        registry.clear();
    }

    function attachToMarker(mapInstance, marker, padav) {
        if (!padav || !padav.id) return;
        const idStr = String(padav.id);
        registry.set(idStr, { marker, map: mapInstance, padav });
        applyMarkerVisibility(idStr);
    }

    function getActionButtonHtml(padavId) {
        const idStr = String(padavId);
        const done = isVisited(idStr);
        const bg = done ? '#2e7d32' : '#ff9800';
        const label = done ? '✅ Visited (पूर्ण)' : '⬜ Visited मार्क करें';
        return `<button type="button" id="visited-btn-${idStr}" onclick="ParikramaVisited.togglePadav('${idStr}')" style="width:100%; margin-top:6px; padding:6px 10px; background:${bg}; color:white; border:none; border-radius:6px; font-weight:bold; font-size:12px; cursor:pointer;">${label}</button>`;
    }

    document.addEventListener('DOMContentLoaded', updateToggleButtonUI);

    return {
        isVisited,
        togglePadav,
        toggleHideVisited,
        attachToMarker,
        getActionButtonHtml,
        refreshAllMarkers,
        clearRegistry
    };
})();