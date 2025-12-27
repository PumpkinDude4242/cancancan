/**
 * CAN Clicker Game - Client v2
 * Nouvelle UX: Clic direct sur barres, caméra verticale suivant le leader, système de gouttes
 *
 * Vanilla JS optimisé pour performance
 */

// ============================================================
// ÉTAT GLOBAL DU JEU
// ============================================================

const Game = {
    // Données serveur
    teams: [],
    matches: [],
    settings: {},
    scores: {},
    liveTeams: [],

    // État UI
    connectedUsers: 0,
    backgroundLevel: 'stadium',

    // Système de caméra
    camera: {
        offsetY: 0,           // Décalage vertical actuel (positif = monte)
        targetOffsetY: 0,     // Cible pour interpolation
        viewportHeight: 0,    // Hauteur visible
        groundY: 0            // Position Y du sol dans le viewport
    },

    // Système de combo
    clickHistory: [],         // Timestamps des derniers clics
    comboActive: false,
    comboThreshold: 5,        // Clics/seconde pour combo

    // Références DOM (cache)
    dom: {}
};

// Socket.io
let socket = null;

// ============================================================
// INITIALISATION
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('🏆 CAN Clicker v2 - Initialisation...');

    // Cache des éléments DOM
    cacheDOM();

    // Dimensions initiales
    updateViewportDimensions();

    // Socket.io
    initSocket();

    // Charger les données
    loadGameData();

    // Event listeners
    setupEvents();

    // Boucle de rendu
    requestAnimationFrame(gameLoop);
});

/**
 * Cache les références DOM pour éviter les queries répétées
 */
function cacheDOM() {
    Game.dom = {
        loadingScreen: document.getElementById('loading-screen'),
        worldViewport: document.getElementById('world-viewport'),
        worldContainer: document.getElementById('world-container'),
        ground: document.getElementById('ground'),
        dropsContainer: document.getElementById('drops-container'),
        clickEffects: document.getElementById('click-effects'),
        toastContainer: document.getElementById('toast-container'),
        comboOverlay: document.getElementById('combo-overlay'),
        liveIndicator: document.getElementById('live-indicator'),
        liveMatchText: document.getElementById('live-match-text'),
        usersCount: document.getElementById('users-count'),
        leaderName: document.getElementById('leader-name'),
        leaderScore: document.getElementById('leader-score')
    };
}

/**
 * Met à jour les dimensions du viewport
 */
function updateViewportDimensions() {
    Game.camera.viewportHeight = window.innerHeight - 50; // Moins header
    Game.camera.groundY = Game.camera.viewportHeight - 20; // 20px pour le sol
}

// ============================================================
// SOCKET.IO - TEMPS RÉEL
// ============================================================

function initSocket() {
    socket = io({
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000
    });

    socket.on('connect', () => {
        console.log('🔌 Connecté au serveur');
        showToast('Connecté !', 'success');
    });

    socket.on('init', (data) => {
        console.log('📦 État initial reçu');
        Game.scores = data.scores;
        Game.liveTeams = data.liveTeams || [];
        Game.backgroundLevel = data.backgroundLevel;
        Game.connectedUsers = data.connectedUsers;

        updateUI();
        renderAllBars();
    });

    socket.on('score-update', (data) => {
        Game.scores[data.teamId] = data.score;

        if (data.backgroundLevel !== Game.backgroundLevel) {
            Game.backgroundLevel = data.backgroundLevel;
            updateBackground();
        }

        // Mise à jour de la barre concernée
        updateBarHeight(data.teamId);
        updateBarScore(data.teamId);
        updateLeaderDisplay();
    });

    socket.on('ranking-update', (data) => {
        if (data.backgroundLevel !== Game.backgroundLevel) {
            Game.backgroundLevel = data.backgroundLevel;
            updateBackground();
        }
        updateLeaderDisplay();
    });

    socket.on('live-update', (data) => {
        Game.liveTeams = data.liveTeams || [];
        updateLiveIndicator();
        updateLiveHighlights();
    });

    socket.on('users-update', (data) => {
        Game.connectedUsers = data.count;
        Game.dom.usersCount.textContent = data.count;
    });

    socket.on('rate-limited', () => {
        showToast('Trop rapide !', 'error');
    });

    socket.on('sync-response', (data) => {
        Game.scores = data.scores;
        Game.liveTeams = data.liveTeams || [];
        Game.backgroundLevel = data.backgroundLevel;
        Game.connectedUsers = data.connectedUsers;
        updateUI();
        renderAllBars();
    });

    socket.on('disconnect', () => {
        console.log('❌ Déconnecté');
        showToast('Connexion perdue...', 'error');
    });

    socket.on('reconnect', () => {
        showToast('Reconnecté !', 'success');
        socket.emit('sync-request');
    });
}

// ============================================================
// CHARGEMENT DES DONNÉES
// ============================================================

async function loadGameData() {
    try {
        const response = await fetch('/api/data');
        const data = await response.json();

        Game.teams = data.teams;
        Game.matches = data.matches;
        Game.settings = data.settings || {};
        Game.scores = data.scores;
        Game.liveTeams = data.liveTeams || [];
        Game.backgroundLevel = data.backgroundLevel;
        Game.connectedUsers = data.connectedUsers;
        Game.comboThreshold = data.settings?.comboThreshold || 5;

        console.log(`✅ ${Game.teams.length} équipes chargées`);

        // Générer les barres et gouttes
        createBars();
        createDrops();

        // UI initiale
        updateUI();

        // Cacher l'écran de chargement
        hideLoadingScreen();

    } catch (error) {
        console.error('❌ Erreur chargement:', error);
        showToast('Erreur de connexion', 'error');
    }
}

// ============================================================
// CRÉATION DES ÉLÉMENTS
// ============================================================

/**
 * Crée toutes les barres des équipes
 */
function createBars() {
    const ground = Game.dom.ground;
    ground.innerHTML = '';

    // Trier par nom pour ordre cohérent
    const sortedTeams = [...Game.teams].sort((a, b) =>
        a.name.localeCompare(b.name, 'fr')
    );

    sortedTeams.forEach((team, index) => {
        const bar = document.createElement('div');
        bar.className = 'team-bar';
        bar.id = `bar-${team.id}`;
        bar.dataset.teamId = team.id;
        bar.dataset.index = index;

        // Couleurs du drapeau
        bar.style.setProperty('--color-1', team.colors[0]);
        bar.style.setProperty('--color-2', team.colors[1]);
        bar.style.setProperty('--color-3', team.colors[2]);

        // Hauteur initiale
        const height = calculateBarHeight(Game.scores[team.id] || 0);
        bar.style.height = `${height}px`;

        // Match en direct ?
        if (Game.liveTeams.includes(team.id)) {
            bar.classList.add('live-match');
        }

        // Label (drapeau + score + nom)
        bar.innerHTML = `
            <div class="bar-label">
                <span class="bar-flag">${team.emoji}</span>
                <span class="bar-score">${formatScore(Game.scores[team.id] || 0)}</span>
                <span class="bar-name">${team.shortName}</span>
            </div>
        `;

        // Événement clic
        bar.addEventListener('click', (e) => handleBarClick(team.id, e));
        bar.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleBarClick(team.id, e);
        }, { passive: false });

        ground.appendChild(bar);
    });
}

/**
 * Crée les gouttes (placeholders, visibilité gérée dynamiquement)
 */
function createDrops() {
    const container = Game.dom.dropsContainer;
    container.innerHTML = '';

    // Même ordre que les barres
    const sortedTeams = [...Game.teams].sort((a, b) =>
        a.name.localeCompare(b.name, 'fr')
    );

    sortedTeams.forEach((team, index) => {
        const drop = document.createElement('div');
        drop.className = 'team-drop';
        drop.id = `drop-${team.id}`;
        drop.dataset.teamId = team.id;
        drop.dataset.index = index;

        // Match en direct ?
        if (Game.liveTeams.includes(team.id)) {
            drop.classList.add('live-match');
        }

        drop.innerHTML = `
            <span class="drop-flag">${team.emoji}</span>
            <span class="drop-score">${formatScore(Game.scores[team.id] || 0)}</span>
        `;

        // Clic sur goutte = clic pour le pays
        drop.addEventListener('click', (e) => handleBarClick(team.id, e));
        drop.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleBarClick(team.id, e);
        }, { passive: false });

        container.appendChild(drop);
    });
}

// ============================================================
// GESTION DES CLICS
// ============================================================

/**
 * Gère le clic sur une barre ou une goutte
 */
function handleBarClick(teamId, event) {
    // Enregistrer le clic pour le combo
    const now = Date.now();
    Game.clickHistory.push(now);
    Game.clickHistory = Game.clickHistory.filter(t => now - t < 1000);

    // Vérifier combo
    const clicksPerSec = Game.clickHistory.length;
    const isCombo = clicksPerSec >= Game.comboThreshold;

    if (isCombo && !Game.comboActive) {
        activateCombo();
    }

    // Envoyer au serveur
    socket.emit('click', { teamId });

    // Animation de clic sur la barre
    const bar = document.getElementById(`bar-${teamId}`);
    if (bar) {
        bar.classList.add('clicking');
        setTimeout(() => bar.classList.remove('clicking'), 150);
    }

    // Effet visuel +1
    createClickEffect(event, isCombo);

    // Vibration haptique
    if (navigator.vibrate) {
        navigator.vibrate(isCombo ? [15, 5, 15] : 10);
    }
}

/**
 * Crée l'effet +1 flottant
 */
function createClickEffect(event, isCombo) {
    const effect = document.createElement('div');
    effect.className = 'click-effect' + (isCombo ? ' combo' : '');
    effect.textContent = isCombo ? '+1 🔥' : '+1';

    // Position du clic
    let x, y;
    if (event.touches && event.touches.length > 0) {
        x = event.touches[0].clientX;
        y = event.touches[0].clientY;
    } else {
        x = event.clientX;
        y = event.clientY;
    }

    // Ajouter un peu de randomisation
    x += (Math.random() - 0.5) * 40;

    effect.style.left = `${x}px`;
    effect.style.top = `${y - 10}px`;

    Game.dom.clickEffects.appendChild(effect);

    setTimeout(() => effect.remove(), 700);
}

// ============================================================
// SYSTÈME DE COMBO
// ============================================================

function activateCombo() {
    Game.comboActive = true;
    Game.dom.comboOverlay.classList.remove('hidden');

    setTimeout(() => {
        Game.dom.comboOverlay.classList.add('hidden');
    }, 800);

    // Reset après 1 seconde sans clic
    setTimeout(() => {
        if (Game.clickHistory.length < Game.comboThreshold) {
            Game.comboActive = false;
        }
    }, 1200);
}

// ============================================================
// CALCULS ET RENDU
// ============================================================

/**
 * Calcule la hauteur d'une barre selon le score
 */
function calculateBarHeight(score) {
    const minHeight = 40;
    const scaleFactor = 0.3; // px par point
    const maxHeight = Game.camera.viewportHeight * 0.8;

    return Math.min(maxHeight, minHeight + score * scaleFactor);
}

/**
 * Formate un score pour affichage
 */
function formatScore(score) {
    if (score >= 1000000) return (score / 1000000).toFixed(1) + 'M';
    if (score >= 1000) return (score / 1000).toFixed(1) + 'k';
    return score.toString();
}

/**
 * Met à jour la hauteur d'une barre spécifique
 */
function updateBarHeight(teamId) {
    const bar = document.getElementById(`bar-${teamId}`);
    if (!bar) return;

    const score = Game.scores[teamId] || 0;
    const height = calculateBarHeight(score);
    bar.style.height = `${height}px`;
}

/**
 * Met à jour le score affiché sur une barre
 */
function updateBarScore(teamId) {
    const bar = document.getElementById(`bar-${teamId}`);
    if (!bar) return;

    const scoreEl = bar.querySelector('.bar-score');
    if (scoreEl) {
        scoreEl.textContent = formatScore(Game.scores[teamId] || 0);
    }

    // Mettre à jour aussi la goutte correspondante
    const drop = document.getElementById(`drop-${teamId}`);
    if (drop) {
        const dropScore = drop.querySelector('.drop-score');
        if (dropScore) {
            dropScore.textContent = formatScore(Game.scores[teamId] || 0);
        }
    }
}

/**
 * Met à jour toutes les barres
 */
function renderAllBars() {
    Game.teams.forEach(team => {
        updateBarHeight(team.id);
        updateBarScore(team.id);
    });
}

// ============================================================
// LOGIQUE DE CAMÉRA
// ============================================================

/**
 * Calcule et applique la position de la caméra
 * La caméra suit le leader (pays avec le plus haut score)
 */
function updateCamera() {
    // Trouver le leader
    const ranking = getRanking();
    if (ranking.length === 0) return;

    const leader = ranking[0];
    const leaderHeight = calculateBarHeight(leader.score);

    // Zone visible : on veut que le haut du leader soit visible avec marge
    const margin = 120; // Marge en haut pour le label
    const groundLevel = Game.camera.viewportHeight - 20;

    // Le leader monte = on doit décaler le monde vers le bas
    // pour que le haut du leader reste visible
    const leaderTop = groundLevel - leaderHeight;
    const targetOffset = Math.max(0, margin - leaderTop);

    // Interpolation douce
    Game.camera.targetOffsetY = targetOffset;
    Game.camera.offsetY += (Game.camera.targetOffsetY - Game.camera.offsetY) * 0.1;

    // Appliquer la transformation (translateY positif = descend le monde = caméra monte)
    Game.dom.worldContainer.style.transform = `translateY(${Game.camera.offsetY}px)`;

    // Mettre à jour la visibilité des barres vs gouttes
    updateDropsVisibility();
}

/**
 * Détermine quelles barres sont hors écran et affiche les gouttes correspondantes
 */
function updateDropsVisibility() {
    const viewportBottom = Game.camera.viewportHeight;
    const cameraOffset = Game.camera.offsetY;

    Game.teams.forEach(team => {
        const bar = document.getElementById(`bar-${team.id}`);
        const drop = document.getElementById(`drop-${team.id}`);
        if (!bar || !drop) return;

        const score = Game.scores[team.id] || 0;
        const barHeight = calculateBarHeight(score);

        // Position du haut de la barre dans l'espace écran
        // Le sol est à viewportBottom - 20 - cameraOffset
        const groundY = viewportBottom - 20;
        const barTopY = groundY - barHeight + cameraOffset;

        // Seuil : si le haut de la barre est en dessous du viewport (invisible)
        // On considère visible si au moins 20px de la barre sont visibles
        const visiblePart = viewportBottom - (groundY + cameraOffset - barHeight);
        const isVisible = barTopY < viewportBottom - 60; // 60px = zone gouttes

        if (isVisible) {
            // La barre est visible, cacher la goutte
            drop.classList.remove('visible');
        } else {
            // La barre est hors écran, montrer la goutte
            drop.classList.add('visible');
        }
    });
}

/**
 * Retourne le classement trié par score
 */
function getRanking() {
    return Object.entries(Game.scores)
        .map(([teamId, score]) => ({ teamId, score }))
        .sort((a, b) => b.score - a.score);
}

// ============================================================
// MISE À JOUR DE L'UI
// ============================================================

function updateUI() {
    updateBackground();
    updateLiveIndicator();
    updateLeaderDisplay();
    Game.dom.usersCount.textContent = Game.connectedUsers;
}

function updateBackground() {
    document.body.dataset.background = Game.backgroundLevel;
}

function updateLiveIndicator() {
    const indicator = Game.dom.liveIndicator;
    const text = Game.dom.liveMatchText;

    if (Game.liveTeams.length > 0) {
        indicator.classList.add('active');
        const emojis = Game.liveTeams
            .map(id => Game.teams.find(t => t.id === id)?.emoji)
            .filter(Boolean)
            .join(' vs ');
        text.textContent = `LIVE: ${emojis}`;
    } else {
        indicator.classList.remove('active');
        text.textContent = 'Aucun match en direct';
    }
}

function updateLiveHighlights() {
    // Barres
    document.querySelectorAll('.team-bar').forEach(bar => {
        const teamId = bar.dataset.teamId;
        bar.classList.toggle('live-match', Game.liveTeams.includes(teamId));
    });

    // Gouttes
    document.querySelectorAll('.team-drop').forEach(drop => {
        const teamId = drop.dataset.teamId;
        drop.classList.toggle('live-match', Game.liveTeams.includes(teamId));
    });
}

function updateLeaderDisplay() {
    const ranking = getRanking();
    if (ranking.length === 0) return;

    const leader = ranking[0];
    const team = Game.teams.find(t => t.id === leader.teamId);

    if (team) {
        Game.dom.leaderName.textContent = `${team.emoji} ${team.shortName}`;
        Game.dom.leaderScore.textContent = formatScore(leader.score);
    }
}

// ============================================================
// ÉCRAN DE CHARGEMENT
// ============================================================

function hideLoadingScreen() {
    Game.dom.loadingScreen.classList.add('fade-out');
    setTimeout(() => {
        Game.dom.loadingScreen.classList.add('hidden');
    }, 500);
}

// ============================================================
// NOTIFICATIONS
// ============================================================

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    Game.dom.toastContainer.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}

// ============================================================
// ÉVÉNEMENTS
// ============================================================

function setupEvents() {
    // Redimensionnement
    window.addEventListener('resize', () => {
        updateViewportDimensions();
    });

    // Synchronisation scroll horizontal gouttes avec world
    Game.dom.worldViewport.addEventListener('scroll', () => {
        // Synchroniser la position X des gouttes avec le scroll du monde
        const scrollX = Game.dom.worldViewport.scrollLeft;
        Game.dom.dropsContainer.style.transform = `translateX(-${scrollX}px)`;
    });

    // Visibilité onglet
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            socket.emit('sync-request');
        }
    });

    // Empêcher le zoom sur double-tap mobile
    document.addEventListener('touchend', (e) => {
        if (e.target.closest('.team-bar') || e.target.closest('.team-drop')) {
            e.preventDefault();
        }
    }, { passive: false });
}

// ============================================================
// BOUCLE DE JEU
// ============================================================

let lastFrame = 0;

function gameLoop(timestamp) {
    const delta = timestamp - lastFrame;
    lastFrame = timestamp;

    // Mise à jour caméra
    updateCamera();

    // Désactiver combo si plus de clics
    if (Game.comboActive && Game.clickHistory.length < Game.comboThreshold) {
        Game.comboActive = false;
    }

    requestAnimationFrame(gameLoop);
}

// ============================================================
// DEBUG (optionnel)
// ============================================================

window.CANClicker = {
    game: Game,
    getRanking,
    socket: () => socket
};

console.log('🎮 CAN Clicker v2 chargé - window.CANClicker disponible');
