"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const jwt_1 = require("./jwt");
const db_1 = require("../db");
async function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing bearer token' });
        return;
    }
    let userId;
    let username;
    try {
        const payload = (0, jwt_1.verifyToken)(header.slice(7).trim());
        userId = payload.sub;
        username = payload.username;
    }
    catch {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
    }
    try {
        const user = await db_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            res.status(401).json({ error: 'User not found' });
            return;
        }
        if (user.blocked) {
            res.status(403).json({ error: 'Account blocked by admin' });
            return;
        }
        req.userId = userId;
        req.username = username;
        req.userRole = user.role;
        next();
    }
    catch (err) {
        console.error('[auth/middleware] error:', err);
        res.status(500).json({ error: 'Auth check failed' });
    }
}
//# sourceMappingURL=middleware.js.map