// const path = require("path");
const CracoLessPlugin = require("craco-less");
const path = require('path');

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
      webpackConfig.target = 'electron-renderer';
      return webpackConfig;
    },
  },
  devServer: (devServerConfig) => {
    devServerConfig.setupMiddlewares = (middlewares, devServer) => {
      // 如果需要自定义中间件，可以在这里添加
      return middlewares;
    };

    devServerConfig.headers = {
      "Access-Control-Allow-Origin": "*"
    };
    devServerConfig.historyApiFallback = true;
    return devServerConfig;
  }
};
