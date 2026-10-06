/**
 * IIIT Spicy Tea - Main Application Logic
 *
 * Privacy-first data model:
 * - Posts and replies store NO user identifiers (no UIDs, no emails, no handles).
 * - Vote/like state lives ONLY in this browser's localStorage, so the database
 *   can never reveal who reacted to what.
 */

import { auth, db } from './firebase-config.js';
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    collection,
    addDoc,
    onSnapshot,
    query,
    orderBy,
    serverTimestamp,
    doc,
    updateDoc,
    increment
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let currentUser = null;
let currentSort = 'hot';        // 'hot', 'new', 'top'
let currentCategory = 'all';    // 'all', 'academics', 'campus', 'confessions'
let feedUnsubscribe = null;
let replyUnsubscribers = {};
const openReplies = new Set();
const repliesCache = {};        // postId -> last rendered replies HTML (survives feed re-renders)

/* ------------------------------------------------------------------ */
/* On-device reaction state (never sent to the server)                 */
/* ------------------------------------------------------------------ */
const LS_KEYS = {
    votes: 'spicytea_votes',             // postId  -> 'up' | 'down'
    likes: 'spicytea_likes',             // postId  -> true
    replyLikes: 'spicytea_reply_likes'   // replyId -> true
};

function loadState(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}
function saveState(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full/blocked */ }
}

const votes = loadState(LS_KEYS.votes);
const likedPosts = loadState(LS_KEYS.likes);
const likedReplies = loadState(LS_KEYS.replyLikes);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

// XSS Sanitizer — applied to all user text before it is stored.
function sanitize(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function (m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m];
    });
}

// Relative timestamp, e.g. "5m ago"
function timeAgo(ts) {
    if (!ts || typeof ts.toDate !== 'function') return 'just now';
    const seconds = Math.floor((Date.now() - ts.toDate().getTime()) / 1000);
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return ts.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

const CATEGORY_STYLES = {
    academics: 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20',
    campus: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20',
    confessions: 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
};
const DEFAULT_CATEGORY_STYLE = 'bg-slate-800 text-slate-300 border border-slate-700';

function showConnectionError() {
    const container = document.getElementById('postsContainer');
    if (!container) return;
    container.innerHTML = `
        <div class="text-center py-12 glass-card rounded-2xl p-8 space-y-4">
            <i data-lucide="wifi-off" class="w-8 h-8 mx-auto text-rose-400"></i>
            <p class="text-sm text-slate-300 font-medium">Couldn't reach the relay node.</p>
            <p class="text-xs text-slate-500 leading-relaxed">Check your connection and try again.<br>Your identity was never exposed.</p>
            <button onclick="window.location.reload()" class="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-colors inline-flex items-center gap-2 cursor-pointer">
                <i data-lucide="rotate-cw" class="w-3.5 h-3.5"></i> Retry
            </button>
        </div>`;
    if (window.lucide) window.lucide.createIcons();
}

/* ------------------------------------------------------------------ */
/* 1. Anonymous Authentication                                         */
/* ------------------------------------------------------------------ */
let authResolved = false;
// If the relay can't be reached (offline, blocked network), don't leave
// the user staring at a spinner forever — show a retryable error state.
const authTimeout = setTimeout(() => {
    if (!authResolved) showConnectionError();
}, 12000);

onAuthStateChanged(auth, (user) => {
    if (user) {
        authResolved = true;
        clearTimeout(authTimeout);
        currentUser = user;
        initFeed();
    } else {
        signInAnonymously(auth).catch(() => {
            if (!authResolved) showConnectionError();
        });
    }
});

/* ------------------------------------------------------------------ */
/* 2. Post Submission                                                  */
/* ------------------------------------------------------------------ */
const postForm = document.getElementById('createPostForm');
if (postForm) {
    postForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const titleInput = document.getElementById('postTitle');
        const contentInput = document.getElementById('postContent');
        const categorySelect = document.getElementById('postCategory');
        const submitBtn = document.getElementById('submitPostBtn');

        const title = titleInput.value.trim();
        const content = contentInput.value.trim();
        const category = categorySelect ? categorySelect.value : 'academics';

        if (!title || !content || !currentUser) return;

        if (submitBtn) submitBtn.disabled = true;
        try {
            // NOTE: no user identifiers are stored — pure anonymous content.
            const docRef = await addDoc(collection(db, "posts"), {
                title: sanitize(title),
                content: sanitize(content),
                category: category,
                timestamp: serverTimestamp(),
                upvotes: 1,
                downvotes: 0,
                score: 1,
                likes: 1,
                commentsCount: 0
            });

            // Author's own reactions are remembered on-device only.
            votes[docRef.id] = 'up';
            saveState(LS_KEYS.votes, votes);
            likedPosts[docRef.id] = true;
            saveState(LS_KEYS.likes, likedPosts);

            titleInput.value = '';
            contentInput.value = '';
        } catch (err) {
            // Write rejected (offline or rules) — keep the draft so nothing is lost.
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    });
}

/* ------------------------------------------------------------------ */
/* 3. Real-time Feed Listener (single subscription, properly cleaned)  */
/* ------------------------------------------------------------------ */
function initFeed() {
    if (!currentUser) return;

    // Avoid stacking duplicate listeners when sort/category changes.
    if (feedUnsubscribe) {
        feedUnsubscribe();
        feedUnsubscribe = null;
    }

    const q = query(collection(db, "posts"), orderBy("timestamp", "desc"));

    feedUnsubscribe = onSnapshot(q, (snapshot) => {
        let posts = [];
        snapshot.forEach((docSnap) => {
            posts.push({ id: docSnap.id, ...docSnap.data() });
        });

        // Filter by category
        if (currentCategory !== 'all') {
            posts = posts.filter(p => (p.category || 'academics') === currentCategory);
        }

        // Client-side sorting options ('new' keeps the query's timestamp order)
        if (currentSort === 'top') {
            posts.sort((a, b) => (b.score || 0) - (a.score || 0));
        } else if (currentSort === 'hot') {
            posts.sort((a, b) => {
                const scoreA = (a.score || 0) + (a.likes || 0) * 1.5;
                const scoreB = (b.score || 0) + (b.likes || 0) * 1.5;
                return scoreB - scoreA;
            });
        }

        renderPosts(posts);
    }, () => showConnectionError());
}

/* ------------------------------------------------------------------ */
/* 4. Rendering                                                        */
/* ------------------------------------------------------------------ */
function renderPosts(posts) {
    const container = document.getElementById('postsContainer');
    if (!container) return;

    // Preserve in-progress reply drafts across re-renders
    const drafts = {};
    container.querySelectorAll('[id^="replyInput-"]').forEach(el => {
        if (el.value) drafts[el.id] = el.value;
    });

    if (posts.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 text-slate-500 glass-card rounded-2xl p-8">
                <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-3 text-slate-600"></i>
                <p class="text-sm font-medium">No tea spilled yet in this category. Be the first to share news!</p>
            </div>`;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    container.innerHTML = posts.map(post => {
        const myVote = votes[post.id] || null;
        const isUpvoted = myVote === 'up';
        const isDownvoted = myVote === 'down';
        const isLiked = !!likedPosts[post.id];
        const categoryName = post.category || 'academics';
        const badgeStyle = CATEGORY_STYLES[categoryName] || DEFAULT_CATEGORY_STYLE;

        return `
            <article class="glass-card glass-card-hover rounded-2xl p-5 border border-slate-800 bg-slate-900/40">
                <div class="flex items-start justify-between gap-4 mb-2">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="px-2 py-0.5 text-[10px] font-semibold rounded-full uppercase tracking-wider ${badgeStyle}">
                            ${capitalize(categoryName)}
                        </span>
                        <h3 class="text-base font-semibold text-white tracking-tight">${post.title}</h3>
                    </div>
                    <span class="text-[11px] font-mono text-slate-500 whitespace-nowrap">Anonymous • ${timeAgo(post.timestamp)}</span>
                </div>

                <p class="text-sm text-slate-300 leading-relaxed mb-4 whitespace-pre-line">${post.content}</p>

                <!-- Action Bar -->
                <div class="flex items-center justify-between pt-3 border-t border-slate-800/60 text-xs">
                    <div class="flex items-center gap-3">
                        <!-- Upvote / Downvote -->
                        <div class="flex items-center bg-slate-950/80 rounded-xl border border-slate-800 px-1 py-0.5">
                            <button onclick="votePost('${post.id}', 'up')" class="p-1.5 rounded-lg hover:bg-slate-800 ${isUpvoted ? 'text-emerald-400' : 'text-slate-400'} transition-colors cursor-pointer">
                                <i data-lucide="arrow-big-up" class="w-4 h-4"></i>
                            </button>
                            <span class="px-2 font-mono font-semibold ${post.score > 0 ? 'text-emerald-400' : post.score < 0 ? 'text-rose-400' : 'text-slate-400'}">${post.score || 0}</span>
                            <button onclick="votePost('${post.id}', 'down')" class="p-1.5 rounded-lg hover:bg-slate-800 ${isDownvoted ? 'text-rose-400' : 'text-slate-400'} transition-colors cursor-pointer">
                                <i data-lucide="arrow-big-down" class="w-4 h-4"></i>
                            </button>
                        </div>

                        <!-- Like Button -->
                        <button onclick="likePost('${post.id}')" class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950/80 border ${isLiked ? 'text-rose-400 border-rose-500/30 bg-rose-500/10' : 'border-slate-800 text-slate-400 hover:text-rose-400'} transition-all cursor-pointer">
                            <i data-lucide="heart" class="w-3.5 h-3.5 ${isLiked ? 'fill-rose-400' : ''}"></i>
                            <span class="font-mono font-medium">${post.likes || 0}</span>
                        </button>
                    </div>

                    <!-- Comments Counter -->
                    <button onclick="toggleReplies('${post.id}')" class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-400 hover:text-indigo-400 transition-colors cursor-pointer">
                        <i data-lucide="message-square" class="w-3.5 h-3.5"></i>
                        <span class="font-mono">${post.commentsCount || 0} Replies</span>
                    </button>
                </div>

                <!-- Replies Container -->
                <div id="replies-${post.id}" class="mt-4 pt-4 border-t border-slate-800/80 space-y-3 hidden">
                    <div class="flex gap-2">
                        <input type="text" id="replyInput-${post.id}" placeholder="Reply anonymously..." maxlength="400" autocomplete="off"
                            class="flex-1 bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500">
                        <button onclick="submitReply('${post.id}')" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-xs transition-colors cursor-pointer">
                            Reply
                        </button>
                    </div>
                    <div id="repliesList-${post.id}" class="space-y-2.5 pt-2"></div>
                </div>
            </article>
        `;
    }).join('');

    // Restore reply drafts and re-open expanded threads
    Object.entries(drafts).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    });
    openReplies.forEach(postId => {
        const el = document.getElementById(`replies-${postId}`);
        if (el) {
            el.classList.remove('hidden');
            // Repopulate instantly from cache — the live listener only fires
            // on data changes, so a fresh container would otherwise stay empty.
            const list = document.getElementById(`repliesList-${postId}`);
            if (list && repliesCache[postId] !== undefined) {
                list.innerHTML = repliesCache[postId];
            }
            listenToReplies(postId);
        }
    });

    if (window.lucide) window.lucide.createIcons();
}

/* ------------------------------------------------------------------ */
/* 5. Reactions (local state + counter-only writes)                    */
/* ------------------------------------------------------------------ */
window.likePost = async (postId) => {
    if (!currentUser) return;
    const wasLiked = !!likedPosts[postId];

    if (wasLiked) delete likedPosts[postId]; else likedPosts[postId] = true;
    saveState(LS_KEYS.likes, likedPosts);

    try {
        await updateDoc(doc(db, "posts", postId), { likes: increment(wasLiked ? -1 : 1) });
    } catch (e) {
        // Revert local state if the write failed
        if (wasLiked) likedPosts[postId] = true; else delete likedPosts[postId];
        saveState(LS_KEYS.likes, likedPosts);
    }
};

window.votePost = async (postId, type) => {
    if (!currentUser) return;
    const prev = votes[postId] || null;
    let delta;

    if (type === 'up') {
        if (prev === 'up')        { delta = { score: -1, upvotes: -1, downvotes: 0 };  delete votes[postId]; }
        else if (prev === 'down') { delta = { score: 2,  upvotes: 1,  downvotes: -1 }; votes[postId] = 'up'; }
        else                      { delta = { score: 1,  upvotes: 1,  downvotes: 0 };  votes[postId] = 'up'; }
    } else {
        if (prev === 'down')      { delta = { score: 1,  upvotes: 0,  downvotes: -1 }; delete votes[postId]; }
        else if (prev === 'up')   { delta = { score: -2, upvotes: -1, downvotes: 1 };  votes[postId] = 'down'; }
        else                      { delta = { score: -1, upvotes: 0,  downvotes: 1 };  votes[postId] = 'down'; }
    }

    saveState(LS_KEYS.votes, votes);

    const update = {};
    if (delta.score) update.score = increment(delta.score);
    if (delta.upvotes) update.upvotes = increment(delta.upvotes);
    if (delta.downvotes) update.downvotes = increment(delta.downvotes);

    try {
        await updateDoc(doc(db, "posts", postId), update);
    } catch (e) {
        // Revert local state if the write failed
        if (prev) votes[postId] = prev; else delete votes[postId];
        saveState(LS_KEYS.votes, votes);
    }
};

/* ------------------------------------------------------------------ */
/* 6. Replies                                                          */
/* ------------------------------------------------------------------ */
window.toggleReplies = (postId) => {
    const el = document.getElementById(`replies-${postId}`);
    if (!el) return;

    const willOpen = el.classList.contains('hidden');
    el.classList.toggle('hidden');

    if (willOpen) {
        openReplies.add(postId);
        listenToReplies(postId);
    } else {
        openReplies.delete(postId);
        if (replyUnsubscribers[postId]) {
            replyUnsubscribers[postId]();
            delete replyUnsubscribers[postId];
        }
    }
};

function listenToReplies(postId) {
    if (replyUnsubscribers[postId]) return;

    const q = query(collection(db, "posts", postId, "replies"), orderBy("timestamp", "asc"));

    replyUnsubscribers[postId] = onSnapshot(q, (snapshot) => {
        const repliesList = document.getElementById(`repliesList-${postId}`);
        if (!repliesList) return;

        if (snapshot.empty) {
            repliesCache[postId] = `<p class="text-xs text-slate-500 italic">No replies yet. Start the conversation!</p>`;
            repliesList.innerHTML = repliesCache[postId];
            return;
        }

        let html = '';
        snapshot.forEach((docSnap) => {
            const reply = { id: docSnap.id, ...docSnap.data() };
            const isLiked = !!likedReplies[reply.id];

            html += `
                <div class="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 text-xs flex items-start justify-between gap-2">
                    <div class="space-y-1">
                        <span class="text-[10px] font-mono text-indigo-400 font-medium">Anonymous • ${timeAgo(reply.timestamp)}</span>
                        <p class="text-slate-300 leading-relaxed">${reply.content}</p>
                    </div>
                    <button onclick="likeReply('${postId}', '${reply.id}')" class="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 border ${isLiked ? 'text-rose-400 border-rose-500/30' : 'border-slate-800 text-slate-500 hover:text-rose-400'} transition-colors cursor-pointer">
                        <i data-lucide="heart" class="w-3 h-3 ${isLiked ? 'fill-rose-400' : ''}"></i>
                        <span class="font-mono text-[10px]">${reply.likes || 0}</span>
                    </button>
                </div>
            `;
        });

        repliesCache[postId] = html;
        repliesList.innerHTML = html;
        if (window.lucide) window.lucide.createIcons();
    });
}

window.submitReply = async (postId) => {
    const input = document.getElementById(`replyInput-${postId}`);
    if (!input) return;

    const content = input.value.trim();
    if (!content || !currentUser) return;

    input.disabled = true;
    try {
        await addDoc(collection(db, "posts", postId, "replies"), {
            content: sanitize(content),
            timestamp: serverTimestamp(),
            likes: 0
        });

        await updateDoc(doc(db, "posts", postId), {
            commentsCount: increment(1)
        });

        input.value = '';
    } catch (e) {
        // Keep the draft if the write failed
    } finally {
        input.disabled = false;
    }
};

window.likeReply = async (postId, replyId) => {
    if (!currentUser) return;
    const wasLiked = !!likedReplies[replyId];

    if (wasLiked) delete likedReplies[replyId]; else likedReplies[replyId] = true;
    saveState(LS_KEYS.replyLikes, likedReplies);

    try {
        await updateDoc(doc(db, "posts", postId, "replies", replyId), { likes: increment(wasLiked ? -1 : 1) });
    } catch (e) {
        if (wasLiked) likedReplies[replyId] = true; else delete likedReplies[replyId];
        saveState(LS_KEYS.replyLikes, likedReplies);
    }
};

/* ------------------------------------------------------------------ */
/* 7. Sorting & Category Controls                                      */
/* ------------------------------------------------------------------ */
const SORT_ACTIVE = 'px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-indigo-400 border border-slate-700 transition-all cursor-pointer';
const SORT_IDLE = 'px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-slate-400 hover:text-slate-200 border border-transparent transition-all cursor-pointer';

function setSort(sortName) {
    currentSort = sortName;
    const map = { hot: 'sortHot', new: 'sortNew', top: 'sortTop' };
    Object.entries(map).forEach(([key, id]) => {
        const btn = document.getElementById(id);
        if (btn) btn.className = key === sortName ? SORT_ACTIVE : SORT_IDLE;
    });
    initFeed();
}

document.getElementById('sortHot')?.addEventListener('click', () => setSort('hot'));
document.getElementById('sortNew')?.addEventListener('click', () => setSort('new'));
document.getElementById('sortTop')?.addEventListener('click', () => setSort('top'));

// Category nav buttons
document.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentCategory = btn.dataset.category || 'all';
        initFeed();
    });
});

/* ------------------------------------------------------------------ */
/* 8. Privacy Shield (feature — toggle button / Alt+L / click / Esc)   */
/* ------------------------------------------------------------------ */
const shieldOverlay = document.getElementById('libraryShieldOverlay');
const toggleShieldBtn = document.getElementById('toggleShieldBtn');
const unlockShieldBtn = document.getElementById('unlockShieldBtn');

function setShield(active) {
    if (shieldOverlay) shieldOverlay.classList.toggle('hidden', !active);
}
function toggleShield() {
    if (shieldOverlay) shieldOverlay.classList.toggle('hidden');
}

if (toggleShieldBtn) toggleShieldBtn.addEventListener('click', toggleShield);
if (unlockShieldBtn) unlockShieldBtn.addEventListener('click', () => setShield(false));
// "Click anywhere to unlock"
if (shieldOverlay) shieldOverlay.addEventListener('click', () => setShield(false));

window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        toggleShield();
    }
    if (e.key === 'Escape' && shieldOverlay && !shieldOverlay.classList.contains('hidden')) {
        setShield(false);
    }
});
