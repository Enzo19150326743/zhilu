import assert from "node:assert/strict";
import test from "node:test";
import { getDisplayThumbnailUrl } from "./media-image";

test("本地封面路径保持不变", () => {
  assert.equal(
    getDisplayThumbnailUrl(" /images/fallback.svg ", "http://localhost:8000"),
    "/images/fallback.svg"
  );
});

test("远程封面统一通过后端图片代理加载", () => {
  const sourceUrl = "https://cdn.example.com/cover image.jpg?size=large&v=2";

  assert.equal(
    getDisplayThumbnailUrl(sourceUrl, "http://localhost:8000/"),
    `http://localhost:8000/api/image-proxy?url=${encodeURIComponent(sourceUrl)}`
  );
});

test("后端 Demo 封面路径拼接到后端地址而不是前端静态目录", () => {
  assert.equal(
    getDisplayThumbnailUrl(
      "/api/demo/product_course_001/cover",
      "http://localhost:8000/"
    ),
    "http://localhost:8000/api/demo/product_course_001/cover"
  );
});

test("空封面不生成代理地址", () => {
  assert.equal(getDisplayThumbnailUrl("   ", "http://localhost:8000"), "");
});
