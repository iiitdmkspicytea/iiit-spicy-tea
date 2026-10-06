# IIIT Spicy Tea • Kurnool

An anonymous, privacy-first student discussion board designed for **IIIT Kurnool**. Built with modern Glassmorphism UI, Firebase Anonymous Authentication, real-time Firestore database, and client-side anti-inspect hardening.

## 🚀 Key Features

1. **Strict Anonymity**: Powered by Firebase Anonymous Auth. No usernames, handles, emails, or personal identifiers are stored or shown on posts.
2. **On-Device Reactions**: Votes and likes are tracked only in your browser (localStorage). The database stores pure counters — it can never reveal *who* reacted to *what*.
3. **Interactive Feed & Dynamic Voting**: Real-time post creation, nested replies, upvote/downvote counter, and like buttons for every post and reply.
4. **Privacy Shield**: Screen-blurring overlay (toggleable with `Alt + L`, the shield button, `Esc`, or clicking the overlay) to protect privacy when browsing in public campus areas.
5. **DevTools / Anti-Inspect Hardening**: Keyboard shortcut suppression (F12, Ctrl+Shift+I/J/C, Ctrl+U), context menu block, and a console scam warning.
6. **Backend Security**: Strict Firestore Rules — posts can never be edited or deleted after publishing; only reaction counters may change. New writes carry no user identifiers.

### Categories
`Academics` • `Campus` • `Confessions`

---