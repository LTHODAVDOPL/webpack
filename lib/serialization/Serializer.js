/*
	MIT License http://www.opensource.org/licenses/mit-license.php
*/

"use strict";

class Serializer {
	constructor(middlewares) {
		this.middlewares = middlewares;
	}

	serializeToFile(obj, filename) {
		const context = {
			filename
		};
		return new Promise((resolve, reject) =>
			resolve(
				this.middlewares.reduce(
					(last, middleware) => {
						if (last instanceof Promise) {
							return last.then(data => middleware.serialize(data, context));
						} else {
							try {
								return middleware.serialize(last, context);
							} catch (err) {
								return Promise.resolve().then(() => {
									throw err;
								});
							}
						}
					},
					[obj]
				)
			)
		);
	}

	deserializeFromFile(filename) {
		const context = {
			filename
		};
		return Promise.resolve()
			.then(() =>
				this.middlewares
					.slice()
					.reverse()
					.reduce((last, middleware) => {
						if (last instanceof Promise)
							return last.then(data => middleware.deserialize(data, context));
						else return middleware.deserialize(last, context);
					}, [])
			)
			.then(array => {
				return array[0];
			});
	}
}

module.exports = Serializer;
