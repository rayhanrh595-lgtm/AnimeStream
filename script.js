// ডেমো অ্যানিমে ডেটা (পরে এখানে আপনি অটোমেটিক লিংক বা জেসন ফাইল যুক্ত করতে পারবেন)
const animeData = [
    {
        title: "Naruto - Episode 1",
        embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ" // এটি জাস্ট একটি ডেমো লিংক
    },
    {
        title: "Attack on Titan - Episode 1",
        embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ"
    },
    {
        title: "Demon Slayer - Episode 1",
        embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ"
    }
];

const animeListEl = document.getElementById("animeList");
const currentTitleEl = document.getElementById("currentTitle");
const videoContainerEl = document.getElementById("videoContainer");

// অ্যানিমে লিস্ট স্ক্রিনে শো করার ফাংশন
function loadAnimeList() {
    animeListEl.innerHTML = "";
    animeData.forEach((anime, index) => {
        const card = document.createElement("div");
        card.classList.add("anime-card");
        card.innerHTML = `<h3>${anime.title}</h3>`;
        
        // কোনো কার্ডে ক্লিক করলে ভিডিও প্লেয়ারে সেই ভিডিও লোড হবে
        card.addEventListener("click", () => {
            currentTitleEl.innerText = anime.title;
            videoContainerEl.innerHTML = `<iframe src="${anime.embedUrl}" allowfullscreen></iframe>`;
        });

        animeListEl.appendChild(card);
    });
}

loadAnimeList();