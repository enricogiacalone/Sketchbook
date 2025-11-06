const path = require("path");

module.exports = {
  entry: {
    app: "./src/ts/sketchbook.ts",
  },
  output: {
    filename: "./build/sketchbook.min.js",
    library: "Sketchbook",
    libraryTarget: "umd",
    path: path.resolve(__dirname),
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
    alias: {
      'three/addons': path.resolve(__dirname, 'node_modules/three/examples/jsm')
    }
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: [
          {
            loader: "style-loader",
          },
          { loader: "css-loader" },
        ],
      },
    ],
  },
  performance: {
    hints: false,
  },
};
