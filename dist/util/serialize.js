"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicUser = publicUser;
exports.sleep = sleep;
function publicUser(user) {
    return {
        id: user.id,
        email: user.email,
        username: user.username,
        balance: user.balance,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
    };
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=serialize.js.map