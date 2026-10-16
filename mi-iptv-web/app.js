const API_CHANNELS = 'https://iptv-org.github.io/api/channels.json';
const API_STREAMS = 'https://iptv-org.github.io/api/streams.json';

let playableChannels = [];
let activeCategory = 'All';
let selectedChannelIds = new Set();
let isSelecting = false;
let startX, startY, selectionBox;

const channelsGrid = document.getElementById('channelsGrid');
const categoriesList = document.getElementById('categoriesList');
const searchInput = document.getElementById('searchInput');
const channelCount = document.getElementById('channelCount');
const videoPlayer = document.getElementById('videoPlayer');
const playerContainer = document.getElementById('playerContainer');
const currentChannelName = document.getElementById('currentChannelName');
const closePlayerBtn = document.getElementById('closePlayer');
const m3uUrlInput = document.getElementById('m3uUrlInput');
const loadM3uBtn = document.getElementById('loadM3uBtn');

let hls = null;

async function init() {
    createSelectionBoxElement();
    try {
        channelCount.textContent = 'Cargando canales oficiales...';
        const [channelsRes, streamsRes] = await Promise.all([
            fetch(API_CHANNELS),
            fetch(API_STREAMS)
        ]);

        const rawChannels = await channelsRes.json();
        const rawStreams = await streamsRes.json();

        const streamMap = new Map();
        rawStreams.forEach(stream => {
            if (stream.channel && stream.url) {
                streamMap.set(stream.channel, stream.url);
            }
        });

        playableChannels = rawChannels
            .filter(ch => streamMap.has(ch.id))
            .map(ch => ({
                id: 'ch_' + Math.random().toString(36).substr(2, 9),
                name: ch.name,
                logo: ch.logo || '',
                group: ch.categories ? ch.categories[0] : 'General',
                url: streamMap.get(ch.id)
            }));

        selectedChannelIds.clear();
        applyFilters();
    } catch (error) {
        console.error('Error:', error);
        channelCount.textContent = 'Error al cargar';
    }
}

function createSelectionBoxElement() {
    if (document.getElementById('selectionBox')) return;
    selectionBox = document.createElement('div');
    selectionBox.id = 'selectionBox';
    selectionBox.className = 'fixed border border-cyan-400 bg-cyan-500/20 pointer-events-none hidden z-50 rounded';
    document.body.appendChild(selectionBox);
}

loadM3uBtn.addEventListener('click', async () => {
    const url = m3uUrlInput.value.trim();
    if (!url) return;

    channelCount.textContent = 'Cargando lista personalizada...';
    channelsGrid.innerHTML = `<p class="text-cyan-400 col-span-full text-center py-10">Descargando y procesando lista M3U...</p>`;

    try {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const res = await fetch(proxyUrl);
        const m3uText = await res.text();

        const parsed = iptvPlaylistParser.parse(m3uText);

        if (parsed.items && parsed.items.length > 0) {
            playableChannels = parsed.items.map(item => ({
                id: 'ch_' + Math.random().toString(36).substr(2, 9),
                name: item.name,
                logo: item.tvg.logo || '',
                group: item.group.title || 'Deportes / Otros',
                url: item.url
            }));

            activeCategory = 'All';
            selectedChannelIds.clear();
            applyFilters();
            alert(`¡Lista cargada con éxito! Se encontraron ${playableChannels.length} canales.`);
        } else {
            alert('No se pudieron encontrar canales válidos en esa lista.');
        }
    } catch (err) {
        console.error(err);
        alert('Error al cargar la lista M3U.');
        channelCount.textContent = 'Error en lista M3U';
    }
});

function updateInterface(channelsToUse) {
    channelCount.textContent = `${channelsToUse.length} mostrados (${selectedChannelIds.size} seleccionados de ${playableChannels.length} totales)`;
    renderCategories();
    renderChannels(channelsToUse);
}

function renderCategories() {
    const categoriesSet = new Set();
    playableChannels.forEach(ch => {
        if (ch.group) categoriesSet.add(ch.group);
    });

    let html = `<button onclick="filterByCategory('All')" class="w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition ${activeCategory === 'All' ? 'bg-cyan-500/10 text-cyan-400' : 'text-slate-400 hover:bg-slate-800'}">Todas</button>`;

    Array.from(categoriesSet).sort().forEach(cat => {
        const isActive = activeCategory === cat;
        html += `<button onclick="filterByCategory('${cat}')" class="w-full text-left px-3 py-2 rounded-lg text-sm truncate transition ${isActive ? 'bg-cyan-500/10 text-cyan-400' : 'text-slate-400 hover:bg-slate-800'}">${cat}</button>`;
    });

    categoriesList.innerHTML = html;
}

window.filterByCategory = function(category) {
    activeCategory = category;
    applyFilters();
};

function renderChannels(channels) {
    if (channels.length === 0) {
        channelsGrid.innerHTML = `<p class="text-slate-500 col-span-full text-center py-10">No hay canales para mostrar con este filtro.</p>`;
        return;
    }

    // Panel de controles de selección masiva en la parte superior
    let batchActionHTML = `
        <div class="col-span-full bg-slate-900 border border-slate-800 p-3 rounded-xl flex flex-wrap justify-between items-center gap-2 mb-4 sticky top-4 z-40 shadow-xl backdrop-blur">
            <div class="flex items-center space-x-2">
                <span class="text-cyan-400 text-sm font-medium">${selectedChannelIds.size} seleccionados</span>
                <button onclick="selectAllVisible()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-2.5 py-1.5 rounded-lg transition">Seleccionar visibles</button>
                <button onclick="selectExceptESPN()" class="bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 text-xs px-2.5 py-1.5 rounded-lg border border-indigo-500/30 transition">Seleccionar todo excepto ESPN</button>
                <button onclick="clearSelection()" class="bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs px-2.5 py-1.5 rounded-lg transition">Limpiar selección</button>
            </div>
            <div>
                ${selectedChannelIds.size > 0 ? `<button onclick="deleteSelectedChannels()" class="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition shadow-lg">Eliminar seleccionados (${selectedChannelIds.size})</button>` : ''}
            </div>
        </div>
    `;

    const limit = channels.slice(0, 150);

    channelsGrid.innerHTML = batchActionHTML + limit.map(ch => {
        const isSelected = selectedChannelIds.has(ch.id);
        return `
            <div data-id="${ch.id}" class="channel-card bg-slate-900 border ${isSelected ? 'border-cyan-400 bg-cyan-950/30 ring-2 ring-cyan-500/50' : 'border-slate-800 hover:border-cyan-500/50'} rounded-xl p-4 flex flex-col justify-between transition relative group select-none">
                <div class="absolute top-2 right-2 z-10">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} onclick="toggleSelectChannel(event, '${ch.id}')" class="w-4 h-4 accent-cyan-500 cursor-pointer">
                </div>

                <div class="flex items-center space-x-3 mb-3 cursor-pointer" onclick="playChannel('${ch.url}', '${ch.name.replace(/'/g, "\\'")}')">
                    <div class="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center p-1 shrink-0 border border-slate-700">
                        ${ch.logo ? `<img src="${ch.logo}" alt="" class="max-h-full max-w-full object-contain" onerror="this.src='https://via.placeholder.com/40?text=TV'">` : '📺'}
                    </div>
                    <div class="overflow-hidden pr-6">
                        <h3 class="font-semibold text-slate-100 text-sm truncate group-hover:text-cyan-400">${ch.name}</h3>
                        <p class="text-xs text-slate-400">${ch.group}</p>
                    </div>
                </div>
                <button onclick="playChannel('${ch.url}', '${ch.name.replace(/'/g, "\\'")}')" class="w-full text-center bg-slate-800 hover:bg-cyan-600 hover:text-white text-slate-300 text-xs py-1.5 rounded-lg transition font-medium">Reproducir</button>
            </div>
        `;
    }).join('');
}

window.toggleSelectChannel = function(event, id) {
    event.stopPropagation();
    if (selectedChannelIds.has(id)) {
        selectedChannelIds.delete(id);
    } else {
        selectedChannelIds.add(id);
    }
    applyFilters();
};

window.clearSelection = function() {
    selectedChannelIds.clear();
    applyFilters();
};

window.selectAllVisible = function() {
    const filtered = getFilteredChannels();
    filtered.forEach(ch => selectedChannelIds.add(ch.id));
    applyFilters();
};

// Selecciona automáticamente todo lo que NO tenga la palabra ESPN
window.selectExceptESPN = function() {
    playableChannels.forEach(ch => {
        if (!ch.name.toUpperCase().includes('ESPN')) {
            selectedChannelIds.add(ch.id);
        } else {
            selectedChannelIds.delete(ch.id); // Asegura que ESPN NUNCA se seleccione
        }
    });
    applyFilters();
};

window.deleteSelectedChannels = function() {
    playableChannels = playableChannels.filter(ch => !selectedChannelIds.has(ch.id));
    selectedChannelIds.clear();
    applyFilters();
};

// Lógica de rectángulo por arrastre de cursor
channelsGrid.addEventListener('mousedown', (e) => {
    if (e.target.closest('button') || e.target.closest('input')) return;

    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;

    selectionBox.style.left = `${startX}px`;
    selectionBox.style.top = `${startY}px`;
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    selectionBox.classList.remove('hidden');
});

window.addEventListener('mousemove', (e) => {
    if (!isSelecting) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const left = Math.min(currentX, startX);
    const top = Math.min(currentY, startY);

    selectionBox.style.width = `${width}px`;
    selectionBox.style.height = `${height}px`;
    selectionBox.style.left = `${left}px`;
    selectionBox.style.top = `${top}px`;

    const cards = channelsGrid.querySelectorAll('.channel-card');
    cards.forEach(card => {
        const rect = card.getBoundingClientRect();
        const id = card.getAttribute('data-id');

        const isOverlapping = !(
            rect.right < left ||
            rect.left > left + width ||
            rect.bottom < top ||
            rect.top > top + height
        );

        if (isOverlapping) {
            selectedChannelIds.add(id);
        }
    });

    const filtered = getFilteredChannels();
    updateInterface(filtered);
});

window.addEventListener('mouseup', () => {
    if (!isSelecting) return;
    isSelecting = false;
    selectionBox.classList.add('hidden');
});

function getFilteredChannels() {
    const term = searchInput.value.toLowerCase();
    return playableChannels.filter(ch => {
        const matchesSearch = ch.name.toLowerCase().includes(term);
        const matchesCat = activeCategory === 'All' || ch.group === activeCategory;
        return matchesSearch && matchesCat;
    });
}

function applyFilters() {
    const filtered = getFilteredChannels();
    updateInterface(filtered);
}

searchInput.addEventListener('input', applyFilters);

window.playChannel = function(url, name) {
    playerContainer.classList.remove('hidden');
    currentChannelName.textContent = name;
    playerContainer.scrollIntoView({ behavior: 'smooth' });

    if (Hls.isSupported()) {
        if (hls) hls.destroy();
        hls = new Hls();
        hls.loadSource(url);
        hls.attachMedia(videoPlayer);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            videoPlayer.play().catch(e => console.log("Autoplay bloqueado:", e));
        });
        hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                console.warn("Stream caído:", data);
            }
        });
    } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
        videoPlayer.src = url;
        videoPlayer.addEventListener('loadedmetadata', () => {
            videoPlayer.play();
        });
    }
};

closePlayerBtn.addEventListener('click', () => {
    if (hls) hls.destroy();
    videoPlayer.pause();
    videoPlayer.src = '';
    playerContainer.classList.add('hidden');
});

init();