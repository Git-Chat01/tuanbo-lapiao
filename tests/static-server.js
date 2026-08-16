// 零依赖静态文件服务器（本地联调用）：node tests/static-server.js
// 不用 npx http-server 的原因：避免引入/下载任何第三方依赖
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "site");
const PORT = 8080;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

http
  .createServer(function (req, res) {
    var urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";
    var filePath = path.join(ROOT, path.normalize(urlPath));
    // 防目录穿越：解析后的路径必须在 site/ 根内
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    fs.readFile(filePath, function (err, data) {
      if (err) {
        res.writeHead(404);
        return res.end("Not Found");
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
      });
      res.end(data);
    });
  })
  .listen(PORT, function () {
    console.log("site served at http://localhost:" + PORT);
  });
