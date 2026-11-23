// Next dev checks the npm registry even with telemetry disabled. Keep this
// preview and its Node workers offline, including requests bypassing fetch.
const net = process.getBuiltinModule("node:net");
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = net._normalizeArgs(Array.isArray(args[0]) ? args[0] : args)[0];
  if (!options.path && options.host && !["localhost", "127.0.0.1", "::1"].includes(options.host)) {
    throw new Error("External network disabled for model-import fixture");
  }
  return original.apply(this, args);
};
