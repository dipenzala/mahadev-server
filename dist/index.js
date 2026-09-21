"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_http_1 = __importDefault(require("node:http"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const env_1 = require("./env");
const auth_1 = require("./routes/auth");
const me_1 = require("./routes/me");
const rounds_1 = require("./routes/rounds");
const admin_1 = require("./routes/admin");
const adminAuth_1 = require("./routes/adminAuth");
const sockets_1 = require("./sockets");
const db_1 = require("./db");
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: env_1.env.CLIENT_ORIGIN, credentials: true }));
app.use(express_1.default.json({ limit: '100kb' }));
app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'andar-bahar', time: new Date().toISOString() });
});
app.use('/api/auth', auth_1.authRouter);
app.use('/api/me', me_1.meRouter);
app.use('/api/rounds', rounds_1.roundsRouter);
app.use('/api/admin-auth', adminAuth_1.adminAuthRouter);
app.use('/api/admin', admin_1.adminRouter);
const server = node_http_1.default.createServer(app);
(0, sockets_1.initSockets)(server);
server.listen(env_1.env.PORT, () => {
    console.log('[server] HTTP + Socket.IO listening on http://localhost:' + env_1.env.PORT);
    console.log('[server] admin-driven mode â€” no auto timer');
});
async function shutdown(signal) {
    console.log('[server] received ' + signal + ', shutting down');
    server.close();
    await db_1.prisma.$disconnect();
    process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
exports.default = app;
//# sourceMappingURL=index.js.map