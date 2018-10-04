/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const mkdirp = require("mkdirp");
const path = require("path");
const createHash = require("../util/createHash");
const serializer = require("../util/serializer");

/** @typedef {import("webpack-sources").Source} Source */
/** @typedef {import("../Compiler")} Compiler */
/** @typedef {import("../Module")} Module */

const moduleMemoryCache = new Map();
const assetMemoryCache = new Map();

class FileCachePlugin {
	constructor(options) {
		this.options = options;
	}

	/**
	 * @param {Compiler} compiler Webpack compiler
	 * @returns {void}
	 */
	apply(compiler) {
		const cacheDirectory = path.resolve(
			this.options.cacheDirectory || "node_modules/.cache/webpack/",
			this.options.name || compiler.name || "default"
		);
		const hashAlgorithm = this.options.hashAlgorithm || "md4";
		const version = this.options.version || "";
		const warn = this.options.warn || false;
		const store = this.options.store || "idle";

		let pendingPromiseFactories = new Map();
		const toHash = str => {
			const hash = createHash(hashAlgorithm);
			hash.update(str);
			const digest = hash.digest("hex");
			return `${digest.slice(0, 2)}/${digest.slice(2)}`;
		};
		compiler.hooks.beforeCompile.tapAsync(
			"FileCachePlugin",
			(params, callback) => {
				mkdirp(cacheDirectory, callback);
			}
		);
		compiler.cache.hooks.storeModule.tapPromise(
			"FileCachePlugin",
			(identifier, module) => {
				const data = { module, version };
				const filename = path.join(
					cacheDirectory,
					toHash(identifier) + ".module.data"
				);
				moduleMemoryCache.set(filename, module);
				const promiseFactory = () =>
					serializer.serializeToFile(data, filename).catch(err => {
						if (warn) {
							console.warn(`Caching failed for module ${identifier}: ${err}`);
						}
					});
				if (store === "instant") {
					return promiseFactory();
				} else if (store === "idle") {
					pendingPromiseFactories.set(filename, promiseFactory);
					return Promise.resolve();
				} else if (store === "background") {
					const promise = promiseFactory();
					pendingPromiseFactories.set(filename, () => promise);
					return Promise.resolve();
				}
			}
		);
		compiler.cache.hooks.getModule.tapPromise("FileCachePlugin", identifier => {
			const filename = path.join(
				cacheDirectory,
				toHash(identifier) + ".module.data"
			);
			const memory = moduleMemoryCache.get(filename);
			if (memory !== undefined) {
				return Promise.resolve(
					memory.version === version ? memory.module : undefined
				);
			}
			return serializer.deserializeFromFile(filename).then(
				cacheEntry => {
					moduleMemoryCache.set(filename, cacheEntry);
					if (cacheEntry !== undefined && cacheEntry.version === version) {
						return cacheEntry.source;
					}
				},
				err => {
					if (warn && err && err.code !== "ENOENT") {
						console.warn(
							`Restoring failed for module ${identifier}: ${err.stack}`
						);
					}
				}
			);
		});
		compiler.cache.hooks.storeAsset.tapPromise(
			"FileCachePlugin",
			(identifier, hash, source) => {
				const data = { hash, source, version };
				const filename = path.join(
					cacheDirectory,
					toHash(identifier) + ".asset.data"
				);
				assetMemoryCache.set(filename, data);
				const promiseFactory = () =>
					serializer.serializeToFile(data, filename).catch(err => {
						if (warn) {
							console.warn(`Caching failed for asset ${identifier}: ${err}`);
						}
					});
				if (store === "instant") {
					return promiseFactory();
				} else if (store === "idle") {
					pendingPromiseFactories.set(filename, promiseFactory);
					return Promise.resolve();
				} else if (store === "background") {
					const promise = promiseFactory();
					pendingPromiseFactories.set(filename, () => promise);
					return Promise.resolve();
				}
			}
		);
		compiler.cache.hooks.getAsset.tapPromise(
			"FileCachePlugin",
			(identifier, hash) => {
				const filename = path.join(
					cacheDirectory,
					toHash(identifier) + ".asset.data"
				);
				const memory = assetMemoryCache.get(filename);
				if (memory !== undefined) {
					return Promise.resolve(
						memory.hash === hash && memory.version === version
							? memory.source
							: undefined
					);
				}
				return serializer.deserializeFromFile(filename).then(
					cacheEntry => {
						assetMemoryCache.set(filename, cacheEntry);
						if (
							cacheEntry !== undefined &&
							cacheEntry.hash === hash &&
							cacheEntry.version === version
						) {
							return cacheEntry.source;
						}
					},
					err => {
						if (warn && err && err.code !== "ENOENT") {
							console.warn(`Restoring failed for asset ${identifier}: ${err}`);
						}
					}
				);
			}
		);
		compiler.cache.hooks.shutdown.tapPromise("FileCachePlugin", () => {
			isIdle = false;
			const promises = Array.from(pendingPromiseFactories.values()).map(fn =>
				fn()
			);
			pendingPromiseFactories.clear();
			if (currentIdlePromise !== undefined) promises.push(currentIdlePromise);
			return Promise.all(promises);
		});

		let currentIdlePromise;
		let isIdle = false;
		const processIdleTasks = () => {
			if (isIdle && pendingPromiseFactories.size > 0) {
				const promises = [];
				const maxTime = Date.now() + 100;
				let maxCount = 100;
				for (const [filename, factory] of pendingPromiseFactories) {
					pendingPromiseFactories.delete(filename);
					promises.push(factory());
					if (maxCount-- <= 0 || Date.now() > maxTime) break;
				}
				currentIdlePromise = Promise.all(promises).then(() => {
					currentIdlePromise = undefined;
				});
				currentIdlePromise.then(processIdleTasks);
			}
		};
		compiler.cache.hooks.beginIdle.tap("FileCachePlugin", () => {
			isIdle = true;
			Promise.resolve().then(processIdleTasks);
		});
		compiler.cache.hooks.endIdle.tap("FileCachePlugin", () => {
			isIdle = false;
		});
	}
}
module.exports = FileCachePlugin;
