// const path = require("path");
const CracoLessPlugin = require("craco-less");

// craco.config.js
// module.exports = {
//   style: {
//     postcss: {
//       plugins: [require("tailwindcss"), require("autoprefixer")],
//     },
//   },
// };

module.exports = {
  plugins: [
    {
      plugin: CracoLessPlugin,
      options: {
        lessLoaderOptions: {
          lessOptions: {
            javascriptEnabled: true,
            modifyVars: {
              "@primary-color": "#3B82F6", // 自定义主题变量
            },
          },
        },
      },
    },
  ],
  style: {
    postcss: {
      plugins: [require("tailwindcss"), require("autoprefixer")],
    },
  },
  webpack: {
    configure: (webpackConfig) => {
      webpackConfig.externals = {
        electron: 'commonjs2 electron', // 排除 electron 模块
      };
      return webpackConfig;
    },
  },
};
