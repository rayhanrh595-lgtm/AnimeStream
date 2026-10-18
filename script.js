let allAnimeData = [];

// জেসন ফাইল থেকে ডাটা ফেচ করা
async function fetchAnimeData() {
    try {
        const response = await fetch('anime.json');
        allAnimeData = await response.json();
        displayAnime(allAnimeData);
    } catch (error) {
        console.error("Error loading anime data:", error);
    }
}

const animeListEl = document.getElementById("animeList");
const currentTitleEl = document.getElementById("currentTitle");
const videoContainerEl = document.getElementById("videoContainer");
const searchInput = document.getElementById("searchInput");

// অ্যানিমে লিস্ট স্ক্রিনে শো করার ফাংশন
function displayAnime(animeArray) {
    animeListEl.innerHTML = "";
    if (animeArray.length === 0) {
        animeListEl.innerHTML = "<p style='color: #888; padding: 10px;'>No anime found</p>";
        return;
    }

    animeArray.forEach((anime) => {
        const card = document.createElement("div");
        card.classList.add("anime-card");
        card.innerHTML = `
            <h3>${anime.title}</h3>
            <span class="badge">${anime.category} | ${anime.subCategory}</span>
        `;
        
        card.addEventListener("click", () => {
            currentTitleEl.innerText = anime.title;
            videoContainerEl.innerHTML = `<iframe src="${anime.embedUrl}" allowfullscreen></iframe>`;
        });

        animeListEl.appendChild(card);
    });
}

// ক্যাটাগরি অনুযায়ী ফিল্টার করার ফাংশন
function filterCategory(category) {
    document.querySelectorAll('.cat-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    if (category === 'All') {
        displayAnime(allAnimeData);
    } else {
        const filtered = allAnimeData.filter(anime => anime.category === category);
        displayAnime(filtered);
    }
}

// সার্চ ইনপুট লজিক
searchInput.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allAnimeData.filter(anime => anime.title.toLowerCase().includes(term));
    displayAnime(filtered);
});

// পেজ লোড হলে ডাটা ফেচ হবে
fetchAnimeData();