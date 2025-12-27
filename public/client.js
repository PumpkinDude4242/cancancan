/**
 * CAN Clicker Game - Client JavaScript
 * Gestion temps réel, logique de caméra, gamification
 *
 * Vanilla JS - Performance optimisée
 */

// ============================================================
// CONFIGURATION ET ÉTAT GLOBAL
// ============================================================

const GameState = {
    // Données du serveur
    teams: [],
    matches: [],
    settings: {},
    scores: {},
    liveTeams: [],

    // État local
    selectedTeam: null,
    connectedUsers: 0,
    backgroundLevel: 'stadium',

    // Système de stamina
    stamina: 100,
    maxStamina: 100,
    isExhausted: false,
    staminaCooldownEnd: 0,

    // Système de combo
    clickTimestamps: [],
    comboActive: false,
    comboThreshold: 5, // clics par seconde pour activer

    // Caméra
    cameraOffset: 0,
    viewportHeight: 0,
    dropThreshold: 0.3, // % du viewport en dessous duquel on devient une goutte

    // Cache des éléments DOM
    elements: {}
};

// Connexion Socket.io
let socket = null;

// ============================================================
// INITIALISATION
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('🏆 CAN Clicker - Initialisation...');

    // Cache des éléments DOM fréquemment utilisés
    cacheElements();

    // Initialisation Socket.io
    initSocket();

    // Chargement des données initiales via API
    loadInitialData();

    // Event listeners
    setupEventListeners();

    // Boucle de mise à jour
    requestAnimationFrame(gameLoop);
});

/**
 * Met en cache les éléments DOM pour éviter les queries répétées
 */
function cacheElements() {
    GameState.elements = {
        loadingScreen: document.getElementById('loading-screen'),
        barsContainer: document.getElementById('bars-container'),
        dropsContainer: document.getElementById('drops-container'),
        teamSelector: document.getElementById('team-selector'),
        teamsGrid: document.getElementById('teams-grid'),
        clickZone: document.getElementById('click-zone'),
        clickButton: document.getElementById('click-button'),
        clickFlag: document.getElementById('click-flag'),
        clickTeamName: document.getElementById('click-team-name'),
        clickScore: document.getElementById('click-score'),
        changeTeamBtn: document.getElementById('change-team-btn'),
        staminaFill: document.getElementById('stamina-fill'),
        staminaText: document.getElementById('stamina-text'),
        staminaWarning: document.getElementById('stamina-warning'),
        clickEffects: document.getElementById('click-effects-container'),
        rankingPanel: document.getElementById('ranking-panel'),
        rankingList: document.getElementById('ranking-list'),
        rankingToggle: document.getElementById('ranking-toggle'),
        closeRanking: document.getElementById('close-ranking'),
        liveIndicator: document.getElementById('live-indicator'),
        liveMatchText: document.getElementById('live-match-text'),
        usersCount: document.getElementById('users-count'),
        toastContainer: document.getElementById('toast-container'),
        comboOverlay: document.getElementById('combo-overlay')
    };
}

// ============================================================
// SOCKET.IO - COMMUNICATION TEMPS RÉEL
// ============================================================

function initSocket() {
    socket = io({
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000
    });

    // Connexion établie
    socket.on('connect', () => {
        console.log('🔌 Connecté au serveur');
        showToast('Connecté !', 'success');
    });

    // État initial reçu
    socket.on('init', (data) => {
        console.log('📦 Données initiales reçues');
        GameState.scores = data.scores;
        GameState.liveTeams = data.liveTeams;
        GameState.backgroundLevel = data.backgroundLevel;
        GameState.connectedUsers = data.connectedUsers;

        updateBackground();
        updateUsersCount();
        updateLiveIndicator();
        renderBars();
    });

    // Mise à jour d'un score individuel
    socket.on('score-update', (data) => {
        GameState.scores[data.teamId] = data.score;

        // Mettre à jour le background si nécessaire
        if (data.backgroundLevel !== GameState.backgroundLevel) {
            GameState.backgroundLevel = data.backgroundLevel;
            updateBackground();
        }

        // Mettre à jour la barre concernée
        updateBar(data.teamId);

        // Mettre à jour le score affiché si c'est notre équipe
        if (data.teamId === GameState.selectedTeam) {
            updateSelectedTeamScore();
        }
    });

    // Mise à jour du classement complet
    socket.on('ranking-update', (data) => {
        if (data.backgroundLevel !== GameState.backgroundLevel) {
            GameState.backgroundLevel = data.backgroundLevel;
            updateBackground();
        }
        updateRankingPanel(data.ranking);
        updateCamera();
    });

    // Mise à jour des matchs en direct
    socket.on('live-update', (data) => {
        GameState.liveTeams = data.liveTeams;
        updateLiveIndicator();
        updateLiveMatchHighlights();
    });

    // Mise à jour du nombre d'utilisateurs
    socket.on('users-update', (data) => {
        GameState.connectedUsers = data.count;
        updateUsersCount();
    });

    // Limite de débit atteinte
    socket.on('rate-limited', (data) => {
        showToast(data.message, 'error');
    });

    // Réponse de synchronisation
    socket.on('sync-response', (data) => {
        GameState.scores = data.scores;
        GameState.liveTeams = data.liveTeams;
        GameState.backgroundLevel = data.backgroundLevel;
        GameState.connectedUsers = data.connectedUsers;

        updateBackground();
        updateUsersCount();
        renderBars();
    });

    // Déconnexion
    socket.on('disconnect', () => {
        console.log('❌ Déconnecté du serveur');
        showToast('Connexion perdue...', 'error');
    });

    // Reconnexion
    socket.on('reconnect', () => {
        console.log('🔄 Reconnecté !');
        showToast('Reconnecté !', 'success');
        socket.emit('sync-request');
    });

    // Fermeture serveur
    socket.on('server-shutdown', (data) => {
        showToast(data.message, 'error');
    });
}

// ============================================================
// CHARGEMENT DES DONNÉES
// ============================================================

async function loadInitialData() {
    try {
        const response = await fetch('/api/data');
        const data = await response.json();

        GameState.teams = data.teams;
        GameState.matches = data.matches;
        GameState.settings = data.settings;
        GameState.scores = data.scores;
        GameState.liveTeams = data.liveTeams;
        GameState.backgroundLevel = data.backgroundLevel;
        GameState.connectedUsers = data.connectedUsers;

        // Appliquer les paramètres
        if (data.settings) {
            GameState.comboThreshold = data.settings.comboThreshold || 5;
        }

        console.log(`✅ ${GameState.teams.length} équipes chargées`);

        // Générer les UI
        renderTeamSelector();
        renderBars();
        updateBackground();
        updateUsersCount();
        updateLiveIndicator();

        // Masquer l'écran de chargement
        hideLoadingScreen();

        // Afficher le sélecteur d'équipe
        showTeamSelector();

    } catch (error) {
        console.error('❌ Erreur de chargement:', error);
        showToast('Erreur de chargement des données', 'error');
    }
}

// ============================================================
// GESTION DES ASSETS (FLAGS, SONS)
// ============================================================

/**
 * Récupère le drapeau d'une équipe (image ou emoji fallback)
 * @param {string} teamId - ID de l'équipe
 * @returns {string} HTML du drapeau
 */
function getFlag(teamId) {
    const team = GameState.teams.find(t => t.id === teamId);
    if (!team) return '🏳️';

    // Essayer de charger l'image, sinon emoji
    const imgSrc = team.flagUrl;
    const emoji = team.emoji || '🏳️';

    // Pour l'instant, utiliser l'emoji (les images seront ajoutées plus tard)
    // En production, vérifier si l'image existe avec un Image() préload
    return `<span class="flag-emoji">${emoji}</span>`;
}

/**
 * Récupère l'objet équipe par ID
 */
function getTeam(teamId) {
    return GameState.teams.find(t => t.id === teamId);
}

// ============================================================
// RENDU DES ÉQUIPES
// ============================================================

/**
 * Affiche la grille de sélection d'équipe
 */
function renderTeamSelector() {
    const grid = GameState.elements.teamsGrid;
    grid.innerHTML = '';

    // Trier les équipes par nom
    const sortedTeams = [...GameState.teams].sort((a, b) =>
        a.name.localeCompare(b.name, 'fr')
    );

    sortedTeams.forEach(team => {
        const card = document.createElement('div');
        card.className = 'team-select-card';
        card.dataset.teamId = team.id;

        // Marquer si match en direct
        if (GameState.liveTeams.includes(team.id)) {
            card.classList.add('live-match');
        }

        card.innerHTML = `
            <div class="flag">${getFlag(team.id)}</div>
            <div class="name">${team.shortName}</div>
            <div class="score">${GameState.scores[team.id] || 0}</div>
        `;

        card.addEventListener('click', () => selectTeam(team.id));
        grid.appendChild(card);
    });
}

/**
 * Affiche les barres des équipes
 */
function renderBars() {
    const container = GameState.elements.barsContainer;
    container.innerHTML = '';

    // Trier par score décroissant
    const ranking = getRanking();

    ranking.forEach((entry, index) => {
        const team = getTeam(entry.teamId);
        if (!team) return;

        const bar = document.createElement('div');
        bar.className = 'team-bar';
        bar.id = `bar-${team.id}`;
        bar.dataset.teamId = team.id;

        // Appliquer les couleurs du drapeau
        bar.style.setProperty('--color-1', team.colors[0]);
        bar.style.setProperty('--color-2', team.colors[1]);
        bar.style.setProperty('--color-3', team.colors[2]);

        // Calculer la hauteur (min 30px, max basé sur le score)
        const height = calculateBarHeight(entry.score);
        bar.style.height = `${height}px`;

        // Marquer si match en direct
        if (GameState.liveTeams.includes(team.id)) {
            bar.classList.add('live-match');
        }

        bar.innerHTML = `
            <div class="bar-label">
                <span class="bar-flag">${getFlag(team.id)}</span>
                <span class="bar-score">${formatScore(entry.score)}</span>
                <span class="bar-name">${team.shortName}</span>
            </div>
        `;

        // Clic sur la barre = sélectionner cette équipe
        bar.addEventListener('click', () => selectTeam(team.id));

        container.appendChild(bar);
    });

    // Mettre à jour la caméra
    updateCamera();
}

/**
 * Met à jour une barre spécifique
 */
function updateBar(teamId) {
    const bar = document.getElementById(`bar-${teamId}`);
    if (!bar) return;

    const score = GameState.scores[teamId] || 0;
    const height = calculateBarHeight(score);

    bar.style.height = `${height}px`;

    const scoreEl = bar.querySelector('.bar-score');
    if (scoreEl) {
        scoreEl.textContent = formatScore(score);
    }
}

/**
 * Calcule la hauteur d'une barre selon le score
 */
function calculateBarHeight(score) {
    const minHeight = 30;
    const maxHeight = window.innerHeight * 0.6; // 60% de l'écran max
    const scaleFactor = 0.5; // Pixels par point de score

    return Math.min(maxHeight, minHeight + score * scaleFactor);
}

/**
 * Formate un score pour l'affichage (ex: 1.2k, 15.3M)
 */
function formatScore(score) {
    if (score >= 1000000) {
        return (score / 1000000).toFixed(1) + 'M';
    }
    if (score >= 1000) {
        return (score / 1000).toFixed(1) + 'k';
    }
    return score.toString();
}

/**
 * Retourne le classement trié
 */
function getRanking() {
    return Object.entries(GameState.scores)
        .map(([teamId, score]) => ({ teamId, score }))
        .sort((a, b) => b.score - a.score);
}

// ============================================================
// LOGIQUE DE CAMÉRA
// ============================================================

/**
 * Met à jour la position de la caméra pour suivre le leader
 */
function updateCamera() {
    const ranking = getRanking();
    if (ranking.length === 0) return;

    const leader = ranking[0];
    const leaderHeight = calculateBarHeight(leader.score);
    const viewportHeight = GameState.elements.barsContainer.parentElement.offsetHeight;

    // Calculer l'offset pour que le leader soit visible
    // avec une marge en haut
    const margin = 150; // pixels de marge au-dessus du leader
    const targetOffset = Math.max(0, leaderHeight - viewportHeight + margin);

    // Interpolation douce
    GameState.cameraOffset += (targetOffset - GameState.cameraOffset) * 0.1;

    // Appliquer la transformation
    GameState.elements.barsContainer.style.transform =
        `translateY(${GameState.cameraOffset}px)`;

    // Mettre à jour les gouttes (équipes hors viewport)
    updateDrops(ranking, viewportHeight);
}

/**
 * Met à jour les "gouttes" pour les équipes à la traîne
 */
function updateDrops(ranking, viewportHeight) {
    const container = GameState.elements.dropsContainer;
    container.innerHTML = '';

    const threshold = viewportHeight * GameState.dropThreshold;

    ranking.forEach((entry, index) => {
        const barHeight = calculateBarHeight(entry.score);
        const visibleHeight = barHeight - GameState.cameraOffset;

        // Si la barre est trop basse (hors viewport significativement)
        if (visibleHeight < threshold && index > 2) { // Garder le top 3 visible
            const team = getTeam(entry.teamId);
            if (!team) return;

            // Masquer la barre
            const bar = document.getElementById(`bar-${entry.teamId}`);
            if (bar) {
                bar.classList.add('hidden-bar');
            }

            // Créer la goutte
            const drop = document.createElement('div');
            drop.className = 'team-drop';
            drop.dataset.teamId = entry.teamId;
            drop.dataset.score = formatScore(entry.score);

            if (GameState.liveTeams.includes(entry.teamId)) {
                drop.classList.add('live-match');
            }

            drop.innerHTML = getFlag(entry.teamId);

            drop.addEventListener('click', () => selectTeam(entry.teamId));
            container.appendChild(drop);
        } else {
            // S'assurer que la barre est visible
            const bar = document.getElementById(`bar-${entry.teamId}`);
            if (bar) {
                bar.classList.remove('hidden-bar');
            }
        }
    });
}

// ============================================================
// SÉLECTION D'ÉQUIPE
// ============================================================

function selectTeam(teamId) {
    const team = getTeam(teamId);
    if (!team) return;

    GameState.selectedTeam = teamId;

    // Mettre à jour l'UI du bouton de clic
    GameState.elements.clickFlag.innerHTML = getFlag(teamId);
    GameState.elements.clickTeamName.textContent = team.name;
    updateSelectedTeamScore();

    // Activer le bouton
    GameState.elements.clickButton.disabled = false;

    // Masquer le sélecteur, afficher la zone de clic
    hideTeamSelector();
    showClickZone();

    showToast(`${team.emoji} ${team.name} sélectionné !`, 'success');
}

function updateSelectedTeamScore() {
    if (!GameState.selectedTeam) return;
    const score = GameState.scores[GameState.selectedTeam] || 0;
    GameState.elements.clickScore.textContent = formatScore(score);
}

// ============================================================
// SYSTÈME DE CLIC
// ============================================================

function handleClick(event) {
    // Empêcher le comportement par défaut
    event.preventDefault();

    // Vérifier si on est épuisé
    if (GameState.isExhausted) {
        showToast('Récupération en cours...', 'error');
        return;
    }

    // Vérifier la stamina
    if (GameState.stamina <= 0) {
        triggerExhaustion();
        return;
    }

    // Vérifier qu'une équipe est sélectionnée
    if (!GameState.selectedTeam) {
        showToast('Sélectionnez une équipe !', 'error');
        return;
    }

    // Consommer de la stamina
    GameState.stamina = Math.max(0, GameState.stamina - 2);
    updateStaminaBar();

    // Enregistrer le timestamp pour le combo
    const now = Date.now();
    GameState.clickTimestamps.push(now);

    // Garder seulement les clics de la dernière seconde
    GameState.clickTimestamps = GameState.clickTimestamps.filter(
        t => now - t < 1000
    );

    // Vérifier le combo
    const clicksPerSecond = GameState.clickTimestamps.length;
    const isCombo = clicksPerSecond >= GameState.comboThreshold;

    if (isCombo && !GameState.comboActive) {
        activateComboMode();
    } else if (!isCombo && GameState.comboActive) {
        deactivateComboMode();
    }

    // Envoyer le clic au serveur
    socket.emit('click', { teamId: GameState.selectedTeam });

    // Afficher l'effet visuel
    createClickEffect(event, isCombo);

    // Feedback haptique (si supporté)
    if (navigator.vibrate) {
        navigator.vibrate(isCombo ? [20, 10, 20] : 10);
    }
}

/**
 * Crée l'effet visuel "+1" flottant
 */
function createClickEffect(event, isCombo) {
    const effect = document.createElement('div');
    effect.className = 'click-effect' + (isCombo ? ' combo' : '');
    effect.textContent = isCombo ? '+1 🔥' : '+1';

    // Position basée sur le clic
    const rect = GameState.elements.clickButton.getBoundingClientRect();
    effect.style.left = `${rect.left + rect.width / 2 + (Math.random() - 0.5) * 60}px`;
    effect.style.top = `${rect.top - 20}px`;

    GameState.elements.clickEffects.appendChild(effect);

    // Supprimer après l'animation
    setTimeout(() => effect.remove(), 800);
}

// ============================================================
// SYSTÈME DE COMBO
// ============================================================

function activateComboMode() {
    GameState.comboActive = true;
    GameState.elements.clickButton.classList.add('combo-active');
    GameState.elements.comboOverlay.classList.remove('hidden');

    // Masquer après 1 seconde
    setTimeout(() => {
        GameState.elements.comboOverlay.classList.add('hidden');
    }, 1000);
}

function deactivateComboMode() {
    GameState.comboActive = false;
    GameState.elements.clickButton.classList.remove('combo-active');
}

// ============================================================
// SYSTÈME DE STAMINA
// ============================================================

function updateStaminaBar() {
    const percentage = (GameState.stamina / GameState.maxStamina) * 100;

    GameState.elements.staminaFill.style.width = `${percentage}%`;
    GameState.elements.staminaText.textContent = `${Math.round(percentage)}%`;

    // Classes visuelles
    GameState.elements.staminaFill.classList.remove('low', 'empty');
    if (percentage <= 0) {
        GameState.elements.staminaFill.classList.add('empty');
    } else if (percentage <= 30) {
        GameState.elements.staminaFill.classList.add('low');
    }
}

function triggerExhaustion() {
    GameState.isExhausted = true;
    GameState.staminaCooldownEnd = Date.now() + (GameState.settings.staminaCooldown || 3000);

    GameState.elements.staminaWarning.classList.remove('hidden');
    GameState.elements.clickButton.disabled = true;

    showToast('Épuisé ! Pause de 3 secondes...', 'error');
}

function recoverStamina() {
    const now = Date.now();

    // Si épuisé, vérifier si le cooldown est terminé
    if (GameState.isExhausted) {
        if (now >= GameState.staminaCooldownEnd) {
            GameState.isExhausted = false;
            GameState.stamina = GameState.maxStamina;
            GameState.elements.staminaWarning.classList.add('hidden');
            GameState.elements.clickButton.disabled = false;
            showToast('Énergie restaurée !', 'success');
        }
        return;
    }

    // Régénération normale
    const regenRate = GameState.settings.staminaRegenRate || 2;
    if (GameState.stamina < GameState.maxStamina) {
        GameState.stamina = Math.min(
            GameState.maxStamina,
            GameState.stamina + regenRate * 0.016 // ~60 FPS
        );
        updateStaminaBar();
    }
}

// ============================================================
// BOUCLE DE JEU
// ============================================================

let lastFrameTime = 0;

function gameLoop(timestamp) {
    const deltaTime = timestamp - lastFrameTime;
    lastFrameTime = timestamp;

    // Régénération de stamina
    recoverStamina();

    // Mise à jour de la caméra (interpolation)
    updateCamera();

    // Continuer la boucle
    requestAnimationFrame(gameLoop);
}

// ============================================================
// MISE À JOUR DE L'UI
// ============================================================

function updateBackground() {
    document.body.dataset.background = GameState.backgroundLevel;
}

function updateUsersCount() {
    GameState.elements.usersCount.textContent = GameState.connectedUsers;
}

function updateLiveIndicator() {
    const indicator = GameState.elements.liveIndicator;
    const textEl = GameState.elements.liveMatchText;

    if (GameState.liveTeams.length > 0) {
        indicator.classList.add('active');

        // Afficher les équipes en match
        const teams = GameState.liveTeams
            .map(id => getTeam(id))
            .filter(t => t)
            .map(t => t.emoji)
            .join(' vs ');

        textEl.textContent = `LIVE: ${teams}`;
    } else {
        indicator.classList.remove('active');
        textEl.textContent = 'Aucun match en direct';
    }
}

function updateLiveMatchHighlights() {
    // Mettre à jour les classes sur les barres
    document.querySelectorAll('.team-bar').forEach(bar => {
        const teamId = bar.dataset.teamId;
        if (GameState.liveTeams.includes(teamId)) {
            bar.classList.add('live-match');
        } else {
            bar.classList.remove('live-match');
        }
    });

    // Mettre à jour les cartes de sélection
    document.querySelectorAll('.team-select-card').forEach(card => {
        const teamId = card.dataset.teamId;
        if (GameState.liveTeams.includes(teamId)) {
            card.classList.add('live-match');
        } else {
            card.classList.remove('live-match');
        }
    });
}

function updateRankingPanel(ranking) {
    const list = GameState.elements.rankingList;
    list.innerHTML = '';

    ranking.forEach((entry, index) => {
        const team = getTeam(entry.teamId);
        if (!team) return;

        const item = document.createElement('div');
        item.className = 'ranking-item';

        if (index < 3) item.classList.add('top-3');
        if (GameState.liveTeams.includes(entry.teamId)) {
            item.classList.add('live-match');
        }

        item.innerHTML = `
            <span class="ranking-position">${index + 1}</span>
            <span class="ranking-flag">${getFlag(entry.teamId)}</span>
            <div class="ranking-info">
                <span class="ranking-name">${team.name}</span>
            </div>
            <span class="ranking-score">${formatScore(entry.score)}</span>
        `;

        list.appendChild(item);
    });
}

// ============================================================
// GESTION DE L'AFFICHAGE
// ============================================================

function hideLoadingScreen() {
    const screen = GameState.elements.loadingScreen;
    screen.classList.add('fade-out');
    setTimeout(() => {
        screen.classList.add('hidden');
    }, 500);
}

function showTeamSelector() {
    GameState.elements.teamSelector.classList.remove('hidden');
}

function hideTeamSelector() {
    GameState.elements.teamSelector.classList.add('hidden');
}

function showClickZone() {
    GameState.elements.clickZone.classList.remove('hidden');
}

function hideClickZone() {
    GameState.elements.clickZone.classList.add('hidden');
}

function toggleRankingPanel() {
    GameState.elements.rankingPanel.classList.toggle('hidden');
}

// ============================================================
// NOTIFICATIONS TOAST
// ============================================================

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    GameState.elements.toastContainer.appendChild(toast);

    // Supprimer après 3 secondes
    setTimeout(() => toast.remove(), 3000);
}

// ============================================================
// EVENT LISTENERS
// ============================================================

function setupEventListeners() {
    // Bouton de clic principal
    GameState.elements.clickButton.addEventListener('click', handleClick);
    GameState.elements.clickButton.addEventListener('touchstart', handleClick, { passive: false });

    // Empêcher le double-tap zoom sur mobile
    GameState.elements.clickButton.addEventListener('touchend', (e) => {
        e.preventDefault();
    });

    // Changer d'équipe
    GameState.elements.changeTeamBtn.addEventListener('click', () => {
        hideClickZone();
        renderTeamSelector(); // Rafraîchir les scores
        showTeamSelector();
    });

    // Toggle classement
    GameState.elements.rankingToggle.addEventListener('click', toggleRankingPanel);
    GameState.elements.closeRanking.addEventListener('click', toggleRankingPanel);

    // Fermer le classement en cliquant ailleurs
    document.addEventListener('click', (e) => {
        const panel = GameState.elements.rankingPanel;
        const toggle = GameState.elements.rankingToggle;

        if (!panel.classList.contains('hidden') &&
            !panel.contains(e.target) &&
            !toggle.contains(e.target)) {
            panel.classList.add('hidden');
        }
    });

    // Raccourcis clavier
    document.addEventListener('keydown', (e) => {
        // Espace ou Entrée pour cliquer
        if ((e.code === 'Space' || e.code === 'Enter') &&
            !GameState.elements.teamSelector.classList.contains('hidden') === false) {
            e.preventDefault();
            handleClick(e);
        }

        // Échap pour fermer les panneaux
        if (e.code === 'Escape') {
            if (!GameState.elements.rankingPanel.classList.contains('hidden')) {
                GameState.elements.rankingPanel.classList.add('hidden');
            }
        }

        // R pour ouvrir le classement
        if (e.code === 'KeyR') {
            toggleRankingPanel();
        }
    });

    // Gestion de la visibilité de l'onglet
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            // Re-synchroniser quand on revient
            socket.emit('sync-request');
        }
    });

    // Redimensionnement
    window.addEventListener('resize', () => {
        GameState.viewportHeight = window.innerHeight;
        updateCamera();
    });

    // Initialiser la hauteur du viewport
    GameState.viewportHeight = window.innerHeight;
}

// ============================================================
// UTILITAIRES
// ============================================================

/**
 * Debounce une fonction
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle une fonction
 */
function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ============================================================
// EXPORT POUR DEBUG (optionnel)
// ============================================================

window.CANClicker = {
    state: GameState,
    socket: () => socket,
    selectTeam,
    getTeam,
    getRanking
};

console.log('🎮 CAN Clicker chargé - window.CANClicker disponible pour debug');
