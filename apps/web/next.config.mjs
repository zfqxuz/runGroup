/** @type {import("next").NextConfig} */
const nextConfig = {
  // dev / E2E / production 使用独立目录，避免 .next chunk 缓存互相污染
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  // 车卡界面要在浏览器里实时算衍生属性，需要把 workspace 的 TS 包一起打包
  transpilePackages: ["@touhou/formula", "@touhou/rules"],
  experimental: {
    // PDF 整页渲染需要原生 canvas，必须作为外部依赖交给 Node 运行，不能进 webpack bundle。
    serverComponentsExternalPackages: ["@napi-rs/canvas"],
    // 线索图片随 Server Action 一起提交；默认 1MB 撑不住 8MB 原图。
    serverActions: {
      bodySizeLimit: "10mb"
    }
  }
};

export default nextConfig;
