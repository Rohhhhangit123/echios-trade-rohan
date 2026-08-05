/** @type {import('next').NextConfig} */
class PreserveOrtWebGpuModulePlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap(
      "PreserveOrtWebGpuModulePlugin",
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: "PreserveOrtWebGpuModulePlugin",
            stage:
              compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE -
              1,
          },
          () => {
            for (const asset of compilation.getAssets()) {
              if (!/ort\.webgpu\.bundle\.min\..*\.mjs$/.test(asset.name)) {
                continue;
              }
              compilation.updateAsset(asset.name, asset.source, {
                ...asset.info,
                minimized: true,
              });
            }
          },
        );
      },
    );
  }
}

const nextConfig = {
  reactStrictMode: true,
  webpack(config, { isServer }) {
    config.resolve.alias["@huggingface/transformers"] = require
      .resolve("@huggingface/transformers")
      .replace("transformers.node.cjs", "transformers.web.js");
    if (!isServer) {
      config.plugins.push(new PreserveOrtWebGpuModulePlugin());
    }
    return config;
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*",
      },
      {
        source: "/health",
        destination: "http://localhost:8000/health",
      },
      {
        source: "/ws/:path*",
        destination: "http://localhost:8000/ws/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
