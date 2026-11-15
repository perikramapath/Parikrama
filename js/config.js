// APNI SUPABASE KEYS YAHAN DALEIN
const SUPABASE_URL = 'https://ohazukqrnmiycvkldeeq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9oYXp1a3Fybm1peWN2a2xkZWVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2NzM5NTcsImV4cCI6MjExMDI0OTk1N30.6Hq116jqCeESuM9cWmmJljdAj6Mawjfnf_TCCFXDB-o';

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global State
window.currentLang = localStorage.getItem('pp_lang') || 'hi';
window.allYatras = [];
window.activeYatra = null;
window.selectedStartPadav = null;
window.calculatedEndPoint = '';
window.currentUser = null;
window.currentProfile = null;

window.LANG = {
    hi: {
        brandTitle: "🕉️ परिक्रमापथ (Parikramapath)",
        brandSub: "भारत की समस्त तीर्थ यात्रा एवं परिक्रमा मार्गदर्शिका",
        searchYatra: "🔍 यात्रा या राज्य खोजें (जैसे: नर्मदा, ब्रज, चार धाम)...",
        selectStartTitle: "🚩 अपना प्रारंभिक पड़ाव (Starting Point) चुनें",
        searchStart: "🔍 पड़ाव का नाम टाइप करें या नीचे से चुनें...",
        startBtn: "परिक्रमा शुरू करें (मैप खोलें) ➔",
        allRoutes: "🗺️ सभी मार्ग",
        bhojan: "🍛 भोजन",
        niwas: "🛌 निवास",
        nextPadav: "➡️ अगला पड़ाव",
        langToggle: "🌐 English"
    },
    en: {
        brandTitle: "🕉️ Parikramapath",
        brandSub: "All-India Teerth Yatra & Parikrama Guide",
        searchYatra: "🔍 Search Yatra or State (e.g., Narmada, Braj)...",
        selectStartTitle: "🚩 Select Your Starting Point",
        searchStart: "🔍 Type Padav name or select from list...",
        startBtn: "Start Parikrama (Open Map) ➔",
        allRoutes: "🗺️ All Routes",
        bhojan: "🍛 Food",
        niwas: "🛌 Stay",
        nextPadav: "➡️ Next Padav",
        langToggle: "🌐 हिंदी"
    }
};

window.t = function(key) {
    return (window.LANG[window.currentLang] && window.LANG[window.currentLang][key]) || key;
};

window.toggleLanguage = function() {
    window.currentLang = window.currentLang === 'hi' ? 'en' : 'hi';
    localStorage.setItem('pp_lang', window.currentLang);
    location.reload();
};