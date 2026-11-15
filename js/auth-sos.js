// =========================================================
// PARIKRAMAPATH - AUTH, SEVADAR, DYNAMIC ID CARD & SOS
// =========================================================

function populateSevadarYatraDropdown(yatras) {
    const sel = document.getElementById('regSevadarYatra');
    if (sel) {
        sel.innerHTML = yatras.map(y => `<option value="${y.id}">${y.name}</option>`).join('');
    }
}

function onRoleChange() {
    document.getElementById('sevadarRegFields').style.display =
        document.getElementById('regRole').value === 'supporter' ? 'block' : 'none';
}

// 1. User / Sevadar Registration
async function registerUser() {
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPass').value.trim();
    const full_name = document.getElementById('regName').value.trim();
    const mobile = document.getElementById('regMobile').value.trim();
    const role = document.getElementById('regRole').value;

    if (!email || !password || !full_name || !mobile) {
        return alert("कृपया सभी आवश्यक जानकारी (नाम, मोबाइल, ईमेल, पासवर्ड) भरें।");
    }

    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) return alert("Registration Error: " + error.message);

    if (data && data.user) {
        const { error: profErr } = await supabaseClient.from('profiles').insert([{
            id: data.user.id,
            full_name,
            mobile,
            email,
            role,
            status: role === 'supporter' ? 'pending' : 'approved',
            assigned_yatra_id: role === 'supporter' ? document.getElementById('regSevadarYatra').value : null,
            sevadar_area: role === 'supporter' ? document.getElementById('regSevadarArea').value.trim() : null
        }]);

        if (profErr) console.error("Profile insert warning:", profErr.message);
    }

    alert("✅ Parikramapath पर रजिस्ट्रेशन सफल! कृपया अब लॉगिन करें।");
    toggleAuthForm('login');
}

// 2. Login Function
async function loginUser() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPass').value.trim();

    if (!email || !password) return alert("कृपया Email और Password डालें।");

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) return alert("Login Error: " + error.message);

    await applyUserSession(data.user);
    closeAllModals();
    alert(`🙏 नमस्ते ${window.currentProfile ? window.currentProfile.full_name : ''}! Parikramapath में स्वागत है।`);
}

// 3. Apply User Session & Reveal Admin/Moderator Controls
async function applyUserSession(user) {
    if (!user) return;
    window.currentUser = user;

    const { data: prof } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

    window.currentProfile = prof || {
        id: user.id,
        full_name: user.email,
        mobile: '-',
        role: 'pilgrim',
        journey_history: []
    };

    const loginBtn = document.getElementById('loginMenuBtn');
    const logoutBtn = document.getElementById('logoutMenuBtn');
    const profileBtn = document.getElementById('profileMenuBtn');

    if (loginBtn) loginBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'block';
    if (profileBtn) profileBtn.style.display = 'block';

    const isAdminOrMod = (window.currentProfile.role === 'super_admin' || window.currentProfile.role === 'moderator');

    const adminBtn = document.getElementById('adminMenuBtn');
    const manualDrawBtn = document.getElementById('manualDrawMenuBtn');
    const gpsFollowBtn = document.getElementById('gpsFollowMenuBtn');

    if (adminBtn) adminBtn.style.display = isAdminOrMod ? 'block' : 'none';
    if (manualDrawBtn) manualDrawBtn.style.display = isAdminOrMod ? 'block' : 'none';
    if (gpsFollowBtn) gpsFollowBtn.style.display = isAdminOrMod ? 'block' : 'none';
}

// 4. Page Refresh par Automatic Session Check
window.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session && session.user) {
        await applyUserSession(session.user);
    }
});

// 5. Dynamic Yatra ID Card & Journey History
function openProfileModal() {
    if (!window.currentProfile || !window.activeYatra) return;

    document.getElementById('cardYatraTitle').innerText = `${window.activeYatra.icon_emoji} ${window.activeYatra.name}`;
    document.getElementById('cardRoleBadge').innerText = window.currentProfile.role.toUpperCase();
    document.getElementById('cardUserName').innerText = window.currentProfile.full_name;
    document.getElementById('cardUserMobile').innerText = window.currentProfile.mobile;
    document.getElementById('cardStartPoint').innerText = window.selectedStartPadav ? window.selectedStartPadav.name : 'Not Selected';
    document.getElementById('cardEndPoint').innerText = window.calculatedEndPoint || 'Not Set';

    const hist = window.currentProfile.journey_history || [];
    document.getElementById('journeyHistoryBox').innerHTML = `<b>📜 पूर्ण की गई यात्राएं (${hist.length}):</b><br>` +
        (hist.length ? hist.map(h => `✅ ${h.yatra_name} (${h.date})`).join('<br>') : 'अभी तक कोई यात्रा पूर्ण नहीं हुई है।');

    showModal('profileModal');
}

// 6. Complete Current Yatra & Switch to Next Yatra
async function completeCurrentYatra() {
    if (!confirm("क्या आपने यह परिक्रमा पूर्ण कर ली है? इसके बाद आप नई यात्रा शुरू कर सकेंगे।")) return;

    const hist = window.currentProfile.journey_history || [];
    hist.push({
        yatra_name: window.activeYatra.name,
        start_point: window.selectedStartPadav ? window.selectedStartPadav.name : '',
        date: new Date().toLocaleDateString()
    });

    await supabaseClient.from('profiles').update({
        journey_history: hist,
        active_yatra_id: null,
        start_point_id: null
    }).eq('id', window.currentProfile.id);

    window.currentProfile.journey_history = hist;
    closeAllModals();
    backToYatraGate();
}

// 7. Geo-Fenced Smart SOS (Strictly Linked to Active Yatra)
function openSOSModal() {
    if (!window.activeYatra) return;
    document.getElementById('sosYatraName').innerText = window.activeYatra.name;
    showModal('sosModal');
}

function triggerSOS(helpType) {
    if (!navigator.geolocation) return alert("आपके डिवाइस में GPS उपलब्ध नहीं है।");

    navigator.geolocation.getCurrentPosition(async (pos) => {
        const { error } = await supabaseClient.from('sos_alerts').insert([{
            user_id: window.currentUser ? window.currentUser.id : null,
            user_name: window.currentProfile ? window.currentProfile.full_name : 'Guest Yatri',
            user_mobile: window.currentProfile ? window.currentProfile.mobile : 'N/A',
            yatra_id: window.activeYatra.id,
            help_type: helpType,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
        }]);

        if (error) return alert("SOS Error: " + error.message);

        closeAllModals();
        alert(`🚨 SOS भेज दिया गया है! ${window.activeYatra.name} के नजदीकी सेवादारों को आपकी लोकेशन मिल गई है।`);
    }, () => {
        alert("GPS लोकेशन नहीं मिल सकी। कृपया लोकेशन परमिशन चालू करें।");
    });
}