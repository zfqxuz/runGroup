/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // 车卡界面要在浏览器里实时算衍生属性，需要把 workspace 的 TS 包一起打包
  transpilePackages: ["@touhou/formula", "@touhou/rules"]
};

export default nextConfig;
