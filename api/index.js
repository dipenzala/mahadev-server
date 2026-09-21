// Mahadev - Vercel serverless adapter
// Compiled server (dist/index.js) import karta hai
const app = require('../dist/index.js');
module.exports = app.default || app;
