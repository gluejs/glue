/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-env node */

const fs = require('fs');
const path = require('path');
const BannerPlugin = require('webpack').BannerPlugin;
const DefinePlugin = require('webpack').DefinePlugin;
const UglifyJsPlugin = require('uglifyjs-webpack-plugin');
const LicenseWebpackPlugin = require('license-webpack-plugin').LicenseWebpackPlugin;
const GitRevisionPlugin = require('git-revision-webpack-plugin');

function getVersionFromGit() {
	const p = new GitRevisionPlugin({
		versionCommand: '\
			describe --tags --always --dirty --match=v* 2>/dev/null | sed \'s/^v//\' || \
				cat ./.version 2> /dev/null || echo 0.0.0-unreleased'
	});

	return p.version();
}

const buildVersion = process.env.BUILD_VERSION || getVersionFromGit();
const buildDate = process.env.BUILD_DATE || new Date();
const target = process.env.TARGET || 'ES2015';

module.exports = {
	resolve: {
		extensions: ['.ts', '.js']
	},
	entry: [
		__dirname + '/src/index.ts'
	],
	output: {
		filename: 'glue.js',
		path: path.resolve(__dirname, 'umd'),
		publicPath: '/umd/',
		library: 'Glue',
		libraryTarget: 'umd',
		umdNamedDefine: true
	},
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				loader: 'eslint-loader',
				exclude: /node_modules/,
				enforce: 'pre',
				options: {
					emitErrors: true,
					failOnHint: false
				}
			},
			{
				test: /\.tsx?$/,
				loader: 'ts-loader',
				exclude: /node_modules/,
				options: {
					compilerOptions: {
						target: target,
						declarationDir: 'umd/src'
					}
				}
			}
		]
	},
	devtool: 'source-map',
	plugins: [
		new UglifyJsPlugin({
			sourceMap: true,
			uglifyOptions: {
				ecma: 8,
				warnings: true,
				output: {
					comments: false
				}
			}
		}),
		new DefinePlugin({
			__VERSION__: JSON.stringify(buildVersion)
		}),
		new LicenseWebpackPlugin({
			pattern: /^(MIT|ISC|BSD.*)$/,
			unacceptablePattern: /GPL/,
			abortOnUnacceptableLicense: true,
			perChunkOutput: false,
			outputFilename: '../NOTICES.txt'
		}),
		new BannerPlugin(
			fs.readFileSync(path.resolve(__dirname, 'LICENSE.txt')).toString()
			+ '\n\n@version ' + buildVersion + ' (' + buildDate + ')' + ' ' + target
		)
	]
};
